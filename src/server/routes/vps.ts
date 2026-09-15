import { Router } from "express";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { readJSON, writeJSON } from "../services/db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  LXC_ARCHES,
  LXC_TEMPLATES,
  LxcUnavailableError,
  createContainer,
  detectLxc,
  destroyContainer,
  execInContainer,
  hostCapabilities,
  hostVirtualization,
  addPortForward,
  isSimulated,
  listContainers,
  removePortForward,
  pushFileToContainer,
  restartContainer,
  startContainer,
  stopContainer,
} from "../services/lxc.js";
import { getSimContainer, simulatedIp, simulatedShell } from "../services/lxcSim.js";
import { getPublicIPv4 } from "../services/publicIp.js";

const upload = multer({ dest: path.join(process.cwd(), ".data/temp/") });

const FILES_ROOT = path.join(process.cwd(), ".data", "vps-files");

function vpsDir(containerName: string): string {
  return path.join(FILES_ROOT, containerName);
}

/** Blocks traversal and absolute paths coming from the client. */
function safeName(raw: unknown): string | null {
  const name = String(raw || "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") return null;
  return name;
}

const router = Router();

const VPS_FILE = "vps.json";

// LXD install (the INSTALL NOW button) runs detached and reports through these files.
const INSTALL_LOG = "/tmp/ivm-lxd-install.log";
const INSTALL_EXIT = "/tmp/ivm-lxd-install.exit";
const INSTALL_STARTED = "/tmp/ivm-lxd-install.started";
const INSTALL_STALE_MS = 30 * 60 * 1000;

router.use(requireAuth);

// The whole Virtual Private Servers category is admin/owner only.
router.use((req, res, next) => {
  const user = (req as any).user;
  if (!user || (user.role !== "admin" && user.role !== "owner")) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  next();
});

const readVps = async (): Promise<any[]> => (await readJSON(VPS_FILE)) || [];
const writeVps = async (records: any[]) => writeJSON(VPS_FILE, records);

