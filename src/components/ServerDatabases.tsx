import React, { useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, Check, Copy, Database, Plus, RefreshCw, Trash2, X } from "lucide-react";

type Allocation = {
  id: string;
  serverId: string;
  hostName?: string;
  hostAddress?: string;
  hostPort?: number;
  database: string;
  username: string;
  password: string;
  createdAt?: string;
};

/**
 * Database manager for a single game server. Databases are created on one of the
 * admin-registered MySQL hosts, which is what makes them survive a reinstall or
 * a fresh world: the data lives outside the server's own files.
 */
export default function ServerDatabases({ serverId, server }: { serverId: string; server?: any }) {
  const [items, setItems] = useState<Allocation[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [all, servers] = await Promise.all([
        axios.get("/api/databases"),
        axios.get("/api/databases/servers"),
      ]);
      const rows = (Array.isArray(all.data) ? all.data : all.data?.items || []).filter(
        (d: Allocation) => d.serverId === serverId,
      );
      setItems(rows);
      const mine = (servers.data || []).find((s: any) => s.id === serverId);
      setLimit(mine ? mine.limit : null);
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load databases");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [serverId]);

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
    const wanted = name.trim();
    if (!wanted) return setError("Enter a database name");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await axios.post("/api/databases", { serverId, name: wanted });
      const db = res.data?.database;
      setNotice(
        db
          ? `Created ${db.database}. Use the credentials below in your server config — copy the password now.`
          : "Database created.",
      );
      setName("");
      setShowForm(false);
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

  const used = items.length;
  const remaining = limit === null ? null : Math.max(0, limit - used);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <Database className="h-4 w-4 text-theme-400" />
        <h2 className="font-display text-sm font-bold uppercase tracking-widest text-foreground">Databases</h2>
        {limit !== null && (
          <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground">
            {used} / {limit} USED
          </span>
        )}
        <button
          type="button"
          onClick={load}
          className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          disabled={remaining === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-theme-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-theme-500 disabled:opacity-40"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancel" : "Create Database"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}
        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-theme-600/40 bg-theme-600/10 p-4 text-sm text-theme-200">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{notice}</span>
          </div>
        )}

        {showForm && (
          <div className="mb-5 rounded-xl border border-border bg-card p-5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Database name
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
                placeholder="survival"
                maxLength={20}
                autoFocus
                className="w-56 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-theme-600"
              />
              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-theme-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-theme-500 disabled:opacity-50"
              >
                <Database className="h-4 w-4" /> {busy ? "Creating…" : "Create"}
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Letters, numbers and underscores. The panel prefixes the name with this server's short id and creates a
              dedicated MySQL user with access to it.
            </p>
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Database className="mb-4 h-10 w-10 text-muted-foreground" />
            <h3 className="text-base font-medium text-foreground">No databases for this server</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Create one to keep player data, stats or plugin tables outside the server folder, so they survive a
              reinstall or a fresh world.
            </p>
            {remaining !== 0 && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="group mt-5 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300"
              >
                <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" /> Create a database
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((db) => {
              const address = `${db.hostAddress || "—"}${db.hostPort ? `:${db.hostPort}` : ""}`;
              const uri = `mysql://${db.username}:${db.password}@${db.hostAddress || ""}${
                db.hostPort ? `:${db.hostPort}` : ""
              }/${db.database}`;
              return (
                <article key={db.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-base font-bold text-foreground">{db.database}</h3>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {address} {db.hostName ? `· ${db.hostName}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-theme-600/40 bg-theme-600/10 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-theme-300">
                      MYSQL
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { label: "DATABASE", value: db.database, key: `${db.id}-db` },
                      { label: "USERNAME", value: db.username, key: `${db.id}-user` },
                      { label: "PASSWORD", value: db.password, key: `${db.id}-pass` },
                    ].map((row) => (
                      <div key={row.key} className="rounded-lg border border-border bg-background/60 px-3 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {row.label}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{row.value}</code>
                          <button
                            type="button"
                            onClick={() => copy(row.key, row.value)}
                            title={`Copy ${row.label.toLowerCase()}`}
                            className="shrink-0 text-muted-foreground transition-colors hover:text-theme-300"
                          >
                            {copied === row.key ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => copy(`${db.id}-uri`, uri)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300"
                    >
                      {copied === `${db.id}-uri` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      Copy connection string
                    </button>

                    {confirmId === db.id ? (
                      <div className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-[11px] text-red-300">Delete {db.database}?</span>
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

        {remaining === 0 && (
          <p className="mt-5 font-mono text-[11px] text-muted-foreground">
            This server has reached its database limit. An administrator can raise it from the server's settings.
          </p>
        )}
      </div>
    </div>
  );
}
