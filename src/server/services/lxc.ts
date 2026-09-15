import { execFile } from "child_process";
import fs from "fs";
import {
  createSimContainer,
  destroySimContainer,
  hasSimContainer,
  listSimContainers,
  startSimContainer,
  stopSimContainer,
} from "./lxcSim.js";

/**
 * Container driver for the panel's Virtual Private Servers category.
 *
 * Two runtimes are supported because hosts end up with either one:
 *
 *   - "lxd"  — the LXD snap, driven by `lxc launch/list/start/...`. This is what
 *              the panel's INSTALL NOW button sets up.
 *   - "lxc"  — the classic LXC tools (`lxc-create`, `lxc-ls`, `lxc-info`, …)
 *              from Ubuntu's `lxc` package.
 *
 * Their command lines are completely different, so every operation dispatches on
 * the detected driver. Detection runs first and reports an actionable reason
 * when neither runtime is present.
 */

export type LxcDriver = "lxd" | "lxc";

export type LxcStatus = {
  /** A real container runtime is usable. */
  available: boolean;
  driver: LxcDriver | null;
  reason?: string;
  /** No real runtime, so operations are simulated in-panel. */
  simulated: boolean;
  /** Provisioning is possible (either for real or simulated). */
  canProvision: boolean;
  /**
   * A runtime is installed, but the panel host is itself containerised so nested
   * containers cannot be created here. Real provisioning is impossible on this
   * host no matter how the panel is configured.
   */
  nestedBlocked?: boolean;
};

export class LxcUnavailableError extends Error {
  code = "LXC_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "LxcUnavailableError";
  }
}

export class LxcOperationError extends Error {
  code = "LXC_OPERATION_FAILED";
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "LxcOperationError";
    this.detail = detail;
  }
}

export type LxcTemplate = {
  distro: string;
  release: string;
  label: string;
  /** Image alias on LXD's `images:` remote, used when the LXD driver is active. */
  image: string;
  /** Bundled distro mark shown on the deploy card. */
  logo: string;
};

/** LXC VPS images are deliberately limited to the four current LTS/stable releases. */
export const LXC_TEMPLATES: LxcTemplate[] = [
  { distro: "ubuntu", release: "jammy", label: "Ubuntu 22.04 LTS (Jammy)", image: "images:ubuntu/22.04", logo: "/icons/ubuntu.svg" },
  { distro: "ubuntu", release: "noble", label: "Ubuntu 24.04 LTS (Noble)", image: "images:ubuntu/24.04", logo: "/icons/ubuntu.svg" },
  { distro: "debian", release: "bookworm", label: "Debian 12 (Bookworm)", image: "images:debian/12", logo: "/icons/debian.svg" },
  { distro: "debian", release: "trixie", label: "Debian 13 (Trixie)", image: "images:debian/13", logo: "/icons/debian.svg" },
];

export const LXC_ARCHES = ["amd64", "arm64"];

const CLASSIC_BINARIES = ["lxc-create", "lxc-ls", "lxc-info", "lxc-start", "lxc-stop", "lxc-destroy"];

type ExecResult = { stdout: string; stderr: string };

/**
 * The panel presents VPS as "containers" and never names the engine that backs
 * them, so any raw tool output has to be scrubbed before it reaches the UI.
 */
function scrubRuntimeNames(text: string): string {
  return String(text)
    .replace(/\blx[cd][-_][a-z0-9_]+/gi, "container")
    .replace(/\blx[cd]\b/gi, "container")
    .replace(/\s+/g, " ")
    .trim();
}

function execFileAsync(
  cmd: string,
  args: string[],
  timeoutMs = 60000,
  input?: string,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err: any, stdout, stderr) => {
      if (err) {
        const detail = scrubRuntimeNames(String(stderr || err.message || "").trim());
        return reject(new LxcOperationError("The container operation failed", detail));
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    // Secrets are piped in over stdin so they never appear in argv or a shell.
    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
  });
}