/** LXC names allow letters, digits, ".", "_" and "-", and cannot start with a separator. */
function sanitizeContainerName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[._-]+$/, "");
  return (cleaned || "vps").slice(0, 40);
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function failure(res: any, err: any) {
  if (err instanceof LxcUnavailableError) {
    return res.status(503).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({
    error: err?.message || "The container operation failed",
    detail: err?.detail || undefined,
  });
}

/* ------------------------- port allocation ------------------------- */

const PORT_RANGE_MIN = 1024;
const PORT_RANGE_MAX = 65535;
/** A range wider than this is refused: each published port costs a device. */
const MAX_RANGE_SPAN = 100;
const RANGE_START = 30000;

/** Host ports already spoken for by VPS forwards, VPS ranges and game servers. */
async function usedHostPorts(): Promise<Set<number>> {
  const [vps, servers] = await Promise.all([readVps(), readJSON("servers.json")]);
  const used = new Set<number>();
  for (const v of vps as any[]) {
    if (v?.sshForward?.hostPort) used.add(Number(v.sshForward.hostPort));
    if (v?.portRange?.from && v?.portRange?.to) {
      for (let p = Number(v.portRange.from); p <= Number(v.portRange.to); p++) used.add(p);
    }
  }
  for (const s of (servers || []) as any[]) {
    if (s?.port) used.add(Number(s.port));
  }
  return used;
}

/** First free contiguous block of `span` ports at or above `start`. */
function findFreeRange(used: Set<number>, span: number, start = RANGE_START): { from: number; to: number } | null {
  for (let from = start; from + span - 1 <= PORT_RANGE_MAX; from++) {
    let free = true;
    for (let p = from; p < from + span; p++) {
      if (used.has(p)) {
        free = false;
        // Resume scanning just past the conflict instead of stepping one by one.
        from = p;
        break;
      }
    }
    if (free) return { from, to: from + span - 1 };
  }
  return null;
}

function findFreePort(used: Set<number>, start = RANGE_START): number | null {
  for (let p = start; p <= PORT_RANGE_MAX; p++) if (!used.has(p)) return p;
  return null;
}

// Driver availability + the image catalog the deploy wizard renders.
router.get("/status", async (_req, res) => {
  const status = await detectLxc(true);
  const caps = hostCapabilities();
  res.json({
    ...status,
    templates: LXC_TEMPLATES,
    arches: LXC_ARCHES,
    // Capabilities are reported honestly; the wizard only uses them to decide
    // whether a real container could take the device.
    hostKvm: caps.kvm,
    hostFuse: caps.fuse,
    canProvision: status.canProvision,
    // e.g. "lxc" when the panel itself runs inside a container, where nested
    // containers cannot be created and the LXD install will not work.
    hostVirt: await hostVirtualization(),
  });
});

function installRunning(): boolean {
  try {
    if (fs.existsSync(INSTALL_EXIT)) return false;
    if (!fs.existsSync(INSTALL_STARTED)) return false;
    // Guard against a crashed installer leaving the marker behind forever.
    const logStat = fs.existsSync(INSTALL_LOG) ? fs.statSync(INSTALL_LOG) : fs.statSync(INSTALL_STARTED);
    return Date.now() - logStat.mtimeMs < INSTALL_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * One-click LXD install. `apt-get install -y snap` would be a no-op on Ubuntu
 * (that package installs no snap binary) so snapd is installed instead.
 */
router.post("/install", (_req, res) => {
  if (installRunning()) {
    return res.status(409).json({ error: "An LXD installation is already running" });
  }

  const commands = [
    "apt-get update",
    "apt-get upgrade -y",
    "apt-get install -y snapd",
    "snap install lxd",
    "lxd init --auto",
  ];

  const script = `set -o pipefail; rm -f ${INSTALL_EXIT}; date +%s > ${INSTALL_STARTED}; { ${commands.join(" && ")}; } > ${INSTALL_LOG} 2>&1; echo $? > ${INSTALL_EXIT}`;

  try {
    const child = spawn("bash", ["-lc", script], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to start the LXD installation" });
  }

  res.json({ success: true, log: INSTALL_LOG, commands });
});

router.get("/install-status", async (_req, res) => {
  let log = "";
  try {
    log = await fs.promises.readFile(INSTALL_LOG, "utf-8");
  } catch {
    log = "";
  }

  let exitCode: number | null = null;
  try {
    const raw = (await fs.promises.readFile(INSTALL_EXIT, "utf-8")).trim();
    const parsed = parseInt(raw, 10);
    if (isFinite(parsed)) exitCode = parsed;
  } catch {
    exitCode = null;
  }

  const status = await detectLxc(true);

  res.json({
    running: installRunning(),
    exitCode,
    log: log.slice(-8000),
    available: status.available,
    driver: status.driver,
    reason: status.reason,
  });
});

// Stored VPS records joined with live container state.
router.get("/", async (_req, res) => {
  const records = await readVps();
  const status = await detectLxc();

  let liveByName = new Map<string, any>();
  if (status.canProvision && records.length > 0) {
    try {
      const { listContainers } = await import("../services/lxc.js");
      const live = await listContainers();
      liveByName = new Map(live.map((c: any) => [c.name, c]));
    } catch {
      liveByName = new Map();
    }
  }

  const items = records.map((record: any) => {
    const live = liveByName.get(record.containerName);
    return {
      ...record,
      status: live ? live.state : "MISSING",
      live: live || null,
    };
  });

  res.json({
    available: status.available,
    simulated: status.simulated,
    canProvision: status.canProvision,
    driver: status.driver,
    reason: status.reason,
    items,
  });
});

// Creating a VPS provisions a real LXC container on the panel host.
// Deliberately excludes look-alike characters (l/1/I, O/0) so a password read
// off the screen and typed elsewhere is not ambiguous.
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

router.post("/", async (req, res) => {
  const status = await detectLxc(true);
  if (!status.canProvision) {
    return res.status(503).json({ error: status.reason || "No container runtime is available on this host", code: "LXC_UNAVAILABLE" });
  }
  const simulated = status.simulated;

  const body = req.body || {};
  const displayName = String(body.name || "").trim();
  if (!displayName) return res.status(400).json({ error: "VPS name is required" });
  if (displayName.length > 40) return res.status(400).json({ error: "VPS name must be 40 characters or fewer" });

  const template = LXC_TEMPLATES.find(
    (t) => t.distro === body.distro && t.release === String(body.release || ""),
  );
  if (!template && !(body.distro && body.release)) {
    return res.status(400).json({ error: "A valid OS template is required" });
  }

  const distro = template ? template.distro : String(body.distro);
  const release = template ? template.release : String(body.release);
  const arch = LXC_ARCHES.includes(body.arch) ? body.arch : "amd64";
  const cpu = clampInt(body.cpu, 1, 64, 1);
  const memoryMb = clampInt(body.memoryMb, 128, 131072, 1024);
  const diskGb = clampInt(body.diskGb, 1, 2000, 10);
  const enableKvm = body.enableKvm === true;
  const enableAllDevices = body.enableAllDevices === true;
  const allowDocker = body.allowDocker === true;

  // A virtual machine is the same provisioning flow with a different guest.
  // It gets a DHCP address on the managed bridge, so it has no public IPv4
  // either. Hosts without /dev/kvm cannot boot one, which is reported plainly
  // rather than faked.
  const kind: "vm" | "container" = body.kind === "vm" ? "vm" : "container";
  const isVm = kind === "vm";
  if (isVm && !simulated && !hostCapabilities().kvm) {
    return res.status(400).json({
      error:
        "This host exposes no /dev/kvm, so virtual machines cannot be booted here. " +
        "Enable nested virtualisation on the host, or deploy a container instead.",
      code: "KVM_UNAVAILABLE",
    });
  }

  // VMs are configured at first boot, so they need a credential up front.
  const rootPassword = isVm ? generatePassword(20) : undefined;

  // /dev/kvm has to exist on the host before a container can be handed it.
  // Simulated containers skip this, so the UI stays fully exercisable.
  if (enableKvm && !simulated && !hostCapabilities().kvm) {
    return res.status(400).json({
      error: "This host exposes no /dev/kvm, so KVM (nested virtualisation) cannot be enabled. The host needs nested virtualisation enabled by the provider.",
    });
  }

  // Port allocation. An explicit range is honoured, otherwise a free block is
  // reserved so two VPS never advertise the same ports.
  const usedPorts = await usedHostPorts();
  const requestedFrom = clampInt(body.portFrom, 0, PORT_RANGE_MAX, 0);
  const requestedTo = clampInt(body.portTo, 0, PORT_RANGE_MAX, 0);
  let portRange: { from: number; to: number } | null = null;

  if (requestedFrom || requestedTo) {
    if (!requestedFrom || !requestedTo) {
      return res.status(400).json({ error: "Enter both ends of the port range" });
    }
    if (requestedFrom < PORT_RANGE_MIN || requestedTo > PORT_RANGE_MAX) {
      return res.status(400).json({ error: `Ports must be between ${PORT_RANGE_MIN} and ${PORT_RANGE_MAX}` });
    }
    if (requestedTo < requestedFrom) {
      return res.status(400).json({ error: "The end of the port range must not be lower than its start" });
    }
    if (requestedTo - requestedFrom + 1 > MAX_RANGE_SPAN) {
      return res.status(400).json({ error: `A port range may cover at most ${MAX_RANGE_SPAN} ports` });
    }
    for (let p = requestedFrom; p <= requestedTo; p++) {
      if (usedPorts.has(p)) {
        return res.status(409).json({ error: `Port ${p} is already allocated on this host` });
      }
    }
    portRange = { from: requestedFrom, to: requestedTo };
  } else {
    portRange = findFreeRange(usedPorts, 10);
    if (!portRange) {
      return res.status(409).json({ error: "No free port range is available on this host" });
    }
  }
  portRange.from && portRange.to && [portRange.from, portRange.to].forEach((p) => usedPorts.add(p));

  // One host port is published to the VPS SSH port so the owner can log in from
  // outside without a public IPv4 on the container itself.
  const sshHostPort = body.sshHostPort ? clampInt(body.sshHostPort, PORT_RANGE_MIN, PORT_RANGE_MAX, 0) : 0;
  if (body.sshHostPort && !sshHostPort) {
    return res.status(400).json({ error: `The SSH port must be between ${PORT_RANGE_MIN} and ${PORT_RANGE_MAX}` });
  }
  if (sshHostPort && usedPorts.has(sshHostPort)) {
    return res.status(409).json({ error: `Port ${sshHostPort} is already allocated on this host` });
  }
  const resolvedSshPort = sshHostPort || findFreePort(usedPorts);
  if (!resolvedSshPort) {
    return res.status(409).json({ error: "No free port is available for the SSH forward" });
  }
  usedPorts.add(resolvedSshPort);

  const containerName = sanitizeContainerName(displayName);

  const records = await readVps();
  if (records.some((r: any) => r.containerName === containerName)) {
    return res.status(409).json({ error: `A VPS named "${containerName}" already exists` });
  }

  // Guard against colliding with a container that exists in LXC but not in our store.
  try {
    const { listContainers } = await import("../services/lxc.js");
    const live = await listContainers();
    if (live.some((c: any) => c.name === containerName)) {
      return res.status(409).json({ error: `A container named "${containerName}" already exists on this host` });
    }
  } catch {
    // If the listing fails we still let the create attempt surface the real error.
  }

  try {
    await createContainer({
      name: containerName,
      distro,
      release,
      arch,
      cpu,
      memoryMb,
      diskGb,
      image: template?.image,
      enableKvm,
      enableAllDevices,
      allowDocker,
      simulated,
      virtualMachine: isVm,
      rootPassword,
    });

    const record = {
      id: uuidv4(),
      name: displayName,
      containerName,
      distro,
      release,
      arch,
      cpu,
      memoryMb,
      diskGb,
      nodeId: typeof body.nodeId === "string" ? body.nodeId : "",
      cpuModel: typeof body.cpuModel === "string" ? body.cpuModel.slice(0, 80) : "",
      motherboard: typeof body.motherboard === "string" ? body.motherboard.slice(0, 80) : "",
      // Containers only ever sit on the private bridge — no public IPv4.
      networkMode: "private-bridge",
      bridge: typeof body.bridge === "string" && body.bridge ? body.bridge : "lxdbr0",
      kind,
      // The VM's first-boot credential. Kept on the record so the owner can read
      // it and rotate it, exactly like the container SSH password.
      ...(isVm ? { rootPassword } : {}),
      portRange,
      sshForward: { hostPort: resolvedSshPort, containerPort: 22, protocol: "tcp" as const },
      sshForwardApplied: false,
      sshForwardNote: "",
      enableKvm,
      enableAllDevices,
      allowDocker,
      simulated,
      owner: (req as any).user.id,
      createdAt: new Date().toISOString(),
    };

    // Publish the SSH port. A failure here must not lose the VPS, so the result
    // is recorded on the record and surfaced in the UI instead.
    try {
      const result = await addPortForward(containerName, {
        hostPort: resolvedSshPort,
        containerPort: 22,
        protocol: "tcp",
      });
      record.sshForwardApplied = result.applied;
      record.sshForwardNote = result.reason || "";
    } catch (err: any) {
      record.sshForwardApplied = false;
      record.sshForwardNote =
        err?.detail || err?.message || "The SSH port could not be published on this host.";
    }

    records.push(record);
    await writeVps(records);
    res.json({ success: true, vps: record });
  } catch (err: any) {
    failure(res, err);
  }
});

/** A single VPS with its live state, for the manage page. */
router.get("/:id", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  let live: any = null;
  try {
    live = (await listContainers()).find((c: any) => c.name === record.containerName) || null;
  } catch {
    live = null;
  }

  res.json({
    ...record,
    // A record whose container is gone reports its stored state rather than
    // claiming something that is not there.
    status: live ? String(live.state || "").toUpperCase() : record.status || "MISSING",
    live,
  });
});

/**
 * Runs a command inside the VPS. Without a runtime the request is answered by
 * the in-panel simulated shell so the console stays usable for testing.
 */
router.post("/:id/console", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ error: "Enter a command" });
  if (command.length > 2000) return res.status(400).json({ error: "That command is too long" });

  const simulated = await isSimulated();
  if (simulated) {
    const state = getSimContainer(record.containerName);
    if (!state || state.state !== "RUNNING") {
      return res.status(409).json({
        error: "The VPS is stopped. Start it before running commands.",
        code: "VPS_NOT_RUNNING",
      });
    }
    const result = simulatedShell(command, {
      name: record.containerName,
      state: state.state,
      distro: record.distro,
      release: record.release,
      cpu: record.cpu,
      memoryMb: record.memoryMb,
      diskGb: record.diskGb,
      startedAt: state.startedAt,
    });
    return res.json({ ...result, simulated: true });
  }

  // A real container has to be running before anything can be executed in it.
  try {
    const live = (await listContainers()).find((c: any) => c.name === record.containerName);
    if (!live || !/running/i.test(String(live.state || ""))) {
      return res.status(409).json({
        error: "The VPS is not running. Start it before running commands.",
        code: "VPS_NOT_RUNNING",
      });
    }
  } catch {
    // Fall through and let the exec attempt report the real problem.
  }

  try {
    const stdout = await execInContainer(record.containerName, command, 60000);
    res.json({ stdout, stderr: "", exitCode: 0, simulated: false });
  } catch (err: any) {
    const detail = err?.detail || "";
    res.json({
      stdout: "",
      stderr: detail || err?.message || "The command could not be run inside the VPS.",
      exitCode: typeof err?.exitCode === "number" ? err.exitCode : 1,
      simulated: false,
    });
  }
});

