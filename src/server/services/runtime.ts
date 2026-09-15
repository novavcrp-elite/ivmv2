import {
  createServerContainer,
  startContainer,
  stopContainer,
  restartContainer,
  killContainer,
  deleteContainer,
  getContainerStatus,
  getContainerStats,
  getContainerLogs,
  attachContainerSocket,
  sendContainerCommand,
  requireHostNetwork
} from "./docker.js";

import {
  createLocalServer,
  startLocalServer,
  stopLocalServer,
  killLocalServer,
  restartLocalServer,
  deleteLocalServer,
  getLocalServerStatus,
  getLocalServerStats,
  getLocalServerLogs,
  attachLocalServerSocket,
  sendLocalServerCommand
} from "./local.js";

const DEFAULT_ISSUE_TTL_MS = 5 * 60 * 1000;

/**
 * Recognises container-host failures that are not the panel's doing, so the
 * caller can explain them instead of showing a raw daemon error. The sysctl one
 * is what an unprivileged container host produces: runc opens
 * /proc/sys/net/ipv4/ip_unprivileged_port_start and then reopens it through
 * /proc/self/fd, which the outer sandbox denies, so *no* container can start.
 */
export type HostRuntimeIssue = {
  code: string;
  summary: string;
  detail: string;
  /** The container can still run if it shares the host's network namespace. */
  retryWithHostNetwork?: boolean;
};

export function classifyContainerError(err: any): HostRuntimeIssue | null {
  const message = String(
    err?.message || err?.json?.message || err?.reason || (typeof err === "string" ? err : "") || "",
  );
  if (!message) return null;

  if (/ip_unprivileged_port_start|reopen fd \d+: permission denied/i.test(message)) {
    return {
      code: "CONTAINER_NETNS_DENIED",
      summary: "This host cannot create container network namespaces",
      detail: message,
      retryWithHostNetwork: true,
    };
  }
  if (/cgroup.*(permission denied|read-only)|read-only file system/i.test(message)) {
    return {
      code: "CONTAINER_CGROUP_DENIED",
      summary: "This host cannot create container cgroups",
      detail: message,
    };
  }
  if (/Cannot connect to the Docker daemon|docker daemon is not running/i.test(message)) {
    return {
      code: "CONTAINER_DAEMON_DOWN",
      summary: "The Docker daemon is not reachable",
      detail: message,
    };
  }
  return null;
}

let lastIssue: { at: number; issue: HostRuntimeIssue } | null = null;

function rememberIssue(issue: HostRuntimeIssue) {
  lastIssue = { at: Date.now(), issue };
}

/** The most recent recognised host problem, or null once it has gone stale. */
export function hostRuntimeIssue(ttlMs = DEFAULT_ISSUE_TTL_MS): HostRuntimeIssue | null {
  if (!lastIssue) return null;
  if (Date.now() - lastIssue.at > ttlMs) return null;
  return lastIssue.issue;
}

/**
 * When a container start fails and we fall back to the local runtime, the
 * container itself is already sitting in the daemon in "created" state —
 * `create` and `start` are separate calls. Left alone it holds a name and a
 * writable layer forever. Best-effort release, never fatal to the fallback.
 */
async function releaseStrandedContainer(serverData: any) {
  const containerId = serverData?.containerId;
  const isMock = !containerId || String(containerId).startsWith("mock-container-id-");
  if (isMock) return false;
  try {
    await deleteContainer(containerId, serverData.nodeId);
    console.log(`[runtime] Released stranded container ${containerId} after falling back to local.`);
  } catch (cleanupErr: any) {
    console.warn(`[runtime] Could not release stranded container ${containerId}: ${cleanupErr?.message || cleanupErr}`);
  }
  serverData.containerId = null;
  return true;
}

/** Whether a binary on PATH is executable (used to vet the local runtime). */
async function hasBinary(name: string): Promise<boolean> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    execFile("sh", ["-c", `command -v ${name}`], { timeout: 8000 }, (err, stdout) => {
      resolve(!err && Boolean(String(stdout).trim()));
    });
  });
}

/** Whether the non-container runtime can run this server (needs its language). */
async function localRuntimeViable(serverData: any): Promise<boolean> {
  const type = String(serverData?.type || "").toUpperCase();
  if (type === "NODEJS" || type === "NODE") {
    return Boolean(process.execPath);
  }
  if (type === "PYTHON" || type === "PYTHON3") {
    return (await hasBinary("python3")) || (await hasBinary("python"));
  }
  // Minecraft and anything else: the local runtime shells out to Java, so the
  // fallback is only offered when a matching JRE is actually installed.
  try {
    const { resolveJavaBinary } = await import("./local.js");
    return Boolean(await resolveJavaBinary(serverData?.javaVersion));
  } catch {
    return false;
  }
}