/** Snap-installed tools live in /snap/bin, which is not always on the panel's PATH. */
async function resolveBinary(name: string): Promise<string | null> {
  const candidates = [
    `/snap/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/usr/sbin/${name}`,
    `/bin/${name}`,
    `/sbin/${name}`,
  ];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${name}`], 10000);
    const found = stdout.trim().split("\n")[0];
    if (found) return found;
  } catch {
    // not on PATH either
  }
  return null;
}

type ContainerDriver =
  | { kind: "lxd"; lxc: string }
  | { kind: "lxc"; bins: Record<string, string> }
  | { kind: "simulated" };

type ResolvedDriver = { driver: ContainerDriver | null; reason?: string };

/**
 * Simulation is OFF unless someone deliberately turns it on.
 *
 * It used to default on, which meant a host that could not nest containers
 * quietly fabricated records and reported "success" for operations that never
 * happened. A real operation now either works or fails with a reason the
 * operator can act on. Set IVM_VPS_SIMULATE=true, or flip the admin toggle in
 * Settings → Runtime, only when you want the UI demoable on such a host.
 */
let simulationOverride: boolean | null = null;

export function setSimulationOverride(on: boolean | null): void {
  simulationOverride = on;
}

export function isSimulationEnabled(): boolean {
  if (process.env.IVM_VPS_SIMULATE === "true") return true;
  if (process.env.IVM_VPS_SIMULATE === "false") return false;
  return simulationOverride === true;
}

/** True when the active driver cannot touch a real filesystem or shell. */
export async function isSimulated(): Promise<boolean> {
  await detectLxc();
  return cache?.resolved?.driver?.kind === "simulated";
}

let cache: { at: number; status: LxcStatus; resolved: ResolvedDriver } | null = null;
const STATUS_TTL_MS = 15000;

// Deliberately free of runtime names: the panel presents VPS as "containers"
// and never tells the end user which engine backs them.
const NO_RUNTIME_REASON =
  "No container runtime is available on this host. Use the INSTALL NOW button to set one up, " +
  "or run the panel on a VM or dedicated host.";

// Shown when a runtime exists but the panel itself is containerised, which makes
// nested container creation impossible.
const NESTED_BLOCKED_REASON =
  "This host is itself a container, so nested VPS cannot be created here. Run the panel on a " +
  "virtual machine or dedicated host to provision for real.";

/** Virtualisation levels that mean the panel is inside a container. */
const CONTAINERISED_VIRT = /^(lxc|lxd|docker|podman|openvz|systemd-nspawn|wsl|containerd)$/i;

/**
 * A runtime being present is not enough: a container cannot normally create a
 * nested container. Detecting this up front turns a confusing mid-provision
 * failure into a clear, actionable status.
 */
async function isHostContainerised(): Promise<boolean> {
  return CONTAINERISED_VIRT.test(String(await hostVirtualization()).trim());
}

async function resolveNow(): Promise<{ status: LxcStatus; resolved: ResolvedDriver }> {
  const nested = await isHostContainerised();

  /** A runtime is installed, so `available` stays true and INSTALL NOW stays hidden. */
  const realStatus = (driver: LxcDriver): LxcStatus =>
    nested
      ? isSimulationEnabled()
        ? {
            available: true,
            driver,
            simulated: true,
            canProvision: true,
            nestedBlocked: true,
            reason: NESTED_BLOCKED_REASON,
          }
        : {
            available: true,
            driver,
            simulated: false,
            canProvision: false,
            nestedBlocked: true,
            reason: NESTED_BLOCKED_REASON,
          }
      : { available: true, driver, simulated: false, canProvision: true };

  // Prefer LXD: it is what the panel's installer sets up.
  const lxc = await resolveBinary("lxc");
  if (lxc) {
    try {
      const { stdout } = await execFileAsync(lxc, ["info"], 25000);
      if (/api_extensions|api_status|server:/i.test(stdout)) {
        return {
          status: realStatus("lxd"),
          resolved: { driver: nested && isSimulationEnabled() ? { kind: "simulated" } : { kind: "lxd", lxc } },
        };
      }
    } catch {
      // `lxc` exists but no LXD server answered; fall through to the classic tools.
    }
  }

  const bins: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of CLASSIC_BINARIES) {
    const path = await resolveBinary(name);
    if (path) bins[name] = path;
    else missing.push(name);
  }

  if (missing.length === 0) {
    return {
      status: realStatus("lxc"),
      resolved: { driver: nested && isSimulationEnabled() ? { kind: "simulated" } : { kind: "lxc", bins } },
    };
  }

  // Nothing real is available. Rather than dead-ending the whole category, fall
  // back to the simulator so the management UI stays usable — clearly labelled.
  if (isSimulationEnabled()) {
    return {
      status: { available: false, driver: null, reason: NO_RUNTIME_REASON, simulated: true, canProvision: true },
      resolved: { driver: { kind: "simulated" }, reason: NO_RUNTIME_REASON },
    };
  }

  return {
    status: { available: false, driver: null, reason: NO_RUNTIME_REASON, simulated: false, canProvision: false },
    resolved: { driver: null, reason: NO_RUNTIME_REASON },
  };
}

export async function detectLxc(force = false): Promise<LxcStatus> {
  if (!force && cache && Date.now() - cache.at < STATUS_TTL_MS) return cache.status;
  const { status, resolved } = await resolveNow();
  cache = { at: Date.now(), status, resolved };
  return status;
}

async function currentDriver(): Promise<ContainerDriver> {
  await detectLxc();
  const resolved = cache?.resolved;
  if (!resolved || !resolved.driver) {
    throw new LxcUnavailableError(resolved?.reason || NO_RUNTIME_REASON);
  }
  return resolved.driver;
}

export type LxcContainer = {
  name: string;
  state: string;
  pid?: number;
  ipv4?: string;
  ipv6?: string;
  memoryBytes?: number;
  cpuSeconds?: number;
};

function parseSize(value: string): number | undefined {
  const m = value.match(/([\d.]+)\s*(kib|mib|gib|kb|mb|gb|b)?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return undefined;
  const unit = (m[2] || "b").toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
  };
  return Math.round(n * (mult[unit] ?? 1));
}

/** LXD `lxc list --format json` entry -> the shape the panel renders. */
function parseLxdInstance(entry: any): LxcContainer {
  const state = entry?.state || {};
  let ipv4: string | undefined;
  let ipv6: string | undefined;

  for (const iface of Object.values<any>(state.network || {})) {
    for (const addr of iface?.addresses || []) {
      if (addr.scope && addr.scope !== "global") continue;
      if (addr.family === "inet" && !ipv4) ipv4 = addr.address;
      else if (addr.family === "inet6" && !ipv6) ipv6 = addr.address;
    }
  }

  return {
    name: entry.name,
    state: String(state.status || entry.status || "UNKNOWN").toUpperCase(),
    pid: state.pid ?? undefined,
    ipv4,
    ipv6,
    memoryBytes: state.memory?.usage ?? undefined,
    cpuSeconds: typeof state.cpu?.usage === "number" ? state.cpu.usage / 1e9 : undefined,
  };
}

async function parseClassicInfo(bin: string, name: string): Promise<LxcContainer | null> {
  try {
    const { stdout } = await execFileAsync(bin, ["-n", name], 20000);
    const info: LxcContainer = { name, state: "UNKNOWN" };
    for (const line of stdout.split("\n")) {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const raw = m[2].trim();
      if (!raw) continue;

      if (key === "state") info.state = raw.toUpperCase();
      else if (key === "pid") info.pid = parseInt(raw, 10) || undefined;
      else if (key === "ip") {
        if (raw.includes(":")) info.ipv6 = raw;
        else info.ipv4 = raw;
      } else if (key === "memory use") info.memoryBytes = parseSize(raw);
      else if (key === "cpu use") {
        const seconds = parseFloat(raw.replace(/[^\d.]/g, ""));
        if (isFinite(seconds)) info.cpuSeconds = seconds;
      }
    }
    return info;
  } catch {
    return null;
  }
}

export async function listContainers(): Promise<LxcContainer[]> {
  const driver = await currentDriver();

  if (driver.kind === "simulated") {
    return listSimContainers();
  }

  if (driver.kind === "lxd") {
    const { stdout } = await execFileAsync(driver.lxc, ["list", "--format", "json"], 60000);
    const parsed = JSON.parse(stdout || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseLxdInstance);
  }

  const { stdout } = await execFileAsync(driver.bins["lxc-ls"], ["-1"], 30000);
  const names = stdout.split("\n").map((n) => n.trim()).filter(Boolean);
  const containers = await Promise.all(names.map((name) => parseClassicInfo(driver.bins["lxc-info"], name)));
  return containers.filter((c): c is LxcContainer => c !== null);
}

async function classicLxcPath(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", "command -v lxc-config >/dev/null 2>&1 && lxc-config lxc.lxcpath"], 10000);
    return stdout.trim() || "/var/lib/lxc";
  } catch {
    return "/var/lib/lxc";
  }
}

/**
 * Classic LXC only: persist memory/CPU limits in the container config so they
 * survive restarts (runtime cgroup values alone would be dropped).
 */
async function applyClassicLimits(name: string, memoryMb: number, cpu: number): Promise<void> {
  const base = await classicLxcPath();
  const configPath = `${base}/${name}/config`;
  const cgroupV2 = fs.existsSync("/sys/fs/cgroup/cgroup.controllers");

  const lines = ["", "# IVM Panel resource limits"];
  if (cgroupV2) {
    lines.push(`lxc.cgroup2.memory.max = ${memoryMb * 1024 * 1024}`);
    lines.push("lxc.cgroup2.memory.swap.max = 0");
    lines.push(`lxc.cgroup2.cpu.max = ${cpu * 100000} 100000`);
  } else {
    lines.push(`lxc.cgroup.memory.limit_in_bytes = ${memoryMb * 1024 * 1024}`);
    lines.push("lxc.cgroup.cpu.cfs_period_us = 100000");
    lines.push(`lxc.cgroup.cpu.cfs_quota_us = ${cpu * 100000}`);
  }

  await fs.promises.appendFile(configPath, lines.join("\n") + "\n", "utf-8");
}

/**
 * What this host is itself virtualised as. A host that is already an LXC
 * container cannot create nested containers, so the panel warns instead of
 * letting an admin kick off an install that cannot succeed.
 */
let virtCache: string | null = null;
export async function hostVirtualization(): Promise<string> {
  if (virtCache !== null) return virtCache;
  try {
    const { stdout } = await execFileAsync(
      "sh",
      ["-c", "command -v systemd-detect-virt >/dev/null 2>&1 && systemd-detect-virt || echo unknown"],
      10000,
    );
    virtCache = stdout.trim() || "unknown";
  } catch {
    virtCache = "unknown";
  }
  return virtCache;
}

/** Host-level device availability, surfaced to the deploy wizard. */
export function hostCapabilities(): { kvm: boolean; fuse: boolean } {
  return {
    kvm: fs.existsSync("/dev/kvm"),
    fuse: fs.existsSync("/dev/fuse"),
  };
}

export type CreateContainerOptions = {
  name: string;
  distro: string;
  release: string;
  arch: string;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  /** LXD image alias; falls back to `images:<distro>/<release>`. */
  image?: string;
  /** Expose /dev/kvm for nested virtualisation. */
  enableKvm?: boolean;
  /** Expose the devices Docker/FUSE/etc. need, without KVM. */
  enableAllDevices?: boolean;
  /** Allow running Docker inside the container. */
  allowDocker?: boolean;
  /** True when the container is being simulated rather than really created. */
  simulated?: boolean;
  /** Create a full virtual machine instead of a container (`lxc launch --vm`). */
  virtualMachine?: boolean;
  /** Root password injected at first boot via cloud-init (VMs). */
  rootPassword?: string;
  /** SSH public key injected at first boot via cloud-init (VMs). */
  sshPublicKey?: string;
};

/**
 * Cloud-init payload for a freshly created virtual machine.
 *
 * DHCP on the managed bridge is the default, so the guest gets a private
 * address and no public IPv4 — matching how VPS deployments behave. SSH is
 * enabled so the panel's SSH panel and the SSHX button have something to reach.
 */
function buildCloudInit(opts: CreateContainerOptions): string {
  const users: Record<string, unknown> = {
    name: "root",
    lock_passwd: false,
    ssh_authorized_keys: opts.sshPublicKey ? [opts.sshPublicKey] : [],
  };
  const lines = [
    "#cloud-config",
    "package_update: false",
    "ssh_pwauth: true",
    "disable_root: false",
    "users:",
    `  - ${JSON.stringify(users)}`,
  ];
  if (opts.rootPassword) {
    // chpasswd.expire: false keeps the password usable instead of forcing a
    // first-login change the panel cannot drive.
    lines.push("chpasswd:", "  expire: false", "  list: |", `    root:${opts.rootPassword}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Set the root password inside a container or VM.
 *
 * Piped in over stdin rather than interpolated into a shell string, so a
 * password containing quotes or semicolons cannot turn into a command.
 */
export async function setContainerPassword(name: string, password: string): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") return;

  if (driver.kind === "lxd") {
    await execFileAsync(driver.lxc, ["exec", name, "--", "chpasswd"], 60000, `root:${password}\n`);
    return;
  }
  await execFileAsync(
    driver.bins["lxc-attach"],
    ["-n", name, "--", "chpasswd"],
    60000,
    `root:${password}\n`,
  );
}

