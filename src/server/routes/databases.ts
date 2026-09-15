import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { readJSON, writeJSON } from "../services/db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import {
  MysqlError,
  buildNames,
  clampPort,
  createDatabaseWithUser,
  dropDatabaseWithUser,
  generatePassword,
  showDatabases,
  testConnection,
  type DatabaseHost,
} from "../services/mysql.js";

const HOSTS_FILE = "database_hosts.json";
const ALLOCATIONS_FILE = "databases.json";

const readHosts = async (): Promise<DatabaseHost[]> => (await readJSON(HOSTS_FILE)) || [];
const readAllocations = async (): Promise<any[]> => (await readJSON(ALLOCATIONS_FILE)) || [];
const readServers = async (): Promise<any[]> => (await readJSON("servers.json")) || [];

const isAdmin = (req: any) => {
  const role = req?.user?.role;
  return role === "admin" || role === "owner";
};

/** The authenticated user's id (Express's Request is not augmented here). */
const userId = (req: any): string | undefined => (req as any)?.user?.id;

/** Credentials never leave the server; the UI only needs to know one is set. */
function publicHost(host: DatabaseHost) {
  const { password, ...rest } = host;
  return { ...rest, hasPassword: Boolean(password) };
}

function failure(res: any, err: any) {
  if (err instanceof MysqlError) {
    const status = err.code === "MYSQL_CONNECT_FAILED" ? 502 : 400;
    return res.status(status).json({ error: err.message, code: err.code, detail: err.detail });
  }
  return res.status(500).json({ error: err?.message || "The database operation failed" });
}

function validateHostInput(body: any, { requirePassword }: { requirePassword: boolean }) {
  const name = String(body?.name ?? "").trim();
  const host = String(body?.host ?? "").trim();
  const username = String(body?.username ?? "").trim();
  const password = typeof body?.password === "string" ? body.password : undefined;
  const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : undefined;

  if (!name) return { error: "A database nickname is required" };
  if (name.length > 60) return { error: "The nickname must be 60 characters or fewer" };
  if (!host) return { error: "A host address is required" };
  if (!username) return { error: "A database username is required" };
  if (requirePassword && !password) return { error: "A database password is required" };

  return { value: { name, host, username, password, nodeId, port: clampPort(body?.port) } };
}

/* ------------------------------------------------------------------ *
 * Admin: database hosts (the MySQL servers the panel provisions on)
 * ------------------------------------------------------------------ */

export const databaseHostRoutes = Router();

databaseHostRoutes.use(requireAuth);

databaseHostRoutes.get("/", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden: Admin access required" });
  const [hosts, allocations, nodes] = await Promise.all([readHosts(), readAllocations(), readJSON("nodes.json")]);
  const nodeList = (nodes || []) as any[];
  res.json(
    hosts.map((h) => ({
      ...publicHost(h),
      nodeName:
        h.nodeId === "local"
          ? "Built-in Node (Local)"
          : nodeList.find((n: any) => n.id === h.nodeId)?.name || (h.nodeId ? "Unknown node" : ""),
      databaseCount: allocations.filter((a) => a.hostId === h.id).length,
    })),
  );
});

