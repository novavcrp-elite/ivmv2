import fs from "fs";
import path from "path";

/**
 * In-panel simulator used when no real container runtime is usable.
 *
 * The panel frequently runs inside a container itself (systemd-detect-virt
 * reports "lxc"), where LXD/LXC cannot create nested containers. This keeps the
 * VPS management UI — records, lifecycle, addresses — fully exercisable while
 * reporting clearly that nothing real was provisioned.
 */

type SimContainer = {
  name: string;
  state: string;
  memoryMb: number;
  cpu: number;
  createdAt: number;
  startedAt: number | null;
};

type SimFile = Record<string, SimContainer>;

const SIM_FILE = path.join(process.cwd(), ".data", "vps-sim.json");

let cache: SimFile | null = null;

function load(): SimFile {
  if (cache) return cache;
  let state: SimFile = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SIM_FILE, "utf-8"));
    if (parsed && typeof parsed === "object") state = parsed;
  } catch {
    state = {};
  }
  cache = state;
  return state;
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(SIM_FILE), { recursive: true });
    fs.writeFileSync(SIM_FILE, JSON.stringify(load(), null, 2));
  } catch {
    // Simulated state is best-effort only.
  }
}

/** Stable fake address per container so the UI shows the same IP on every load. */
export function simulatedIp(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 250;
  return `10.77.0.${10 + hash}`;
}

export function createSimContainer(name: string, memoryMb: number, cpu: number): void {
  load()[name] = { name, state: "RUNNING", memoryMb, cpu, createdAt: Date.now(), startedAt: Date.now() };
  save();
}

export function getSimContainer(name: string): SimContainer | null {
  return load()[name] || null;
}

export function startSimContainer(name: string): void {
  const container = load()[name];
  if (!container) return;
  container.state = "RUNNING";
  container.startedAt = Date.now();
  save();
}

export function stopSimContainer(name: string): void {
  const container = load()[name];
  if (!container) return;
  container.state = "STOPPED";
  container.startedAt = null;
  save();
}

export function destroySimContainer(name: string): void {
  const file = load();
  delete file[name];
  save();
}

export function hasSimContainer(name: string): boolean {
  return Boolean(load()[name]);
}

export type SimInfo = {
  name: string;
  state: string;
  ipv4?: string;
  memoryBytes?: number;
  cpuSeconds?: number;
};

export function listSimContainers(): SimInfo[] {
  return Object.values(load()).map((container) => {
    const running = container.state === "RUNNING";
    return {
      name: container.name,
      state: container.state,
      ipv4: running ? simulatedIp(container.name) : undefined,
      memoryBytes: running ? Math.round(container.memoryMb * 1024 * 1024 * 0.22) : 0,
      cpuSeconds: running && container.startedAt ? Math.floor((Date.now() - container.startedAt) / 1000) : 0,
    };
  });
}

export type SimShellContext = {
  name: string;
  state: string;
  distro?: string;
  release?: string;
  cpu?: number;
  memoryMb?: number;
  diskGb?: number;
  startedAt?: number | null;
};

const SIM_HINT = "This VPS is simulated, so commands are answered by the panel rather than a real kernel.";

function humanUptime(startedAt?: number | null): string {
  if (!startedAt) return "up 0 min";
  const mins = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d > 0 ? `up ${d} days, ${h}:${String(m).padStart(2, "0")}` : h > 0 ? `up ${h}:${String(m).padStart(2, "0")}` : `up ${m} min`;
}

/**
 * A tiny read-only shell so the console can be exercised without a runtime.
 * It deliberately answers a known set of commands and says plainly that it is
 * simulated for anything else, so the UI is testable without pretending to be
 * a real shell.
 */
export function simulatedShell(command: string, ctx: SimShellContext): { stdout: string; stderr: string; exitCode: number } {
  const raw = String(command || "").trim();
  if (!raw) return { stdout: "", stderr: "", exitCode: 0 };

  const [cmd, ...rest] = raw.split(/\s+/);
  const args = rest.join(" ");
  const osName = `${ctx.distro || "ubuntu"} ${ctx.release || ""}`.trim();
  const pretty = /debian/i.test(osName)
    ? `Debian GNU/Linux ${ctx.release || "12"} (bookworm)`
    : `Ubuntu ${ctx.release === "jammy" ? "22.04 LTS (Jammy Jellyfish)" : "24.04 LTS (Noble Numbat)"}`;

  switch (cmd) {
    case "help":
      return {
        stdout: [
          "Simulated console — the following are answered locally:",
          "  help  whoami  hostname  uname  uptime",
          "  cat /etc/os-release   nproc   free -m   df -h",
          "  ls   pwd   echo <text>",
          "",
          SIM_HINT,
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      };
    case "whoami":
      return { stdout: "root", stderr: "", exitCode: 0 };
    case "hostname":
      return { stdout: ctx.name, stderr: "", exitCode: 0 };
    case "pwd":
      return { stdout: "/root", stderr: "", exitCode: 0 };
    case "uname":
      return {
        stdout: `Linux ${ctx.name} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux`,
        stderr: "",
        exitCode: 0,
      };
    case "uptime":
      return {
        stdout: `${new Date().toTimeString().slice(0, 5)} ${humanUptime(ctx.startedAt)},  1 user,  load average: 0.08, 0.04, 0.01`,
        stderr: "",
        exitCode: 0,
      };
    case "nproc":
      return { stdout: String(ctx.cpu || 1), stderr: "", exitCode: 0 };
    case "df": {
      const total = ctx.diskGb || 10;
      const used = Math.max(1, Math.round(total * 0.19));
      return {
        stdout: [
          "Filesystem      Size  Used Avail Use% Mounted on",
          `/dev/rbd0        ${total}G  ${used}G  ${total - used}G  ${Math.round((used / total) * 100)}% /`,
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      };
    }
    case "free": {
      const total = ctx.memoryMb || 1024;
      const used = Math.round(total * 0.22);
      return {
        stdout: [
          "              total        used        free      shared  buff/cache   available",
          `Mem:          ${total}         ${used}        ${total - used - 128}           0         128        ${total - used}`,
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      };
    }
    case "ls":
      return { stdout: "snap  templates", stderr: "", exitCode: 0 };
    case "echo":
      return { stdout: args, stderr: "", exitCode: 0 };
    case "cat":
      if (/os-release/.test(args)) {
        return {
          stdout: [
            `PRETTY_NAME="${pretty}"`,
            `NAME="${/debian/i.test(osName) ? "Debian GNU/Linux" : "Ubuntu"}"`,
            "VERSION_ID=\"24.04\"",
            "ID=ubuntu",
            "HOME_URL=\"https://www.ubuntu.com/\"",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `cat: ${args}: No such file or directory`, exitCode: 1 };
    default:
      return {
        stdout: "",
        stderr: `${cmd}: command not found (simulated console). Type "help" for what is supported.`,
        exitCode: 127,
      };
  }
}
