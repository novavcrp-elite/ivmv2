import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  Cloud,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  Network,
  Play,
  Plus,
  Rocket,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { VpsInstallButton } from "../components/VpsInstallButton";
import { VpsTools } from "../components/VpsTools";
import { flagFor } from "../utils/countries";

type VpsLive = {
  name: string;
  state: string;
  ipv4?: string;
  ipv6?: string;
  memoryBytes?: number;
  cpuSeconds?: number;
};

type Vps = {
  id: string;
  name: string;
  containerName: string;
  distro: string;
  release: string;
  arch: string;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  nodeId?: string;
  nodeName?: string;
  cpuModel?: string;
  motherboard?: string;
  bridge?: string;
  hostname?: string;
  portRange?: { from: number; to: number } | null;
  sshForward?: { hostPort: number; containerPort: number } | null;
  enableKvm?: boolean;
  enableAllDevices?: boolean;
  allowDocker?: boolean;
  simulated?: boolean;
  status: string;
  createdAt: string;
  live?: VpsLive | null;
};

const STATUS_STYLES: Record<string, string> = {
  RUNNING: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  STOPPED: "border-border bg-muted text-muted-foreground",
  FROZEN: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  MISSING: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

function gb(mb?: number) {
  if (!mb) return "—";
  return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
}

export default function VpsServers() {
  const [items, setItems] = useState<Vps[]>([]);
  const [available, setAvailable] = useState(false);
  const [canProvision, setCanProvision] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [nestedBlocked, setNestedBlocked] = useState(false);
  const [hostVirt, setHostVirt] = useState("");
  const [nodes, setNodes] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get("/api/vps");
      setItems(res.data.items || []);
      setAvailable(res.data.available === true);
      setCanProvision(res.data.canProvision !== false);
      setSimulated(res.data.simulated === true);
      setNestedBlocked(res.data.nestedBlocked === true);
      setHostVirt(res.data.hostVirt || "");
      setReason(res.data.reason || "");
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load VPS servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    axios
      .get("/api/nodes")
      .then((res) => setNodes(res.data || []))
      .catch(() => {});
  }, [load]);

  const nodeFor = (id?: string) => nodes.find((n) => n.id === id);

  const act = async (vps: Vps, action: "start" | "stop" | "restart") => {
    setBusyId(vps.id);
    setError("");
    try {
      await axios.post(`/api/vps/${vps.id}/${action}`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to ${action} ${vps.name}`);
    } finally {
      setBusyId(null);
    }
  };

  const destroy = async (vps: Vps) => {
    setBusyId(vps.id);
    setError("");
    try {
      await axios.delete(`/api/vps/${vps.id}`);
      setConfirmId(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to delete ${vps.name}`);
    } finally {
      setBusyId(null);
    }
  };

  const running = (vps: Vps) => vps.status === "RUNNING";

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">VPS Servers</h1>
          <p className="mt-2 text-muted-foreground">