/** LXD config keys that make container-in-container (Docker) work unprivileged. */
async function applyLxdDeviceAccess(lxc: string, name: string, opts: CreateContainerOptions): Promise<void> {
  if (!opts.enableKvm && !opts.enableAllDevices && !opts.allowDocker) return;

  const caps = hostCapabilities();

  // Docker in an unprivileged container uses fuse-overlayfs when it is available.
  if ((opts.enableAllDevices || opts.allowDocker) && caps.fuse) {
    // unix-char devices hot-plug, so no restart is needed after launch.
    await execFileAsync(lxc, ["config", "device", "add", name, "fuse", "unix-char", "path=/dev/fuse"], 60000);
  }

  if (opts.enableKvm && caps.kvm) {
    await execFileAsync(lxc, ["config", "device", "add", name, "kvm", "unix-char", "path=/dev/kvm"], 60000);
  }
}

export type PortForward = { hostPort: number; containerPort: number; protocol?: "tcp" | "udp" };

const forwardDevice = (f: PortForward) => `pf-${f.protocol || "tcp"}-${f.hostPort}`;

/**
 * Maps a host port onto a container port so the outside world can reach a
 * service inside the VPS — used for the SSH forward, and available for any
 * other port the owner wants published.
 */
export async function addPortForward(name: string, forward: PortForward): Promise<{ applied: boolean; reason?: string }> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") return { applied: true };

  if (driver.kind === "lxd") {
    const proto = forward.protocol || "tcp";
    await execFileAsync(
      driver.lxc,
      [
        "config", "device", "add", name, forwardDevice(forward), "proxy",
        `listen=${proto}:0.0.0.0:${forward.hostPort}`,
        `connect=${proto}:127.0.0.1:${forward.containerPort}`,
      ],
      60000,
    );
    return { applied: true };
  }

  // The classic tools have no proxy device; a DNAT rule would be needed, and
  // silently editing the host firewall is not something the panel should do.
  return {
    applied: false,
    reason:
      "This host uses the classic container tools, which have no port-forwarding device. " +
      "Add a DNAT rule on the node, or run the panel on a host with the managed runtime.",
  };
}