/**
 * Promotes a simulated VPS to a real deployment, keeping the same record (and so
 * the same manage URL). The record is only rewritten once provisioning succeeds,
 * so a failed conversion leaves the test VPS exactly as it was.
 */
router.post("/:id/convert", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });
  if (!record.simulated) {
    return res.status(409).json({ error: "This VPS is already a real deployment" });
  }

  const status = await detectLxc(true);
  if (status.simulated || status.nestedBlocked) {
    return res.status(503).json({
      error:
        status.reason ||
        "This host cannot create a real container, so the VPS stays simulated. Run the panel on a virtual machine or dedicated host.",
      code: "LXC_UNAVAILABLE",
    });
  }

  try {
    await createContainer({
      name: record.containerName,
      distro: record.distro,
      release: record.release,
      arch: record.arch || "amd64",
      cpu: record.cpu,
      memoryMb: record.memoryMb,
      diskGb: record.diskGb,
      enableKvm: record.enableKvm === true,
      enableAllDevices: record.enableAllDevices === true,
      allowDocker: record.allowDocker === true,
      simulated: false,
    });

    // The SSH forward and the simulated identity both need to be rebuilt.
    if (record.sshForward) {
      try {
        const result = await addPortForward(record.containerName, {
          hostPort: Number(record.sshForward.hostPort),
          containerPort: Number(record.sshForward.containerPort) || 22,
          protocol: "tcp",
        });
        record.sshForwardApplied = result.applied;
        record.sshForwardNote = result.reason || "";
      } catch (err: any) {
        record.sshForwardApplied = false;
        record.sshForwardNote = err?.detail || err?.message || "The SSH port could not be published.";
      }
    }

    record.simulated = false;
    record.status = "RUNNING";
    record.convertedAt = new Date().toISOString();
    record.sshPassword = crypto.randomBytes(12).toString("base64url");
    await writeVps(records);

    res.json({ success: true, vps: record });
  } catch (err: any) {
    failure(res, err);
  }
});

