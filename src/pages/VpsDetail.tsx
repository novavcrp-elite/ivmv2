import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  Network,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { VpsTools } from "../components/VpsTools";

type Tab = "console" | "tools" | "info";

type VpsDetail = {
  id: string;
  name: string;
  containerName: string;
  distro: string;
  release: string;
  arch: string;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  status: string;
  simulated?: boolean;
  nodeId?: string;
  nodeName?: string;
  cpuModel?: string;
  motherboard?: string;
  bridge?: string;
  portRange?: { from: number; to: number } | null;
  sshForward?: { hostPort: number; containerPort: number } | null;
  sshForwardApplied?: boolean;
  sshForwardNote?: string;
  enableKvm?: boolean;
  enableAllDevices?: boolean;
  allowDocker?: boolean;
  owner?: string;
  createdAt?: string;
  live?: { ipv4?: string; ipv6?: string; memoryBytes?: number; cpuSeconds?: number } | null;
};

type Line = { kind: "cmd" | "out" | "err" | "note"; text: string };

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "console", label: "Console", icon: <Terminal size={16} /> },
  { id: "tools", label: "Tools", icon: <Database size={16} /> },
  { id: "info", label: "Information", icon: <Cpu size={16} /> },
];

const gb = (mb?: number) =>
  mb ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : "—";