/** Removes a forward. A device that is already gone counts as removed. */
export async function removePortForward(name: string, forward: PortForward): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") return;
  if (driver.kind !== "lxd") return;
  try {
    await execFileAsync(driver.lxc, ["config", "device", "remove", name, forwardDevice(forward)], 60000);
  } catch {
    // Best effort: the container may already be gone.
  }
}

/** Classic LXC equivalent: raw config entries written before the container starts. */
async function applyClassicDeviceAccess(name: string, opts: CreateContainerOptions): Promise<void> {
  if (!opts.enableKvm && !opts.enableAllDevices && !opts.allowDocker) return;

  const base = await classicLxcPath();
  const configPath = `${base}/${name}/config`;
  const lines = ["", "# IVM Panel device access"];

  if (opts.enableAllDevices || opts.allowDocker) {
    // Docker / FUSE inside the container need an unrestricted profile and caps.
    lines.push("lxc.apparmor.profile = unconfined");
    lines.push("lxc.cap.drop =");
    lines.push("lxc.cgroup2.devices.allow = c 10:229 rwm");
    lines.push("lxc.mount.entry = /dev/fuse dev/fuse none bind,create=file,optional 0 0");
  }

  if (opts.enableKvm) {
    // /dev/kvm is char device 10:232.
    lines.push("lxc.cgroup2.devices.allow = c 10:232 rwm");
    lines.push("lxc.mount.entry = /dev/kvm dev/kvm none bind,create=file,optional 0 0");
  }

  await fs.promises.appendFile(configPath, lines.join("\n") + "\n", "utf-8");
}