async function withRecord(req: any, res: any, action: (record: any) => Promise<void>) {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });
  try {
    await action(record);
  } catch (err: any) {
    return failure(res, err);
  }
}

router.post("/:id/start", (req, res) =>
  withRecord(req, res, async (record) => {
    await startContainer(record.containerName);
    res.json({ success: true });
  }),
);

router.post("/:id/stop", (req, res) =>
  withRecord(req, res, async (record) => {
    await stopContainer(record.containerName);
    res.json({ success: true });
  }),
);

router.post("/:id/restart", (req, res) =>
  withRecord(req, res, async (record) => {
    await restartContainer(record.containerName);
    res.json({ success: true });
  }),
);

router.delete("/:id", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  try {
    await destroyContainer(record.containerName);
  } catch (err: any) {
    // A container that no longer exists should still be removable from the panel.
    // Classic LXC words this as "Container is not defined", LXD as "not found".
    const info = err?.detail || err?.message || "";
    const gone =
      /does not exist|no such container|not found|not defined|is not running/i.test(String(info)) ||
      /does not exist|no such container|not found|not defined|is not running/i.test(String(err?.message || ""));
    if (!gone) return failure(res, err);
  }

  // Container deletion takes its proxy devices with it; drop it explicitly too in
  // case the container was already gone but the device was not.
  if (record.sshForward) {
    await removePortForward(record.containerName, {
      hostPort: Number(record.sshForward.hostPort),
      containerPort: Number(record.sshForward.containerPort) || 22,
      protocol: "tcp",
    });
  }

  await writeVps(records.filter((r: any) => r.id !== req.params.id));
  res.json({ success: true });
});

