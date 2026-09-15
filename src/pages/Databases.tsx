import React, { useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, Check, Copy, Database, Plus, Server, Trash2, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";

type Allocation = {
  id: string;
  serverId: string;
  serverName?: string;
  hostId: string;
  hostName?: string;
  hostAddress?: string;
  hostPort?: number;
  database: string;
  username: string;
  password: string;
  createdAt?: string;
};

type ServerOption = { id: string; name: string; nodeId: string; limit: number; used: number; remaining: number };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-theme-600";

const labelClass = "font-mono text-[10px] uppercase tracking-widest text-muted-foreground";

export default function Databases() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [items, setItems] = useState<Allocation[]>([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [serverId, setServerId] = useState("");
  const [name, setName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [dbs, srv] = await Promise.all([
        axios.get("/api/databases"),
        axios.get("/api/databases/servers"),
      ]);
      setItems(dbs.data?.items || dbs.data || []);
      setServers(srv.data || []);
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load databases");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  };

  const create = async () => {
    if (!serverId) return setError("Choose a server for this database");
    if (!name.trim()) return setError("Enter a database name");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await axios.post("/api/databases", { serverId, name: name.trim() });
      const created = res.data?.database;
      setNotice(
        created
          ? `Created ${created.database} on ${created.hostName || "the database host"}. Copy the password now — it stays visible in this list.`
          : "Database created.",
      );
      setShowForm(false);
      setName("");
      setServerId("");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to create the database");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (db: Allocation) => {
    setBusy(true);
    setError("");
    try {
      await axios.delete(`/api/databases/${db.id}`);
      setConfirmId(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to delete the database");
    } finally {
      setBusy(false);
    }
  };

  const selected = servers.find((s) => s.id === serverId);
  const noCapacity = servers.length > 0 && servers.every((s) => s.remaining === 0);

  return (
    <div className="min-h-full">
      <PageHeader
        title="Databases"
        subtitle="DATABASES"
        actions={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={servers.length === 0}
            className="group inline-flex shrink-0 items-center gap-2.5 rounded-xl bg-theme-600 px-5 py-3 font-display text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-theme-600/25 transition-all duration-200 hover:bg-theme-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-400/60 disabled:opacity-50"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />}
            {showForm ? "Cancel" : "Create Database"}
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-5 pb-20 md:px-8">
        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}
        {notice && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-theme-600/40 bg-theme-600/10 p-4 text-sm text-theme-200">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{notice}</span>
          </div>
        )}

        {showForm && (
          <div className="mb-8 rounded-xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">New database</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The panel creates the schema and a dedicated user with full access to it, then shows you the credentials.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>Server</label>
                <select
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  className={`mt-1.5 ${inputClass}`}
                >
                  <option value="">— Choose a server —</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.remaining === 0}>
                      {s.name} ({s.used}/{s.limit} used)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Database name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="survival"
                  maxLength={20}
                  className={`mt-1.5 ${inputClass}`}
                />
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  Letters, numbers and underscores. The final name is prefixed with the server's short id.
                </p>
              </div>
            </div>
            {selected && (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {selected.remaining} of {selected.limit} database slots left on this server
              </p>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-theme-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-theme-500 disabled:opacity-50"
              >
                <Database className="h-4 w-4" /> {busy ? "Creating…" : "Create database"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
            <Database className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium text-foreground">No databases yet</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {servers.length === 0
                ? "You do not own any servers yet, so there is nothing to attach a database to."
                : noCapacity
                  ? "Every one of your servers has used its database slots."
                  : "Create a database to get a schema and its own MySQL user for one of your servers."}
            </p>
            {servers.length > 0 && !noCapacity && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="group mt-6 inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-all duration-200 hover:border-theme-500/60 hover:text-theme-300"
              >
                <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                Create your first database
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((db) => {
              const address = `${db.hostAddress || "—"}${db.hostPort ? `:${db.hostPort}` : ""}`;
              const connectionString = `mysql://${db.username}:${db.password}@${db.hostAddress || ""}${
                db.hostPort ? `:${db.hostPort}` : ""
              }/${db.database}`;
              return (
                <article key={db.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg font-bold text-foreground">{db.database}</h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
                        <Server className="h-3.5 w-3.5" />
                        <span>{db.serverName}</span>
                        <span className="text-muted-foreground/50">//</span>
                        <span>{db.hostName}</span>
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-theme-600/40 bg-theme-600/10 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-theme-300">
                      MYSQL
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { label: "HOST", value: address, key: `${db.id}-host` },
                      { label: "DATABASE", value: db.database, key: `${db.id}-db` },
                      { label: "USERNAME", value: db.username, key: `${db.id}-user` },
                      { label: "PASSWORD", value: db.password, key: `${db.id}-pass` },
                    ].map((row) => (
                      <div key={row.key} className="rounded-lg border border-border bg-background/60 px-3 py-2">
                        <p className={labelClass}>{row.label}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{row.value}</code>
                          <button
                            type="button"
                            onClick={() => copy(row.key, row.value)}
                            title={`Copy ${row.label.toLowerCase()}`}
                            className="shrink-0 text-muted-foreground transition-colors hover:text-theme-300"
                          >
                            {copied === row.key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => copy(`${db.id}-uri`, connectionString)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300"
                    >
                      {copied === `${db.id}-uri` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      Copy connection string
                    </button>

                    {confirmId === db.id ? (
                      <div className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-[11px] text-red-300">Delete this database and its user?</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(db)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Yes, delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(db.id)}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {isAdmin && (
          <p className="mt-8 font-mono text-[11px] leading-relaxed text-muted-foreground">
            As an administrator you can also register and test MySQL servers under{" "}
            <span className="text-foreground">Database Hosts</span> in the sidebar.
          </p>
        )}
      </div>
    </div>
  );
}