export async function createContainer(opts: CreateContainerOptions): Promise<{ name: string }> {
  const driver = await currentDriver();

  if (driver.kind === "simulated") {
    if (hasSimContainer(opts.name)) {
      throw new LxcOperationError(`A container named "${opts.name}" already exists`);
    }
    createSimContainer(opts.name, opts.memoryMb, opts.cpu);
    return { name: opts.name };
  }

  if (driver.kind === "lxd") {
    const image = opts.image || `images:${opts.distro}/${opts.release}`;

    const args = [
      "launch", image, opts.name,
      "-c", `limits.cpu=${opts.cpu}`,
      "-c", `limits.memory=${opts.memoryMb}MiB`,
    ];

    // A virtual machine is the same launch with `--vm`; LXD fetches the image on
    // demand, and cloud-init below handles first-boot setup.
    if (opts.virtualMachine) {
      args.push("--vm");
    }

    // security.nesting is required for both nested virtualisation and running
    // containers inside the container, so it is passed at launch (a later
    // change would need a restart to take effect).
    const needsNesting = opts.enableKvm || opts.enableAllDevices || opts.allowDocker;
    if (needsNesting) {
      args.push("-c", "security.nesting=true");
    }
    if (opts.enableAllDevices || opts.allowDocker) {
      args.push("-c", "security.syscalls.intercept.mknod=true");
      args.push("-c", "security.syscalls.intercept.setxattr=true");
    }

    // Disk size is intentionally not passed: `-d root,size=` fails on the dir
    // storage pool that `lxd init --auto` creates. The requested size is tracked
    // by the panel and enforced on backends that support quotas.
    try {
      await execFileAsync(driver.lxc, args, 30 * 60 * 1000);
      if (opts.virtualMachine) {
        await applyCloudInit(driver.lxc, opts.name, opts);
      }
      await applyLxdDeviceAccess(driver.lxc, opts.name, opts);
    } catch (err) {
      await discardPartialContainer(opts.name);
      throw err;
    }

    return { name: opts.name };
  }

  const args = ["-n", opts.name, "-t", "download"];

  // Loop-backed storage is the only classic backend where a disk size can be
  // enforced here; a directory rootfs has no quota. Opt in with IVM_LXC_STORAGE=loop.
  if ((process.env.IVM_LXC_STORAGE || "dir").toLowerCase() === "loop") {
    args.push("-B", "loop", "--fssize", `${opts.diskGb}G`);
  }
  args.push("--", "-d", opts.distro, "-r", opts.release, "-a", opts.arch);

  await execFileAsync(driver.bins["lxc-create"], args, 30 * 60 * 1000);
  try {
    await applyClassicLimits(opts.name, opts.memoryMb, opts.cpu);
    await applyClassicDeviceAccess(opts.name, opts);
    await execFileAsync(driver.bins["lxc-start"], ["-n", opts.name, "-d"], 120000);
  } catch (err) {
    // Never leave a half-built container behind: a failed start (e.g. the host
    // itself is a container, so nested start is impossible) would otherwise
    // strand a STOPPED rootfs on the node.
    await discardPartialContainer(opts.name);
    throw err;
  }

  return { name: opts.name };
}