/** Reinstalls the OS: destroys the container and recreates it with a new image. */
router.post("/:id/reinstall", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  const status = await detectLxc(true);
  if (!status.canProvision) {
    return res.status(503).json({ error: status.reason || "No container runtime available", code: "LXC_UNAVAILABLE" });
  }

  const template = LXC_TEMPLATES.find(
    (t) => t.distro === req.body?.distro && t.release === String(req.body?.release || ""),
  );
  if (!template) return res.status(400).json({ error: "Choose one of the available OS images" });

  try {
    await destroyContainer(record.containerName);
    await createContainer({
      name: record.containerName,
      distro: template.distro,
      release: template.release,
      arch: record.arch || "amd64",
      cpu: record.cpu,
      memoryMb: record.memoryMb,
      diskGb: record.diskGb,
      image: template.image,
      enableKvm: record.enableKvm === true,
      enableAllDevices: record.enableAllDevices === true,
      allowDocker: record.allowDocker === true,
    });

    record.distro = template.distro;
    record.release = template.release;
    record.reinstalledAt = new Date().toISOString();
    record.sshPassword = crypto.randomBytes(12).toString("base64url");
    await writeVps(records);

    res.json({ success: true, vps: record });
  } catch (err: any) {
    failure(res, err);
  }
});