export default function VpsDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [vps, setVps] = useState<VpsDetail | null>(null);
  const [tab, setTab] = useState<Tab>("console");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const consoleEnd = useRef<HTMLDivElement>(null);
  // The panel polls for state, but re-rendering the console on every tick would
  // fight with typing, so history is keyed off these refs instead of effects.
  const commandRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await axios.get(`/api/vps/${id}`);
      setVps(res.data);
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load this VPS");
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  const running = vps?.status === "RUNNING";

  const action = async (what: "start" | "stop" | "restart") => {
    setBusy(true);
    setError("");
    try {
      await axios.post(`/api/vps/${id}/${what}`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to ${what} the VPS`);
    } finally {
      setBusy(false);
    }
  };

  const run = async (raw?: string) => {
    const text = (raw ?? command).trim();
    if (!text) return;
    setCommand("");
    setHistory((h) => [...h.filter((c) => c !== text), text].slice(-50));
    setHistoryAt(-1);
    setLines((l) => [...l, { kind: "cmd", text }]);
    try {
      const res = await axios.post(`/api/vps/${id}/console`, { command: text });
      const next: Line[] = [];
      if (res.data?.stdout) next.push({ kind: "out", text: String(res.data.stdout) });
      if (res.data?.stderr) next.push({ kind: "err", text: String(res.data.stderr) });
      if (!res.data?.stdout && !res.data?.stderr) next.push({ kind: "note", text: "(no output)" });
      setLines((l) => [...l, ...next]);
    } catch (err: any) {
      setLines((l) => [
        ...l,
        { kind: "err", text: err.response?.data?.error || "The command could not be run." },
      ]);
    }
  };

  const convert = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await axios.post(`/api/vps/${id}/convert`);
      setNotice("This VPS is now a real deployment.");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || "The VPS could not be converted");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`/api/vps/${id}`);
      navigate("/vps");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to delete this VPS");
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") return run();
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const at = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(at);
      setCommand(history[at]);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyAt < 0) return;
      const at = historyAt + 1;
      if (at >= history.length) {
        setHistoryAt(-1);
        setCommand("");
      } else {
        setHistoryAt(at);
        setCommand(history[at]);
      }
    }
  };

  if (!vps) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
        {error || "Loading…"}
      </div>
    );
  }

  const address = vps.live?.ipv4 || "no address";
  const sshPort = vps.sshForward?.hostPort;

  return (
    <div className="flex min-h-full flex-col">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 md:px-8">
        <Link
          to="/vps"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-theme-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> VPS Servers
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="font-mono text-[11px] uppercase tracking-widest text-foreground">{vps.name}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {vps.simulated && (
            <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-sky-300">
              SIMULATED
            </span>
          )}
          <span
            className={`flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider ${
              running
                ? "border-theme-600/40 bg-theme-600/10 text-theme-300"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-theme-400" : "bg-muted-foreground"}`} />
            {vps.status}
          </span>
        </span>
      </div>

      {error && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 md:mx-8">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}
      {notice && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-theme-600/40 bg-theme-600/10 p-4 text-sm text-theme-200 md:mx-8">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{notice}</span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-6 p-5 md:flex-row md:p-8">
        {/* Sidebar: identity, controls, tabs */}
        <aside className="w-full shrink-0 md:w-72">
          <div className="rounded-xl border border-border bg-card p-5">
            <h1 className="truncate font-display text-xl font-bold text-foreground">{vps.name}</h1>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{vps.containerName}</p>
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <Network className="h-3.5 w-3.5" /> {address}
            </p>
            {sshPort && (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">ssh :{sshPort}</p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              {running ? (
                <button
                  type="button"
                  onClick={() => action("stop")}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => action("start")}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" /> Start
                </button>
              )}
              <button
                type="button"
                onClick={() => action("restart")}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Restart
              </button>
            </div>

            {vps.simulated && (
              <button
                type="button"
                onClick={convert}
                disabled={busy}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-theme-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-theme-500 disabled:opacity-50"
              >
                <Rocket className="h-3.5 w-3.5" /> Convert to real deployment
              </button>
            )}
          </div>

          <nav className="mt-4 space-y-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  tab === t.id
                    ? "border-theme-600/40 bg-theme-600/10 text-theme-200"
                    : "border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setShowConfirmDelete(true)}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
          >
            <Power className="h-3.5 w-3.5" /> Delete VPS
          </button>
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {tab === "console" && (
            <div className="flex h-[62vh] min-h-[380px] flex-col overflow-hidden rounded-xl border border-border bg-[#050505]">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
                <Terminal className="h-4 w-4 text-theme-400" />
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  Console
                </span>
                <button
                  type="button"
                  onClick={() => setLines([])}
                  className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                >
                  Clear
                </button>
                {vps.simulated && (
                  <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-sky-300">
                    SIMULATED SHELL
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
                {lines.length === 0 && (
                  <p className="text-muted-foreground">
                    {running
                      ? 'No output yet. Type a command below — try "help".'
                      : "The VPS is stopped. Start it to open a shell."}
                  </p>
                )}
                {lines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {line.kind === "cmd" ? (
                      <span className="text-theme-300">
                        root@{vps.containerName}:~# <span className="text-foreground">{line.text}</span>
                      </span>
                    ) : (
                      <span
                        className={
                          line.kind === "err"
                            ? "text-red-400"
                            : line.kind === "note"
                              ? "text-muted-foreground"
                              : "text-foreground/85"
                        }
                      >
                        {line.text}
                      </span>
                    )}
                  </div>
                ))}
                <div ref={consoleEnd} />
              </div>

              <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                <span className="font-mono text-[12px] text-theme-300">#</span>
                <input
                  ref={commandRef}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={!running}
                  placeholder={running ? "Enter a command and press Enter" : "VPS is stopped"}
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => run()}
                  disabled={!running || !command.trim()}
                  className="rounded-lg bg-theme-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-theme-500 disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {tab === "tools" && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">Tools</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                SSH credentials, the file manager, OS reinstall and the miner tracker for this VPS.
              </p>
              <VpsTools vps={vps} onChanged={load} />
            </div>
          )}

          {tab === "info" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                  Resources
                </h2>
                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    { icon: <Cpu className="h-4 w-4 text-theme-400" />, label: "vCPU", value: `${vps.cpu} cores` },
                    { icon: <MemoryStick className="h-4 w-4 text-theme-400" />, label: "Memory", value: gb(vps.memoryMb) },
                    { icon: <HardDrive className="h-4 w-4 text-theme-400" />, label: "Disk", value: `${vps.diskGb} GB` },
                  ].map((row) => (
                    <div key={row.label} className="rounded-lg border border-border bg-background/60 px-3 py-2.5">
                      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {row.icon} {row.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{row.value}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                  Network &amp; identity
                </h2>
                <dl className="mt-4 space-y-2 font-mono text-[12px]">
                  {[
                    ["PRIVATE ADDRESS", address],
                    ["SSH HOST PORT", sshPort ? String(sshPort) : "—"],
                    [
                      "PORT RANGE",
                      vps.portRange?.from && vps.portRange?.to
                        ? `${vps.portRange.from}–${vps.portRange.to}`
                        : "—",
                    ],
                    ["NETWORK", "private bridge · no public IPv4"],
                    ["IMAGE", `${vps.distro} ${vps.release} · ${vps.arch}`],
                    ["CPU MODEL", vps.cpuModel || "host default"],
                    ["MOTHERBOARD", vps.motherboard || "host default"],
                    ["NODE", vps.nodeName || vps.nodeId || "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
                {vps.sshForward && vps.sshForwardApplied === false && vps.sshForwardNote && (
                  <p className="mt-4 flex items-start gap-1.5 font-mono text-[11px] text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {vps.sshForwardNote}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                  Capabilities
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ["DOCKER", vps.allowDocker],
                    ["KVM", vps.enableKvm],
                    ["ALL DEVICES", vps.enableAllDevices],
                  ].map(([label, on]) => (
                    <span
                      key={String(label)}
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] tracking-widest ${
                        on
                          ? "border-theme-500/40 bg-theme-500/10 text-theme-300"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {String(label)} {on ? "ENABLED" : "DISABLED"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showConfirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
              <AlertTriangle className="h-4 w-4 text-red-400" /> Delete {vps.name}?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes the VPS and its container, along with its published SSH port. This cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                <Power className="h-3.5 w-3.5" /> {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