/** Installs the cloud-init payload. `--type=user` applies it on first boot. */
async function applyCloudInit(lxc: string, name: string, opts: CreateContainerOptions): Promise<void> {
  await execFileAsync(
    lxc,
    ["config", "set", name, "cloud-init.user-data", "-"],
    60000,
    buildCloudInit(opts),
  );
}

/** Best-effort removal of a container that failed partway through creation. */
async function discardPartialContainer(name: string): Promise<void> {
  try {
    const driver = await currentDriver();
    if (driver.kind === "simulated") return;
    if (driver.kind === "lxd") {
      await execFileAsync(driver.lxc, ["delete", name, "--force"], 180000);
    } else {
      await execFileAsync(driver.bins["lxc-stop"], ["-n", name, "-k"], 60000).catch(() => {});
      await execFileAsync(driver.bins["lxc-destroy"], ["-n", name, "-f"], 180000);
    }
  } catch {
    // Cleanup is best effort; the original error is what the caller needs.
  }
}

export async function startContainer(name: string): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") {
    startSimContainer(name);
    return;
  }
  if (driver.kind === "lxd") {
    await execFileAsync(driver.lxc, ["start", name], 120000);
    return;
  }
  await execFileAsync(driver.bins["lxc-start"], ["-n", name, "-d"], 120000);
}

