import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Check,
  Database,
  HardDrive,
  Pencil,
  Plug,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-react";
import PageHeader from "../components/PageHeader";

type Host = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  nodeId?: string;
  nodeName?: string;
  databaseCount?: number;
  createdAt?: string;
};

type NodeOption = { id: string; name: string; isLocal?: boolean };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-theme-600";

const labelClass = "font-mono text-[10px] uppercase tracking-widest text-muted-foreground";

const emptyForm = { name: "", host: "", port: "3306", username: "", password: "", nodeId: "" };

export default function DatabaseHosts() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<{ id: string; list: string[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [h, n] = await Promise.all([axios.get("/api/database-hosts"), axios.get("/api/nodes")]);
      setHosts(h.data || []);
      setNodes(Array.isArray(n.data) ? n.data : []);
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load database hosts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setError("");
    setShowForm(true);
  };

  const openEdit = (h: Host) => {
    setEditingId(h.id);
    setForm({
      name: h.name,
      host: h.host,
      port: String(h.port),
      username: h.username,
      // Left blank on purpose: submitting empty keeps the stored password.
      password: "",
      nodeId: h.nodeId || "",
    });
    setError("");
    setShowForm(true);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 3306,
        username: form.username.trim(),
        password: form.password,
        nodeId: form.nodeId,
      };
      if (editingId) {
        await axios.put(`/api/database-hosts/${editingId}`, payload);
        setNotice(`Updated "${payload.name}".`);
      } else {
        await axios.post("/api/database-hosts", payload);
        setNotice(`Connected to "${payload.name}" and saved it.`);
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ ...emptyForm });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to save the database host");
    } finally {
      setBusy(false);
    }
  };

  const test = async (h: Host) => {
    setTesting(h.id);
    setError("");
    setNotice("");
    try {
      const res = await axios.post(`/api/database-hosts/${h.id}/test`);
      setNotice(`${h.name} is reachable — MySQL ${res.data?.version || ""}`.trim());
    } catch (err: any) {
      setError(err.response?.data?.error || `Could not reach ${h.name}`);
    } finally {
      setTesting(null);
    }
  };

  const viewSchemas = async (h: Host) => {
    if (schemas?.id === h.id) return setSchemas(null);
    setError("");
    try {
      const res = await axios.get(`/api/database-hosts/${h.id}/schemas`);
      setSchemas({ id: h.id, list: res.data?.schemas || [] });
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to list schemas");
    }
  };

  const remove = async (h: Host) => {
    setBusy(true);
    setError("");
    try {
      await axios.delete(`/api/database-hosts/${h.id}`);
      setConfirmId(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to delete the database host");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full">
      <PageHeader
        title="Database Hosts"
        subtitle="DATABASE HOSTS"
        actions={
          <button
            type="button"
            onClick={showForm && !editingId ? () => setShowForm(false) : openCreate}
            className="group inline-flex shrink-0 items-center gap-2.5 rounded-xl bg-theme-600 px-5 py-3 font-display text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-theme-600/25 transition-all duration-200 hover:bg-theme-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-400/60"
          >
            {showForm && !editingId ? (
              <X className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
            )}
            {showForm && !editingId ? "Cancel" : "Add Database Host"}
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
            <h2 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
              {editingId ? "Edit database host" : "New database host"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Give the panel an account on this MySQL server that may create databases and users. The credentials are
              checked against the server before they are saved, and the password is never sent back to the browser.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>Database nickname</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Primary MySQL"
                  maxLength={60}
                  className={`mt-1.5 ${inputClass}`}
                />
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  How this server is labelled in the panel.
                </p>
              </div>
              <div>
                <label className={labelClass}>Linked node</label>
                <select
                  value={form.nodeId}
                  onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
                  className={`mt-1.5 ${inputClass}`}
                >
                  <option value="">— Any node —</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                      {n.isLocal ? " — local" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  Databases for servers on this node are created here first.
                </p>
              </div>
              <div>
                <label className={labelClass}>Host</label>
                <input
                  type="text"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="127.0.0.1"
                  className={`mt-1.5 ${inputClass}`}
                />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  min={1}
                  max={65535}
                  className={`mt-1.5 ${inputClass}`}
                />
              </div>
              <div>
                <label className={labelClass}>Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="root"
                  autoComplete="off"
                  className={`mt-1.5 ${inputClass}`}
                />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingId ? "Leave blank to keep the current password" : ""}
                  autoComplete="new-password"
                  className={`mt-1.5 ${inputClass}`}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-theme-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-theme-500 disabled:opacity-50"
              >
                <Database className="h-4 w-4" /> {busy ? "Saving…" : editingId ? "Save changes" : "Save and test"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setError("");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">Loading…</div>
        ) : hosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
            <HardDrive className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium text-foreground">No database hosts yet</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Register a MySQL server so game server owners can create their own databases from the panel.
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="group mt-6 inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-all duration-200 hover:border-theme-500/60 hover:text-theme-300"
            >
              <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
              Add your first database host
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {hosts.map((h) => (
              <article key={h.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-lg font-bold text-foreground">{h.name}</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
                      <Plug className="h-3.5 w-3.5" />
                      <span>
                        {h.host}:{h.port}
                      </span>
                      <span className="text-muted-foreground/50">//</span>
                      <span>{h.username}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
                      {h.databaseCount ?? 0} DATABASE{(h.databaseCount ?? 0) === 1 ? "" : "S"}
                    </span>
                    {h.nodeName && (
                      <span className="flex items-center gap-1.5 rounded-full border border-theme-600/40 bg-theme-600/10 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-theme-300">
                        <Server className="h-3 w-3" /> {h.nodeName}
                      </span>
                    )}
                  </div>
                </div>

                {schemas?.id === h.id && (
                  <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
                    <p className={labelClass}>Schemas on this server ({schemas.list.length})</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {schemas.list.length === 0 ? (
                        <span className="font-mono text-[11px] text-muted-foreground">none</span>
                      ) : (
                        schemas.list.map((s) => (
                          <span
                            key={s}
                            className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={() => test(h)}
                    disabled={testing === h.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300 disabled:opacity-50"
                  >
                    <Plug className="h-3 w-3" /> {testing === h.id ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    type="button"
                    onClick={() => viewSchemas(h)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300"
                  >
                    <Database className="h-3 w-3" /> {schemas?.id === h.id ? "Hide schemas" : "View schemas"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(h)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>

                  {confirmId === h.id ? (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="font-mono text-[11px] text-red-300">Remove this host?</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(h)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Yes, remove
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
                      onClick={() => setConfirmId(h.id)}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