databaseHostRoutes.post("/", requireAdmin, async (req, res) => {
  const parsed = validateHostInput(req.body, { requirePassword: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const input = parsed.value!;

  const hosts = await readHosts();
  if (hosts.some((h) => h.name.toLowerCase() === input.name.toLowerCase())) {
    return res.status(409).json({ error: `A database host named "${input.name}" already exists` });
  }

  const host: DatabaseHost = {
    id: uuidv4(),
    name: input.name,
    host: input.host,
    port: input.port!,
    username: input.username,
    password: input.password!,
    nodeId: input.nodeId || undefined,
    createdAt: new Date().toISOString(),
  };

  // Verify before saving so a typo cannot silently sit in the panel forever.
  try {
    await testConnection(host);
  } catch (err: any) {
    return failure(res, err);
  }

  hosts.push(host);
  await writeJSON(HOSTS_FILE, hosts);
  res.status(201).json({ success: true, host: publicHost(host) });
});

databaseHostRoutes.put("/:id", requireAdmin, async (req, res) => {
  const hosts = await readHosts();
  const host = hosts.find((h) => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: "Database host not found" });

  const parsed = validateHostInput({ ...publicHost(host), port: host.port, ...req.body }, { requirePassword: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const input = parsed.value!;

  host.name = input.name;
  host.host = input.host;
  host.port = input.port!;
  host.username = input.username;
  // An omitted or blank password keeps the stored one, so the form can be saved
  // without re-typing the secret.
  if (input.password) host.password = input.password;
  host.nodeId = input.nodeId || undefined;

  await writeJSON(HOSTS_FILE, hosts);
  res.json({ success: true, host: publicHost(host) });
});

databaseHostRoutes.post("/:id/test", requireAdmin, async (req, res) => {
  const hosts = await readHosts();
  const host = hosts.find((h) => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: "Database host not found" });
  try {
    const { version } = await testConnection(host);
    res.json({ success: true, version });
  } catch (err: any) {
    failure(res, err);
  }
});

databaseHostRoutes.get("/:id/schemas", requireAdmin, async (req, res) => {
  const hosts = await readHosts();
  const host = hosts.find((h) => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: "Database host not found" });
  try {
    res.json({ schemas: await showDatabases(host) });
  } catch (err: any) {
    failure(res, err);
  }
});

databaseHostRoutes.delete("/:id", requireAdmin, async (req, res) => {
  const hosts = await readHosts();
  const host = hosts.find((h) => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: "Database host not found" });

  const allocations = await readAllocations();
  if (allocations.some((a) => a.hostId === host.id)) {
    return res.status(409).json({
      error: "This host still has databases on it. Delete those databases first.",
    });
  }

  await writeJSON(
    HOSTS_FILE,
    hosts.filter((h) => h.id !== host.id),
  );
  res.json({ success: true });
});

/* --------------------------------------------------------- *
 * Per-server databases (what a game server owner creates)
 * --------------------------------------------------------- */

export const databaseRoutes = Router();

databaseRoutes.use(requireAuth);

const DEFAULT_LIMIT = 5;

async function limitFor(server: any): Promise<number> {
  const override = Number(server?.databaseLimit);
  if (isFinite(override) && override >= 0) return override;
  const settings = (await readJSON("settings.json")) || {};
  const fallback = Number(settings.databaseLimit);
  return isFinite(fallback) && fallback >= 0 ? fallback : DEFAULT_LIMIT;
}

function scopeToUser(req: any, rows: any[], servers: any[]) {
  if (isAdmin(req)) return rows;
  const mine = new Set(servers.filter((s: any) => s.owner === userId(req)).map((s: any) => s.id));
  return rows.filter((r) => mine.has(r.serverId));
}

databaseRoutes.get("/", async (req, res) => {
  const [allocations, servers, hosts] = await Promise.all([readAllocations(), readServers(), readHosts()]);
  const visible = scopeToUser(req, allocations, servers);
  res.json(
    visible.map((a) => ({
      ...a,
      serverName: servers.find((s: any) => s.id === a.serverId)?.name || a.serverName || "Unknown server",
      hostName: hosts.find((h) => h.id === a.hostId)?.name || a.hostName || "Unknown host",
      hostAddress: hosts.find((h) => h.id === a.hostId)?.host || a.hostAddress || "",
      hostPort: hosts.find((h) => h.id === a.hostId)?.port ?? a.hostPort ?? 3306,
    })),
  );
});