export async function stopContainer(name: string): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") {
    stopSimContainer(name);
    return;
  }
  if (driver.kind === "lxd") {
    await execFileAsync(driver.lxc, ["stop", name], 120000);
    return;
  }
  await execFileAsync(driver.bins["lxc-stop"], ["-n", name], 120000);
}

export async function restartContainer(name: string): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") {
    stopSimContainer(name);
    startSimContainer(name);
    return;
  }
  if (driver.kind === "lxd") {
    await execFileAsync(driver.lxc, ["restart", name], 120000);
    return;
  }
  await execFileAsync(driver.bins["lxc-stop"], ["-n", name], 120000);
  await execFileAsync(driver.bins["lxc-start"], ["-n", name, "-d"], 120000);
}

/**
 * Runs a shell command inside the container. Returns stdout (empty for
 * simulated containers, which have no real filesystem).
 */
export async function execInContainer(name: string, command: string, timeoutMs = 30000): Promise<string> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") return "";
  if (driver.kind === "lxd") {
    const { stdout } = await execFileAsync(driver.lxc, ["exec", name, "--", "sh", "-c", command], timeoutMs);
    return stdout;
  }
  const attach = await resolveBinary("lxc-attach");
  if (!attach) throw new LxcOperationError("lxc-attach is not available");
  const { stdout } = await execFileAsync(attach, ["-n", name, "--", "sh", "-c", command], timeoutMs);
  return stdout;
}

/** Copies a local file into the container (best effort on simulated containers). */
export async function pushFileToContainer(name: string, localPath: string, targetPath: string): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") return;

  if (driver.kind === "lxd") {
    await execFileAsync(driver.lxc, ["file", "push", localPath, `${name}${targetPath}`], 300000);
    return;
  }

  const attach = await resolveBinary("lxc-attach");
  if (!attach) throw new LxcOperationError("lxc-attach is not available");
  await execFileAsync(
    "sh",
    ["-c", `base64 -w0 ${JSON.stringify(localPath)} | ${attach} -n ${JSON.stringify(name)} -- sh -c 'base64 -d > ${targetPath}'`],
    300000,
  );
}

export async function destroyContainer(name: string): Promise<void> {
  const driver = await currentDriver();
  if (driver.kind === "simulated") {
    destroySimContainer(name);
    return;
  }
  if (driver.kind === "lxd") {
    await execFileAsync(driver.lxc, ["delete", name, "--force"], 180000);
    return;
  }
  await execFileAsync(driver.bins["lxc-destroy"], ["-n", name, "-f"], 180000);
}
