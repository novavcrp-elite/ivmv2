import crypto from "crypto";
import { createConnection, type Connection } from "mysql2/promise";

/**
 * MySQL cannot parameterise identifiers (`CREATE DATABASE ?` is a syntax error),
 * so every name that reaches a statement is validated against a strict allowlist
 * and then wrapped in backticks. Anything that fails the allowlist is rejected
 * rather than escaped, so a malformed name can never be interpolated.
 */
const IDENT_RE = /^[A-Za-z0-9_]{1,64}$/;

export class MysqlError extends Error {
  code: string;
  detail?: string;
  constructor(message: string, code = "MYSQL_ERROR", detail?: string) {
    super(message);
    this.name = "MysqlError";
    this.code = code;
    this.detail = detail;
  }
}

export type DatabaseHost = {
  id: string;
  /** Admin-facing nickname for the MySQL server. */
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  /** Optional node this database host is linked to. */
  nodeId?: string;
  createdAt?: string;
};

/** Backtick-quotes a validated identifier. */
function ident(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new MysqlError(`"${name}" is not a valid database identifier`, "MYSQL_BAD_IDENTIFIER");
  }
  return `\`${name}\``;
}

/** Quotes a string literal for a statement that cannot take placeholders. */
function literal(value: string): string {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export function clampPort(value: unknown): number {
  const n = Math.round(Number(value));
  if (!isFinite(n) || n < 1 || n > 65535) return 3306;
  return n;
}

/**
 * Builds the on-host names for an allocation. Both stay within MySQL's 64-char
 * limit and share a per-server prefix so an admin can see who owns what.
 */
export function buildNames(serverId: string, requested: string) {
  const server = String(serverId).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() || "srv";
  const slug =
    String(requested)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20) || "db";
  return { database: `s${server}_${slug}`, username: `u${server}_${slug}` };
}

async function connect(host: DatabaseHost, timeoutMs = 12000): Promise<Connection> {
  if (!host.host) throw new MysqlError("A database host address is required", "MYSQL_NO_HOST");
  try {
    return await createConnection({
      host: host.host,
      port: clampPort(host.port),
      user: host.username,
      password: host.password,
      connectTimeout: timeoutMs,
      // The panel only ever issues provisioning DDL; multiple statements are
      // built and run one at a time on purpose.
      multipleStatements: false,
    });
  } catch (err: any) {
    throw new MysqlError(
      err?.code === "ER_ACCESS_DENIED_ERROR"
        ? "The database host rejected those credentials"
        : err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT" || err?.code === "ENOTFOUND"
          ? `Could not reach the database host at ${host.host}:${clampPort(host.port)}`
          : "Could not connect to the database host",
      "MYSQL_CONNECT_FAILED",
      err?.code || err?.message,
    );
  }
}

/** Verifies credentials and returns the server version. */
export async function testConnection(host: DatabaseHost): Promise<{ version: string }> {
  const conn = await connect(host);
  try {
    const [rows] = await conn.query<any[]>("SELECT VERSION() AS version");
    return { version: String(rows?.[0]?.version || "unknown") };
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Live list of schema names on the host (used by the admin view). */
export async function showDatabases(host: DatabaseHost): Promise<string[]> {
  const conn = await connect(host);
  try {
    const [rows] = await conn.query<any[]>("SHOW DATABASES");
    const system = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
    return rows
      .map((r) => String(r.Database ?? Object.values(r)[0] ?? ""))
      .filter((name) => name && !system.has(name.toLowerCase()))
      .sort();
  } finally {
    await conn.end().catch(() => {});
  }
}

const ALLOWED_USER_HOSTS = new Set(["%", "localhost", "127.0.0.1", "::1"]);

/**
 * Creates the schema, its dedicated user and the grant. The user is allowed in
 * from the given remote address (default `%` so game servers on other nodes can
 * reach it). If the user already exists its password is rotated to the supplied
 * one, which makes a partially-failed earlier attempt recoverable.
 */
export async function createDatabaseWithUser(
  host: DatabaseHost,
  opts: { database: string; username: string; password: string; remote?: string },
): Promise<void> {
  const db = ident(opts.database);
  const user = ident(opts.username);
  const remote = ALLOWED_USER_HOSTS.has(String(opts.remote || "%")) ? String(opts.remote || "%") : "%";
  const userAt = `${literal(opts.username)}@${literal(remote)}`;
  const pass = literal(opts.password);

  const conn = await connect(host);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${db}`);

    const [existing] = await conn.query<any[]>(
      "SELECT 1 FROM mysql.user WHERE user = ? AND host = ? LIMIT 1",
      [opts.username, remote],
    );
    if (Array.isArray(existing) && existing.length > 0) {
      await conn.query(`ALTER USER ${userAt} IDENTIFIED BY ${pass}`);
    } else {
      await conn.query(`CREATE USER ${userAt} IDENTIFIED BY ${pass}`);
    }

    await conn.query(`GRANT ALL PRIVILEGES ON ${db}.* TO ${userAt}`);
    await conn.query("FLUSH PRIVILEGES");
  } catch (err: any) {
    // Leave nothing half-made behind: the caller reports the failure, and a
    // retry starts from a clean slate.
    await conn.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => {});
    await conn.query(`DROP USER IF EXISTS ${userAt}`).catch(() => {});
    if (err instanceof MysqlError) throw err;
    throw new MysqlError(
      err?.code === "ER_DBACCESS_DENIED_ERROR" || err?.code === "ER_ACCESS_DENIED_ERROR"
        ? "The database host account lacks permission to create databases"
        : "The database host refused to create the database",
      "MYSQL_CREATE_FAILED",
      err?.code || err?.message,
    );
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Drops the schema and its user. Missing objects are treated as success. */
export async function dropDatabaseWithUser(
  host: DatabaseHost,
  opts: { database: string; username: string; remote?: string },
): Promise<void> {
  const db = ident(opts.database);
  const remote = ALLOWED_USER_HOSTS.has(String(opts.remote || "%")) ? String(opts.remote || "%") : "%";

  const conn = await connect(host);
  try {
    await conn.query(`DROP DATABASE IF EXISTS ${db}`);
    await conn.query(`DROP USER IF EXISTS ${literal(opts.username)}@${literal(remote)}`);
    await conn.query("FLUSH PRIVILEGES");
  } catch (err: any) {
    if (err instanceof MysqlError) throw err;
    throw new MysqlError("The database host refused to remove the database", "MYSQL_DROP_FAILED", err?.code);
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Generates a strong random password for a provisioned database user. */
export function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
