import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Check,
  Copy,
  FileUp,
  HardDriveDownload,
  Pickaxe,
  RefreshCw,
  RotateCcw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

type Tool = "ssh" | "files" | "reinstall" | "mining";

type VpsFile = { name: string; size: number; modified: string };

const toolButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function VpsTools({ vps, onChanged }: { vps: any; onChanged?: () => void }) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const [ssh, setSsh] = useState<any>(null);
  const [files, setFiles] = useState<VpsFile[]>([]);
  const [mining, setMining] = useState<any>(null);
  const [images, setImages] = useState<any[]>([]);
  const [reinstallKey, setReinstallKey] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    axios
      .get("/api/vps/status")
      .then((res) => {
        const list = res.data.templates || [];
        setImages(list);
        setReinstallKey((current) => current || (list[0] ? `${list[0].distro}|${list[0].release}` : ""));
      })
      .catch(() => {});
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

  const open = async (next: Tool) => {
    if (tool === next) {
      setTool(null);
      return;
    }
    setTool(next);
    setError("");
    setBusy(true);
    try {
      if (next === "ssh") setSsh((await axios.get(`/api/vps/${vps.id}/ssh`)).data);
      if (next === "files") setFiles((await axios.get(`/api/vps/${vps.id}/files`)).data.files || []);
      if (next === "mining") setMining((await axios.get(`/api/vps/${vps.id}/mining`)).data);
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to load ${next}`);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      await axios.post(`/api/vps/${vps.id}/files`, data);
      setFiles((await axios.get(`/api/vps/${vps.id}/files`)).data.files || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Upload failed");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeFile = async (name: string) => {
    setBusy(true);
    try {
      await axios.delete(`/api/vps/${vps.id}/files`, { params: { name } });
      setFiles((await axios.get(`/api/vps/${vps.id}/files`)).data.files || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const reinstall = async () => {
    const [distro, release] = reinstallKey.split("|");
    if (!distro) return setError("Choose an OS image");
    setBusy(true);
    setError("");
    try {
      await axios.post(`/api/vps/${vps.id}/reinstall`, { distro, release });
      onChanged?.();
    } catch (err: any) {
      setError(err.response?.data?.error || "Reinstall failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={toolButton} onClick={() => open("ssh")}>
          <Terminal className="h-3 w-3" /> SSH
        </button>
        <button type="button" className={toolButton} onClick={() => open("files")}>
          <FileUp className="h-3 w-3" /> Files
        </button>
        <button type="button" className={toolButton} onClick={() => open("reinstall")}>
          <RotateCcw className="h-3 w-3" /> Reinstall OS
        </button>
        <button type="button" className={toolButton} onClick={() => open("mining")}>
          <Pickaxe className="h-3 w-3" /> Mining
        </button>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {tool && (
        <div className="mt-3 rounded-lg border border-border bg-background/60 p-4">
          {busy && <p className="text-xs text-muted-foreground">Loading…</p>}

          {tool === "ssh" && ssh && (
            <div className="flex flex-col gap-2 font-mono text-xs">
              <p className="text-muted-foreground">SSH ACCESS</p>
              {[
                { label: "host", value: ssh.host || "—" },
                { label: "port", value: String(ssh.port) },
                { label: "user", value: ssh.username },
                { label: "pass", value: ssh.password },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="truncate">{row.value}</span>
                    <button
                      type="button"
                      onClick={() => copy(row.label, row.value)}
                      className="text-muted-foreground transition-colors hover:text-theme-300"
                      title={`Copy ${row.label}`}
                    >
                      {copied === row.label ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                </div>
              ))}
              {ssh.command && (
                <button
                  type="button"
                  onClick={() => copy("command", ssh.command)}
                  className="mt-1 rounded border border-border px-2 py-1.5 text-left text-[11px] text-foreground transition-colors hover:border-theme-500/60"
                >
                  {copied === "command" ? "copied!" : ssh.command}
                </button>
              )}

              {/* The published host port is the route in from outside, since the
                  VPS itself only has a private address. */}
              {ssh.forwardHostPort && (
                <div className="mt-2 rounded border border-border p-2.5">
                  <p className="text-[10px] tracking-widest text-muted-foreground">PUBLISHED SSH ACCESS</p>
                  <button
                    type="button"
                    onClick={() => copy("forward", ssh.forwardCommand)}
                    className="mt-1.5 w-full rounded bg-muted px-2 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-muted/70"
                  >
                    {copied === "forward" ? "copied!" : ssh.forwardCommand}
                  </button>
                  {!ssh.forwardApplied && ssh.forwardNote && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {ssh.forwardNote}
                    </p>
                  )}
                </div>
              )}

              {ssh.simulated && (
                <p className="text-[10px] text-muted-foreground">Simulated — no real host is listening.</p>
              )}
            </div>
          )}

          {tool === "files" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs text-muted-foreground">FILES ({files.length})</p>
                <div>
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload(f);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                    className={toolButton}
                  >
                    <FileUp className="h-3 w-3" /> Upload
                  </button>
                </div>
              </div>

              {files.length === 0 ? (
                <p className="text-xs text-muted-foreground">No files uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-border font-mono text-xs">
                  {files.map((f) => (
                    <li key={f.name} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate text-foreground">{f.name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                        {formatBytes(f.size)}
                        <a
                          href={`/api/vps/${vps.id}/files/download?name=${encodeURIComponent(f.name)}`}
                          className="transition-colors hover:text-theme-300"
                          title="Download"
                        >
                          <HardDriveDownload className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => removeFile(f.name)}
                          className="transition-colors hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tool === "reinstall" && (
            <div className="flex flex-col gap-3">
              <p className="font-mono text-xs text-muted-foreground">
                REINSTALL OS — WIPES THE CONTAINER AND REBUILDS IT WITH THE CHOSEN IMAGE.
              </p>
              <select
                value={reinstallKey}
                onChange={(e) => setReinstallKey(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-theme-600"
              >
                {images.map((t) => (
                  <option key={`${t.distro}|${t.release}`} value={`${t.distro}|${t.release}`}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={reinstall}
                className="btn-danger self-start px-3 py-2 text-[10px]"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reinstall
              </button>
            </div>
          )}

          {tool === "mining" && mining && (
            <div className="flex flex-col gap-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">MINING TRACKER</p>
                <button
                  type="button"
                  onClick={() => open("mining")}
                  className="text-muted-foreground transition-colors hover:text-theme-300"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              {!mining.detected ? (
                <p className="text-muted-foreground">
                  No miner API responded on port {mining.apiPort}. {mining.reason}
                </p>
              ) : (
                <>
                  {[
                    { k: "hashrate", v: `${Math.round(mining.hashrate).toLocaleString()} H/s` },
                    { k: "algorithm", v: mining.algorithm || "—" },
                    { k: "shares", v: `${mining.sharesGood} / ${mining.sharesTotal}` },
                    { k: "pool", v: mining.pool || "—" },
                    { k: "difficulty", v: mining.difficulty ? mining.difficulty.toLocaleString() : "—" },
                    {
                      k: "uptime",
                      v: `${Math.floor((mining.uptimeSeconds || 0) / 3600)}h ${Math.floor(((mining.uptimeSeconds || 0) % 3600) / 60)}m`,
                    },
                  ].map((row) => (
                    <div key={row.k} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{row.k}</span>
                      <span className="truncate text-foreground">{row.v}</span>
                    </div>
                  ))}
                  {mining.simulated && (
                    <p className="text-[10px] text-muted-foreground">Simulated telemetry.</p>
                  )}
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setTool(null)}
            className="mt-3 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" /> Close
          </button>
        </div>
      )}
    </div>
  );
}