Virtual private servers running on this host, with their address and resource usage.
          </p>
        </div>
        <Link
          to="/vps/deploy"
          className="group inline-flex shrink-0 items-center gap-2.5 rounded-xl bg-theme-600 px-5 py-3 font-display text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-theme-600/25 transition-all duration-200 hover:bg-theme-500 hover:shadow-theme-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-400/60"
        >
          <Rocket className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
          Deploy VPS
        </Link>
      </div>

      {!available && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold uppercase tracking-widest text-amber-100">
              CONTAINER RUNTIME NOT FOUND
            </p>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-amber-200/85">
              {reason || "No container runtime is available on this host."}
            </p>
            <p className="mt-2 font-mono text-[11px] font-bold uppercase tracking-widest text-amber-100">
              Click the button below to install
            </p>
            {hostVirt === "lxc" && (
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-amber-300/90">
                Note — this host is itself containerised, so it cannot create further containers. Run the panel on a
                VM or dedicated host for real provisioning.
              </p>
            )}
            <div className="mt-3">
              <VpsInstallButton onReady={load} />
            </div>
          </div>
        </div>
      )}

      {nestedBlocked && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold uppercase tracking-widest text-amber-100">
              NESTED VIRTUALISATION UNAVAILABLE
            </p>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-amber-200/85">
              {reason ||
                "This host is itself a container, so nested VPS cannot be created here. Run the panel on a virtual machine or dedicated host to provision for real."}
            </p>
          </div>
        </div>
      )}

      {simulated && !nestedBlocked && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold uppercase tracking-widest text-sky-100">SIMULATION MODE</p>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-sky-200/85">
              This host has no container runtime, so VPS operations are simulated. The management UI works for
              testing — nothing real is provisioned.
            </p>
          </div>
        </div>
      )}

      {simulated && nestedBlocked && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold uppercase tracking-widest text-sky-100">SIMULATION MODE</p>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-sky-200/85">
              Operations are simulated in the panel because this host cannot create nested containers. The full
              management UI works for testing — nothing real is provisioned.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-400">
          <AlertTriangle className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
          <Cloud className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No VPS yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Deploy a VPS to get a dedicated vCPU, memory and disk allocation on a private address.
          </p>
          <Link
            to="/vps/deploy"
            className="group mt-6 inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-all duration-200 hover:border-theme-500/60 hover:text-theme-300"
          >
            <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
            Deploy your first VPS
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {items.map((vps) => (
            <div key={vps.id} className="flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold text-foreground">{vps.name}</h3>
                  <p className="truncate font-mono text-xs text-muted-foreground">{vps.containerName}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider ${
                    STATUS_STYLES[vps.status] || STATUS_STYLES.MISSING
                  }`}
                >
                  {vps.status}
                </span>
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs capitalize text-muted-foreground">
                <span>{vps.distro} {vps.release} · {vps.arch}</span>
                {nodeFor(vps.nodeId) && (
                  <span className="flex items-center gap-1" title={nodeFor(vps.nodeId)?.location || ""}>
                    {flagFor(nodeFor(vps.nodeId)?.countryCode)} {nodeFor(vps.nodeId)?.name}
                  </span>
                )}
              </p>
              {(vps.cpuModel || vps.motherboard) && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {[vps.cpuModel, vps.motherboard].filter(Boolean).join(" · ")}
                </p>
              )}

              {(vps.simulated || vps.enableKvm || vps.enableAllDevices || vps.allowDocker) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {vps.simulated && (
                    <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-sky-300">
                      SIMULATED
                    </span>
                  )}
                  {vps.allowDocker && (
                    <span className="rounded border border-theme-500/40 bg-theme-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-theme-300">
                      DOCKER
                    </span>
                  )}
                  {vps.enableKvm && (
                    <span className="rounded border border-theme-500/40 bg-theme-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-theme-300">
                      KVM
                    </span>
                  )}
                  {vps.enableAllDevices && (
                    <span className="rounded border border-theme-500/40 bg-theme-500/10 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-theme-300">
                      ALL DEVICES
                    </span>
                  )}
                </div>
              )}

              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-theme-400" />
                  <span className="text-muted-foreground">{vps.cpu} vCPU</span>
                </div>
                <div className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-theme-400" />
                  <span className="text-muted-foreground">{gb(vps.memoryMb)} RAM</span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-theme-400" />
                  <span className="text-muted-foreground">{vps.diskGb} GB disk</span>
                </div>
                <div className="flex items-center gap-2">                    <Network className="h-4 w-4 text-theme-400" />
                    <span className="truncate text-muted-foreground">{vps.live?.ipv4 || "no address"}</span>
                  </div>
                </dl>

                <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                  private bridge · no public IPv4
                  {vps.portRange?.from && vps.portRange?.to
                    ? ` · ports ${vps.portRange.from}–${vps.portRange.to}`
                    : ""}
                  {vps.sshForward?.hostPort ? ` · ssh :${vps.sshForward.hostPort}` : ""}
                </p>

                <VpsTools vps={vps} onChanged={load} />

              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                {running(vps) ? (
                  <button
                    type="button"
                    disabled={busyId === vps.id}
                    onClick={() => act(vps, "stop")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-foreground/40 disabled:opacity-50"
                  >
                    <Square className="h-4 w-4" /> Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === vps.id || !canProvision}
                    onClick={() => act(vps, "start")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-foreground/40 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" /> Start
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === vps.id || !canProvision}
                  onClick={() => act(vps, "restart")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-foreground/40 disabled:opacity-50"
                >
                  <RotateCw className="h-4 w-4" /> Restart
                </button>
                <button
                  type="button"
                  disabled={busyId === vps.id}
                  onClick={() => setConfirmId(vps.id)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:border-red-500 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>

              {confirmId === vps.id && (
                <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                  <p>
                    Destroy <span className="font-semibold">{vps.name}</span>? The container and its filesystem are
                    removed permanently.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === vps.id}
                      onClick={() => destroy(vps)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" /> Delete permanently
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-foreground/40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