export const createServerRuntime = async (serverData: any, nodeId?: string) => {
  if (serverData.runtimeType === "local") {
    return await createLocalServer(serverData);
  }
  try {
    return await createServerContainer(serverData, nodeId);
  } catch (err: any) {
    // A host that cannot start containers still has the local runtime, so a
    // deploy falls back rather than dead-ending. The switch is recorded on the
    // server so the UI can say what happened.
    const issue = classifyContainerError(err);
    if (!issue) throw err;
    rememberIssue(issue);
    if (!(await localRuntimeViable(serverData))) {
      const wrapped: any = new Error(`${issue.summary}. ${issue.detail}`);
      wrapped.hostIssue = issue;
      throw wrapped;
    }
    await releaseStrandedContainer(serverData);
    serverData.runtimeType = "local";
    serverData.runtimeFallback = {
      from: "docker",
      reason: issue.summary,
      at: new Date().toISOString(),
    };
    console.warn(`[runtime] Container start blocked (${issue.code}); using the local runtime instead.`);
    return await createLocalServer(serverData);
  }
};

export const startServerRuntime = async (server: any) => {
  if (server.runtimeType === "local") {
    return await startLocalServer(server.id, server);
  }

  let failure: any;
  try {
    return await startContainer(server.containerId, server.nodeId);
  } catch (err: any) {
    failure = err;
    const issue = classifyContainerError(err);
    // The container itself is fine — only its private network namespace was
    // refused. Rebuild it sharing the host's network and try once more, which
    // keeps real containers working on hosts that block netns creation.
    if (issue?.retryWithHostNetwork && server.networkMode !== "host") {
      try {
        requireHostNetwork();
        server.networkMode = "host";
        server.containerId = await createServerContainer(server, server.nodeId);
        console.warn("[runtime] Host blocks container network namespaces; retrying with host networking.");
        return await startContainer(server.containerId, server.nodeId);
      } catch (retryErr: any) {
        failure = retryErr;
      }
    }
  }

  // Containers are genuinely unusable here — fall back to the local runtime.
  const issue = classifyContainerError(failure);
  if (!issue) throw failure;
  rememberIssue(issue);
  if (!(await localRuntimeViable(server))) {
    const wrapped: any = new Error(`${issue.summary}. ${issue.detail}`);
    wrapped.hostIssue = issue;
    throw wrapped;
  }
  await releaseStrandedContainer(server);
  server.runtimeType = "local";
  server.runtimeFallback = {
    from: "docker",
    reason: issue.summary,
    at: new Date().toISOString(),
  };
  console.warn(`[runtime] Container start blocked (${issue.code}); starting ${server.id} locally instead.`);
  return await startLocalServer(server.id, server);
};

export const stopServerRuntime = async (server: any) => {
  if (server.runtimeType === "local") {
    return await stopLocalServer(server.id);
  }
  return await stopContainer(server.containerId, server.nodeId);
};

export const restartServerRuntime = async (server: any) => {
  if (server.runtimeType === "local") {
    return await restartLocalServer(server.id, server);
  }
  return await restartContainer(server.containerId, server.nodeId);
};

export const killServerRuntime = async (server: any) => {
  if (server.runtimeType === "local") {
    return await killLocalServer(server.id);
  }
  return await killContainer(server.containerId, server.nodeId);
};

export const deleteServerRuntime = async (server: any) => {
  if (server.runtimeType === "local") {
    return await deleteLocalServer(server.id);
  }
  return await deleteContainer(server.containerId, server.nodeId);
};

export const getServerRuntimeStatus = async (server: any) => {
  if (server.runtimeType === "local") {
    return await getLocalServerStatus(server.id);
  }
  return await getContainerStatus(server.containerId, server.nodeId);
};

export const getServerRuntimeStats = async (server: any) => {
  if (server.runtimeType === "local") {
    return await getLocalServerStats(server.id);
  }
  return await getContainerStats(server.containerId, server.nodeId);
};

export const getServerRuntimeLogs = async (server: any) => {
  if (server.runtimeType === "local") {
    return await getLocalServerLogs(server.id);
  }
  return await getContainerLogs(server.containerId, server.nodeId);
};

export const attachServerRuntimeSocket = async (server: any, serverId: string) => {
  if (server.runtimeType === "local") {
    return attachLocalServerSocket(server.id, serverId);
  }
  return await attachContainerSocket(server.containerId, serverId, server.nodeId);
};

export const sendServerRuntimeCommand = async (server: any, command: string) => {
  if (server.runtimeType === "local") {
    return await sendLocalServerCommand(server.id, command);
  }
  return await sendContainerCommand(server.containerId, command, server.nodeId);
};