/** SSH connection details for the VPS (one credential set per container). */
router.get("/:id/ssh", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  if (!record.sshPassword) {
    record.sshPassword = crypto.randomBytes(12).toString("base64url");
    await writeVps(records);
  }

  // The published host port is what the outside world connects to; the node's
  // public address is the other half of that pair.
  const forward = record.sshForward || null;
  let publicIp = "";
  if (forward) {
    try {
      const info = await getPublicIPv4();
      publicIp = info.ip || "";
    } catch {
      publicIp = "";
    }
  }
  const forwardedOffer = forward
    ? {
        forwardHostPort: Number(forward.hostPort),
        forwardHost: publicIp,
        forwardCommand: publicIp
          ? `ssh root@${publicIp} -p ${forward.hostPort}`
          : `ssh root@<node-address> -p ${forward.hostPort}`,
        forwardApplied: record.sshForwardApplied === true,
        forwardNote: record.sshForwardNote || "",
      }
    : {};

  if (await isSimulated()) {
    return res.json({
      host: simulatedIp(record.containerName),
      port: 22,
      username: "root",
      password: record.sshPassword,
      command: `ssh root@${simulatedIp(record.containerName)}`,
      simulated: true,
      ...forwardedOffer,
    });
  }

  let host = "";
  try {
    const live = (await listContainers()).find((c) => c.name === record.containerName);
    host = live?.ipv4 || "";
  } catch {
    host = "";
  }

  // Best effort: set the root password and start sshd inside the container.
  try {
    await execInContainer(
      record.containerName,
      `echo 'root:${record.sshPassword}' | chpasswd; (systemctl enable --now ssh || systemctl enable --now sshd || service ssh start) >/dev/null 2>&1; echo ok`,
      60000,
    );
  } catch {
    // The container may not have sshd installed yet; credentials are still valid.
  }

  res.json({
    host,
    port: 22,
    username: "root",
    password: record.sshPassword,
    command: host ? `ssh root@${host}` : "",
    simulated: false,
    ...forwardedOffer,
  });
});