/** Servers the caller may create a database for, with their remaining quota. */
databaseRoutes.get("/servers", async (req, res) => {
  const [servers, allocations] = await Promise.all([readServers(), readAllocations()]);
  const allowed = isAdmin(req) ? servers : servers.filter((s: any) => s.owner === userId(req));
  res.json(
    await Promise.all(
      allowed.map(async (s: any) => {
        const limit = await limitFor(s);
        const used = allocations.filter((a) => a.serverId === s.id).length;
        return { id: s.id, name: s.name, nodeId: s.nodeId || "", limit, used, remaining: Math.max(0, limit - used) };
      }),
    ),
  );
});

databaseRoutes.post("/", async (req, res) => {
  const serverId = String(req.body?.serverId || "");
  const requested = String(req.body?.name || "").trim();
  if (!serverId) return res.status(400).json({ error: "Choose a server for this database" });
  if (!requested) return res.status(400).json({ error: "A database name is required" });

  const [servers, allocations, hosts] = await Promise.all([readServers(), readAllocations(), readHosts()]);
  const server = servers.find((s: any) => s.id === serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });
  if (!isAdmin(req) && server.owner !== userId(req)) {
    return res.status(403).json({ error: "You can only add databases to your own servers" });
  }

  const limit = await limitFor(server);
  const used = allocations.filter((a) => a.serverId === serverId).length;
  if (used >= limit) {
    return res.status(409).json({
      error: `This server has reached its limit of ${limit} database${limit === 1 ? "" : "s"}`,
      code: "DATABASE_LIMIT_REACHED",
    });
  }

  if (hosts.length === 0) {
    return res.status(503).json({
      error: "No database host is configured yet. An administrator needs to add one.",
      code: "NO_DATABASE_HOST",
    });
  }

  // Prefer the host linked to the server's node, then an unlinked host, then any.
  const requestedHostId = String(req.body?.hostId || "");
  const host =
    hosts.find((h) => h.id === requestedHostId) ||
    hosts.find((h) => h.nodeId && h.nodeId === server.nodeId) ||
    hosts.find((h) => !h.nodeId) ||
    hosts[0];

  const { database, username } = buildNames(serverId, requested);
  if (allocations.some((a) => a.hostId === host.id && a.database === database)) {
    return res.status(409).json({ error: `A database named "${requested}" already exists for this server` });
  }

  const password = generatePassword();
  try {
    await createDatabaseWithUser(host, { database, username, password });
  } catch (err: any) {
    return failure(res, err);
  }

  const allocation = {
    id: uuidv4(),
    serverId,
    serverName: server.name,
    hostId: host.id,
    hostName: host.name,
    hostAddress: host.host,
    hostPort: host.port,
    database,
    username,
    password,
    mounted: true,
    createdAt: new Date().toISOString(),
  };

  allocations.push(allocation);
  await writeJSON(ALLOCATIONS_FILE, allocations);

  res.status(201).json({
    success: true,
    database: {
      ...allocation,
      connectionString: `mysql://${username}:${password}@${host.host}:${host.port}/${database}`,
    },
  });
});

databaseRoutes.delete("/:id", async (req, res) => {
  const [allocations, servers, hosts] = await Promise.all([readAllocations(), readServers(), readHosts()]);
  const allocation = allocations.find((a) => a.id === req.params.id);
  if (!allocation) return res.status(404).json({ error: "Database not found" });

  const server = servers.find((s: any) => s.id === allocation.serverId);
  if (!isAdmin(req) && server?.owner !== userId(req)) {
    return res.status(403).json({ error: "You can only delete databases on your own servers" });
  }

  // If the host is gone the record still has to be removable, so a missing host
  // is not treated as a failure.
  const host = hosts.find((h) => h.id === allocation.hostId);
  if (host) {
    try {
      await dropDatabaseWithUser(host, { database: allocation.database, username: allocation.username });
    } catch (err: any) {
      return failure(res, err);
    }
  }

  await writeJSON(
    ALLOCATIONS_FILE,
    allocations.filter((a) => a.id !== allocation.id),
  );
  res.json({ success: true });
});