/** Panel-managed file store for a VPS (also pushed into the container when real). */
router.get("/:id/files", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  const dir = vpsDir(record.containerName);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const stat = await fs.promises.stat(path.join(dir, e.name));
          return { name: e.name, size: stat.size, modified: stat.mtime.toISOString() };
        }),
    );
    res.json({ files: files.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to list files" });
  }
});

router.post("/:id/files", upload.single("file"), async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const name = safeName(req.file.originalname);
  if (!name) return res.status(400).json({ error: "Invalid file name" });

  const dir = vpsDir(record.containerName);
  const target = path.join(dir, name);

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.copyFile(req.file.path, target);

    // Real containers also receive the file at /root/<name>.
    try {
      await pushFileToContainer(record.containerName, req.file.path, `/root/${name}`);
    } catch {
      // Non-fatal: the file is still stored by the panel.
    }

    res.json({ success: true, file: { name, size: req.file.size } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to store the file" });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

router.get("/:id/files/download", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  const name = safeName(req.query.name);
  if (!name) return res.status(400).json({ error: "Invalid file name" });

  const target = path.join(vpsDir(record.containerName), name);
  if (!fs.existsSync(target)) return res.status(404).json({ error: "File not found" });
  res.download(target, name);
});

router.delete("/:id/files", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  const name = safeName(req.query.name);
  if (!name) return res.status(400).json({ error: "Invalid file name" });

  try {
    await fs.promises.unlink(path.join(vpsDir(record.containerName), name));
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: "File not found" });
  }
});

/**
 * Mining telemetry for the VPS. Reads an XMRig-compatible HTTP API running
 * inside the container (default port 18080) and normalises the summary.
 */
router.get("/:id/mining", async (req, res) => {
  const records = await readVps();
  const record = records.find((r: any) => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: "VPS not found" });

  const port = Math.max(1, Math.min(65535, Number(req.query.port) || 18080));

  if (await isSimulated()) {
    const hashrate = 4200 + (record.cpu || 1) * 850;
    return res.json({
      detected: true,
      simulated: true,
      apiPort: port,
      algorithm: "rx/0",
      hashrate,
      sharesGood: 118,
      sharesTotal: 121,
      uptimeSeconds: 5400,
      pool: "pool.example.net:3333",
      difficulty: 480045,
    });
  }

  // Reading the miner API needs a live container, so say that plainly instead of
  // surfacing a raw command failure.
  let containerRunning = false;
  try {
    const live = (await listContainers()).find((c) => c.name === record.containerName);
    containerRunning = /running/i.test(String(live?.state || ""));
  } catch {
    containerRunning = false;
  }
  if (!containerRunning) {
    return res.json({
      detected: false,
      simulated: false,
      apiPort: port,
      reason:
        record.status === "RUNNING"
          ? "The VPS is not reporting as running yet — start it and try again."
          : "The VPS is stopped. Start it before reading miner telemetry.",
    });
  }

  try {
    const raw = await execInContainer(
      record.containerName,
      `curl -s --max-time 6 http://127.0.0.1:${port}/2/summary || true`,
      20000,
    );
    const parsed = JSON.parse(raw || "{}");
    const results = parsed?.results || {};
    const hashrateSeries = results?.hashrate?.total;
    const hashrate = Array.isArray(hashrateSeries) ? hashrateSeries[hashrateSeries.length - 1] || 0 : 0;
    const shares = results?.shares || [];
    const good = shares.reduce((n: number, s: any) => n + (s?.accepted || 0), 0);
    const total = shares.reduce((n: number, s: any) => n + (s?.total || 0), 0);
    const pool = parsed?.connection?.pool || results?.connection?.pool || "";

    res.json({
      detected: Boolean(raw && raw.trim()),
      simulated: false,
      apiPort: port,
      algorithm: parsed?.algo || results?.algorithm || "",
      hashrate,
      sharesGood: good,
      sharesTotal: total,
      uptimeSeconds: Number(results?.uptime || parsed?.uptime || 0),
      pool,
      difficulty: Number(results?.difficulty || 0),
    });
  } catch (err: any) {
    res.json({
      detected: false,
      simulated: false,
      apiPort: port,
      reason:
        err?.detail ||
        err?.message ||
        `No miner API responded on port ${port} inside the VPS.`,
    });
  }
});

export default router;
