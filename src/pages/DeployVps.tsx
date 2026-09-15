import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  Cloud,
  Cpu,
  Globe,
  HardDrive,
  Info,
  Layers,
  MemoryStick,
  Network,
  Rocket,
  Server,
  Terminal,
  Zap,
} from "lucide-react";
import { VpsInstallButton } from "../components/VpsInstallButton";
import { flagFor } from "../utils/countries";

/** Same visual language as the game host creation wizard (CreateServer). */
const pageStyles = `
  .deploy-theme {
    background: #050505; color: #fff; font-family: 'IBM Plex Sans', sans-serif;
    min-height: 100vh;
  }
  .deploy-theme .font-display { font-family: 'Chakra Petch', sans-serif; }
  .deploy-theme .font-mono { font-family: 'IBM Plex Mono', monospace; }

  .deploy-theme .bg-grid {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 56px 56px;
    mask-image: radial-gradient(ellipse 95% 70% at 50% 0%, #000 25%, transparent 78%);
    -webkit-mask-image: radial-gradient(ellipse 95% 70% at 50% 0%, #000 25%, transparent 78%);
  }
  .deploy-theme .scanline {
    position: fixed; left: 0; right: 0; height: 140px; top: -140px; z-index: 1; pointer-events: none;
    background: linear-gradient(to bottom, transparent, rgba(255,255,255,.028), transparent);
    animation: scan 10s linear infinite;
  }
  @keyframes scan { to { top: 100vh; } }
  .deploy-theme .noise {
    position: fixed; inset: 0; z-index: 60; pointer-events: none; opacity: .035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  .deploy-theme .corner { position: absolute; width: 12px; height: 12px; }
  .deploy-theme .c-tl { top: -1px; left: -1px; border-top: 2px solid #fff; border-left: 2px solid #fff; }
  .deploy-theme .c-tr { top: -1px; right: -1px; border-top: 2px solid #fff; border-right: 2px solid #fff; }
  .deploy-theme .c-bl { bottom: -1px; left: -1px; border-bottom: 2px solid #fff; border-left: 2px solid #fff; }
  .deploy-theme .c-br { bottom: -1px; right: -1px; border-bottom: 2px solid #fff; border-right: 2px solid #fff; }

  .deploy-theme .inp {
    width: 100%; background: #0e0e0e; border: 1px solid #232323; padding: .85rem 1rem; color: #fff; outline: none; transition: border-color .25s, box-shadow .25s; font-size: .95rem;
  }
  .deploy-theme .inp::placeholder { color: #4c4c4c; }
  .deploy-theme .inp:focus { border-color: #fff; box-shadow: 0 0 0 1px #fff; }

  .deploy-theme .sel-card {
    position: relative; background: #0e0e0e; border: 1px solid #232323; cursor: pointer; transition: all .28s cubic-bezier(.16,1,.3,1); overflow: hidden;
  }
  .deploy-theme .sel-card:hover { transform: translateY(-3px); border-color: #5a5a5a; }
  .deploy-theme .sel-card.selected { border-color: #fff; background: #131313; box-shadow: 0 0 0 1px #fff, 0 14px 40px -14px rgba(255,255,255,.25); }
  .deploy-theme .sel-card .tick {
    position: absolute; top: 8px; right: 8px; width: 18px; height: 18px; background: #fff; color: #000; display: flex; align-items: center; justify-content: center; opacity: 0; transform: scale(.3); transition: all .3s cubic-bezier(.34,1.56,.64,1);
  }
  .deploy-theme .sel-card.selected .tick { opacity: 1; transform: scale(1); }
  .deploy-theme .soft-card .ic { color: #4c4c4c; transition: all .3s; }
  .deploy-theme .soft-card:hover .ic { color: #cfcfcf; }
  .deploy-theme .soft-card.selected .ic { color: #fff; filter: drop-shadow(0 0 8px rgba(255,255,255,.5)); }

  .deploy-theme .btn-white { position: relative; overflow: hidden; background: #fff; color: #000; }
  .deploy-theme .btn-white::before { content: ''; position: absolute; inset: 0; background: #000; transform: translateY(101%); transition: transform .35s cubic-bezier(.16,1,.3,1); }
  .deploy-theme .btn-white:hover:not(:disabled)::before { transform: translateY(0); }
  .deploy-theme .btn-white > * { position: relative; z-index: 1; transition: color .35s; }
  .deploy-theme .btn-white:hover:not(:disabled) > * { color: #fff; }
  .deploy-theme .btn-white:disabled { opacity: .35; cursor: not-allowed; }

  .deploy-theme .btn-ghost { background: transparent; border: 1px solid #232323; color: #8f8f8f; transition: all .25s; }
  .deploy-theme .btn-ghost:hover:not(:disabled) { border-color: #fff; color: #fff; }
  .deploy-theme .btn-ghost:disabled { opacity: .3; cursor: not-allowed; }

  .deploy-theme .dot { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border: 1px solid #232323; background: #0b0b0b; font-size: 12px; color: #4c4c4c; transition: all .35s cubic-bezier(.16,1,.3,1); }
  .deploy-theme .dot.active { border-color: #fff; color: #fff; box-shadow: 0 0 0 1px #fff, 0 0 22px -4px rgba(255,255,255,.5); }
  .deploy-theme .dot.done { background: #fff; color: #000; border-color: #fff; }
  .deploy-theme .conn-fill { height: 100%; background: #fff; width: 0; transition: width .5s cubic-bezier(.16,1,.3,1); }

  .deploy-theme .anim-forward { animation: sR .5s cubic-bezier(.16,1,.3,1); }
  .deploy-theme .anim-back { animation: sL .5s cubic-bezier(.16,1,.3,1); }
  @keyframes sR { from { opacity: 0; transform: translateX(46px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes sL { from { opacity: 0; transform: translateX(-46px); } to { opacity: 1; transform: translateX(0); } }

  .deploy-theme .pulse-dot { animation: pd 2.4s infinite; }
  @keyframes pd { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,.35); } 50% { box-shadow: 0 0 0 6px rgba(255,255,255,0); } }

  .deploy-theme .warn {
    border: 1px solid rgba(251,191,36,.45); background: rgba(251,191,36,.08);
    padding: 1rem; display: flex; gap: .75rem; align-items: flex-start;
  }
`;

type Template = { distro: string; release: string; label: string; image: string; logo: string };

const CPU_PRESETS = [1, 2, 4, 8];
const MEMORY_PRESETS_GB = [1, 2, 4, 8, 16];
const DISK_PRESETS_GB = [10, 25, 50, 100];
const STEPS = ["IDENTITY", "IMAGE", "RESOURCES", "DEVICES", "REVIEW"];

/** Mirrors the server-side sanitizer so the preview matches what the runtime gets. */
function toContainerName(input: string) {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[._-]+$/, "");
  return (cleaned || "vps").slice(0, 40);
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 border transition-colors"
      style={{
        width: 48,
        height: 26,
        background: checked ? "#fff" : "#0e0e0e",
        borderColor: checked ? "#fff" : "#232323",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2"
        style={{
          width: 18,
          height: 18,
          left: checked ? 26 : 4,
          background: checked ? "#000" : "#8f8f8f",
          transition: "left .25s cubic-bezier(.16,1,.3,1), background .25s",
        }}
      />
    </button>
  );
}

/** Editable numeric field, paired with the core/GB preset buttons. */
function NumberField({
  value,
  min,
  max,
  onChange,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          const parsed = Number(raw);
          if (raw.trim() === "" || !isFinite(parsed)) return;
          onChange(Math.min(max, Math.max(min, Math.round(parsed))));
        }}
        className="w-24 border border-[#232323] bg-[#0e0e0e] px-3 py-2 text-center font-mono text-xs text-white outline-none transition-colors focus:border-white"
      />
      <span className="font-mono text-[11px] tracking-widest text-[#4c4c4c]">{unit}</span>
    </div>
  );
}

export default function DeployVps() {
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [arches, setArches] = useState<string[]>(["amd64"]);
  const [available, setAvailable] = useState(false);
  const [canProvision, setCanProvision] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [nestedBlocked, setNestedBlocked] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");

  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [arch, setArch] = useState("amd64");
  const [cpu, setCpu] = useState(1);
  const [memoryGb, setMemoryGb] = useState(1);
  const [diskGb, setDiskGb] = useState(10);
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodeId, setNodeId] = useState("");
  const [cpuModel, setCpuModel] = useState("");
  const [motherboard, setMotherboard] = useState("");
  // Ports are auto-allocated when the operator leaves them blank.
  const [portFrom, setPortFrom] = useState("");
  const [portTo, setPortTo] = useState("");
  const [sshHostPort, setSshHostPort] = useState("");

  const [enableKvm, setEnableKvm] = useState(false);
  const [enableAllDevices, setEnableAllDevices] = useState(false);
  const [allowDocker, setAllowDocker] = useState(false);
  const [hostKvm, setHostKvm] = useState(false);
  const [hostFuse, setHostFuse] = useState(false);
  const [hostVirt, setHostVirt] = useState("");

  const [nameError, setNameError] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");

  // Mirrors the server's port rules so the operator sees a problem before the
  // request is sent, instead of reading a rejection afterwards.
  const portRangeNotice = useMemo(() => {
    const fromRaw = portFrom.trim();
    const toRaw = portTo.trim();
    if (!fromRaw && !toRaw) {
      return { bad: false, text: "NO RANGE SET — A FREE BLOCK OF 10 PORTS WILL BE ASSIGNED." };
    }
    if (!fromRaw || !toRaw) {
      return { bad: true, text: "ENTER BOTH ENDS OF THE RANGE, OR NEITHER FOR AUTO-ASSIGN." };
    }
    const from = Number(fromRaw);
    const to = Number(toRaw);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return { bad: true, text: "PORTS MUST BE WHOLE NUMBERS." };
    }
    if (from < 1024 || to > 65535) {
      return { bad: true, text: "PORTS MUST BE BETWEEN 1024 AND 65535." };
    }
    if (to < from) {
      return { bad: true, text: "THE END OF THE RANGE CANNOT BE LOWER THAN ITS START." };
    }
    const span = to - from + 1;
    if (span > 100) {
      return { bad: true, text: `THAT RANGE COVERS ${span} PORTS — THE MAXIMUM IS 100.` };
    }
    return { bad: false, text: `${span} PORT${span === 1 ? "" : "S"} RESERVED (${from}–${to}).` };
  }, [portFrom, portTo]);

  // The forward is the only way in, so a bad value is worth catching here.
  const sshPortNotice = useMemo(() => {
    const raw = sshHostPort.trim();
    if (!raw) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return { bad: true, text: "THE SSH PORT MUST BE A WHOLE NUMBER BETWEEN 1024 AND 65535." };
    }
    return null;
  }, [sshHostPort]);

  const loadStatus = React.useCallback(() => {
    return axios
      .get("/api/vps/status")
      .then((res) => {
        setTemplates(res.data.templates || []);
        setArches(res.data.arches || ["amd64"]);
        setArch((current) => (res.data.arches?.includes(current) ? current : (res.data.arches?.[0] || "amd64")));
        setAvailable(res.data.available === true);
        setSimulated(res.data.simulated === true);
        setNestedBlocked(res.data.nestedBlocked === true);
        setCanProvision(res.data.canProvision !== false);
        setReason(res.data.reason || "");
        setHostKvm(res.data.hostKvm === true);
        setHostFuse(res.data.hostFuse === true);
        setHostVirt(res.data.hostVirt || "");
        setTemplateKey((current) => {
          if (current) return current;
          const first = res.data.templates?.[0];
          return first ? `${first.distro}|${first.release}` : "";
        });
      })
      .catch((err) => setError(err.response?.data?.error || "Failed to read the container driver status"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Available nodes for the placement selector.
  useEffect(() => {
    axios
      .get("/api/nodes")
      .then((res) => {
        const list = res.data || [];
        setNodes(list);
        setNodeId((current) => current || list[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  const selected = useMemo(
    () => templates.find((t) => `${t.distro}|${t.release}` === templateKey),
    [templates, templateKey],
  );

  const containerName = toContainerName(name);

  const goTo = (next: number, direction: "forward" | "back") => {
    setDir(direction);
    setStep(next);
    setMaxVisited((m) => Math.max(m, next));
  };

  const next = () => {
    if (step === 0) {
      if (!name.trim()) return setNameError("VPS name is required.");
      if (name.trim().length > 40) return setNameError("Keep the name to 40 characters or fewer.");
      setNameError("");
    }
    if (step < STEPS.length - 1) goTo(step + 1, "forward");
  };

  const back = () => {
    if (step > 0) goTo(step - 1, "back");
    else navigate("/vps");
  };

  const submit = async () => {
    setError("");
    if (!canProvision) return setError("No container runtime is available yet.");
    if (!selected) return setError("Choose an OS image.");
    if (portRangeNotice.bad) return setError(portRangeNotice.text);
    if (sshPortNotice?.bad) return setError(sshPortNotice.text);

    setDeploying(true);
    try {
      await axios.post("/api/vps", {
        name: name.trim(),
        distro: selected.distro,
        release: selected.release,
        arch,
        cpu,
        memoryMb: memoryGb * 1024,
        diskGb,
        enableKvm,
        enableAllDevices,
        allowDocker,
        nodeId,
        cpuModel: cpuModel.trim(),
        motherboard: motherboard.trim(),
        portFrom: portFrom.trim() ? Number(portFrom) : 0,
        portTo: portTo.trim() ? Number(portTo) : 0,
        sshHostPort: sshHostPort.trim() ? Number(sshHostPort) : 0,
        // Containers sit on the private bridge only; no public IPv4 is assigned.
        // The bridge itself is left to the server default so no runtime name ships to the browser.
        networkMode: "private-bridge",
      });
      navigate("/vps");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to create the VPS");
      setDeploying(false);
    }
  };

  const reviewRow = (k: string, v: string) => (
    <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[#4c4c4c] tracking-widest text-[11px] font-mono">{k}</span>
      <span className="text-white text-right truncate font-mono">{v}</span>
    </div>
  );

  if (loading) {
    return (
      <div className="deploy-theme">
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
        <div className="flex min-h-[60vh] items-center justify-center font-mono text-xs tracking-widest text-[#8f8f8f]">
          LOADING…
        </div>
      </div>
    );
  }

  return (
    <div className="deploy-theme">
      <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      <div className="noise"></div>
      <div className="bg-grid"></div>
      <div className="scanline"></div>

      {/* Progress Line */}
      <div
        style={{
          position: "fixed", top: 0, left: 0, height: "2px", width: "100%", zIndex: 100,
          background: "#fff", transformOrigin: "left",
          transform: `scaleX(${(step + 1) / STEPS.length})`,
          boxShadow: "0 0 12px rgba(255,255,255,.7)", transition: "transform .5s cubic-bezier(.16,1,.3,1)",
        }}
      />

      <div className="relative z-10">
        <nav className="sticky top-0 z-50 border-b border-[#232323] bg-[#050505]/90 backdrop-blur-md">
          <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
            <button
              onClick={() => navigate("/vps")}
              className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-[#8f8f8f] hover:text-white transition-colors border border-[#232323] px-3 py-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> VPS SERVERS
            </button>
            <a href="#" onClick={(e) => { e.preventDefault(); navigate("/vps"); }} className="flex items-center gap-3 group">
              <span className="font-display font-bold text-lg tracking-wide">
                IVM <span className="text-[#8f8f8f] font-medium">PANEL</span>
              </span>
              <div className="w-7 h-7 bg-white flex items-center justify-center group-hover:rotate-45 transition-transform duration-500">
                <div className="w-3.5 h-3.5 bg-black"></div>
              </div>
            </a>
          </div>
        </nav>

        <main className="max-w-3xl mx-auto px-5 pt-12 pb-16">
          <header className="mb-10">
            <p className="font-mono text-[11px] tracking-[0.3em] text-[#4c4c4c] mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-white rounded-full pulse-dot"></span> NEW VPS
            </p>
            <h1 className="font-display font-bold tracking-tight text-4xl md:text-5xl">DEPLOY VPS</h1>
          </header>

          {!available && (
            <div className="warn mb-6">
              <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-display font-bold tracking-widest text-sm text-amber-200">CONTAINER RUNTIME NOT FOUND</p>
                <p className="mt-1.5 font-mono text-[11px] text-amber-200/80 leading-relaxed">
                  {reason || "No container runtime is available on this host."}
                </p>
                <p className="mt-2 font-mono text-[11px] font-bold uppercase tracking-widest text-amber-100">
                  CLICK THE BUTTON BELOW TO INSTALL
                </p>
                {hostVirt === "lxc" && (
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-amber-300">
                    NOTE — THIS HOST IS ITSELF CONTAINERISED, SO IT CANNOT CREATE FURTHER CONTAINERS.
                    RUN THE PANEL ON A VM OR DEDICATED HOST FOR REAL PROVISIONING.
                  </p>
                )}
                <div className="mt-3">
                  <VpsInstallButton variant="dark" onReady={loadStatus} />
                </div>
              </div>
            </div>
          )}

          {nestedBlocked && (
            <div className="warn mb-6">
              <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-display font-bold tracking-widest text-sm text-amber-200">
                  NESTED VIRTUALISATION UNAVAILABLE
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-amber-200/80 leading-relaxed">
                  {reason ||
                    "This host is itself a container, so nested VPS cannot be created here. Run the panel on a virtual machine or dedicated host to provision for real."}
                </p>
              </div>
            </div>
          )}

          {simulated && (
            <div className="mb-6 flex items-start gap-3 border border-sky-500/40 bg-sky-500/10 p-4">
              <Info className="w-5 h-5 shrink-0 text-sky-300" />
              <div className="min-w-0">
                <p className="font-display font-bold tracking-widest text-sm text-sky-200">SIMULATION MODE</p>
                <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-sky-200/80">
                  {nestedBlocked
                    ? "Operations are simulated in the panel because this host cannot create nested containers. The whole management UI works for testing — nothing real is provisioned."
                    : "This host has no container runtime, so VPS operations are simulated in the panel. The whole management UI works for testing — nothing real is provisioned. Set up a runtime to switch to real containers."}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 flex items-center gap-2 border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* Stepper */}
          <div className="mb-4">
            <div className="flex items-start">
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  <div className="flex flex-col items-center flex-shrink-0" style={{ width: "56px" }}>
                    <button
                      type="button"
                      onClick={() => { if (i <= maxVisited && i !== step && !deploying) goTo(i, i > step ? "forward" : "back"); }}
                      className={`dot font-mono ${i < step ? "done" : i === step ? "active" : ""}`}
                    >
                      {i < step ? <Check className="w-4 h-4 stroke-[3]" /> : String(i + 1).padStart(2, "0")}
                    </button>
                    <span className="hidden sm:block mt-2 font-mono text-[9px] tracking-widest text-[#4c4c4c] text-center">{s}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 h-px bg-[#232323] mt-[19px] mx-1">
                      <div className="conn-fill" style={{ width: i < step ? "100%" : "0%" }}></div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
            <p className="sm:hidden mt-4 font-mono text-[11px] tracking-widest text-[#8f8f8f] text-center">
              STEP {step + 1} OF {STEPS.length} — {STEPS[step]}
            </p>
          </div>

          <div className="relative border border-[#232323] bg-[#0b0b0b] p-6 md:p-9 mt-6">
            <span className="corner c-tl"></span><span className="corner c-tr"></span>
            <span className="corner c-bl"></span><span className="corner c-br"></span>

            <div className={dir === "forward" ? "anim-forward" : "anim-back"}>
              {step === 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <span className="font-mono text-xs text-[#4c4c4c]">01</span>
                    <h2 className="font-display font-bold tracking-wide text-sm">IDENTITY</h2>
                    <span className="flex-1 h-px bg-[#232323]"></span>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5">
                    <Server className="w-4 h-4" /> VPS Name <span className="text-white">*</span>
                  </label>
                  <input
                    type="text"
                    className="inp"
                    placeholder="e.g. web-01"
                    maxLength={40}
                    value={name}
                    onChange={(e) => { setName(e.target.value); setNameError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }}
                  />
                  <p className="mt-2 font-mono text-[11px] text-[#4c4c4c]">
                    CONTAINER NAME — <span className="text-[#8f8f8f]">{containerName}</span>
                  </p>
                  {nameError && (
                    <p className="mt-2 text-xs text-theme-400 font-mono flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> {nameError}
                    </p>
                  )}

                  <label className="mt-7 mb-2.5 flex items-center gap-2 text-sm text-[#8f8f8f]">
                    <Server className="w-4 h-4" /> Node
                  </label>
                  <select
                    value={nodeId}
                    onChange={(e) => setNodeId(e.target.value)}
                    className="w-full border border-[#232323] bg-[#0e0e0e] px-3 py-3 text-sm text-white outline-none transition-colors focus:border-white"
                  >
                    {nodes.length === 0 && <option value="">No node available</option>}
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {flagFor(n.countryCode)} {n.name}{n.location ? ` — ${n.location}` : ""}
                        {n.isLocal ? " (built-in)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 font-mono text-[11px] text-[#4c4c4c]">
                    PLACEMENT — THE VPS IS CREATED ON THIS NODE.
                  </p>

                  <div className="mt-7 border border-[#232323] bg-[#0e0e0e] p-4">
                    <p className="font-display text-xs font-bold uppercase tracking-widest text-[#8f8f8f]">
                      Hardware identity (cosmetic)
                    </p>
                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-[#4c4c4c]">
                      CONTAINERS SHARE THE HOST KERNEL, SO THESE LABELS ARE COSMETIC UNLESS THE WORKLOAD IS A VM.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs text-[#8f8f8f]">CPU Model</label>
                        <input
                          type="text"
                          value={cpuModel}
                          maxLength={80}
                          onChange={(e) => setCpuModel(e.target.value)}
                          placeholder="e.g. AMD EPYC 7763"
                          className="w-full border border-[#232323] bg-[#050505] px-3 py-2 text-xs text-white outline-none transition-colors focus:border-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[#8f8f8f]">Motherboard</label>
                        <input
                          type="text"
                          value={motherboard}
                          maxLength={80}
                          onChange={(e) => setMotherboard(e.target.value)}
                          placeholder="e.g. Supermicro H12SSL"
                          className="w-full border border-[#232323] bg-[#050505] px-3 py-2 text-xs text-white outline-none transition-colors focus:border-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-start gap-2 border border-[#232323] bg-[#0e0e0e] p-3">
                    <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8f8f8f]" />
                    <p className="font-mono text-[10px] leading-relaxed text-[#4c4c4c]">
                      NETWORK — PRIVATE BRIDGE, NAT WITH A PRIVATE ADDRESS. NO PUBLIC IPV4 IS ASSIGNED.
                    </p>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <span className="font-mono text-xs text-[#4c4c4c]">02</span>
                    <h2 className="font-display font-bold tracking-wide text-sm">IMAGE</h2>
                    <span className="flex-1 h-px bg-[#232323]"></span>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {templates.map((t) => {
                      const key = `${t.distro}|${t.release}`;
                      const active = key === templateKey;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setTemplateKey(key)}
                          className={`sel-card soft-card text-left p-4 ${active ? "selected" : ""}`}
                        >
                          <span className="tick"><Check className="w-3 h-3 stroke-[3]" /></span>
                          <div className="flex items-center gap-3">
                            <img src={t.logo} alt="" className="h-7 w-7 shrink-0 rounded" />
                            <div className="min-w-0">
                              <p className="font-display font-bold text-sm tracking-wide truncate">{t.label}</p>
                              <p className="font-mono text-[10px] text-[#4c4c4c] truncate">{t.image}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5 mt-7">
                    <Globe className="w-4 h-4" /> Architecture
                  </label>
                  <div className="flex gap-2.5">
                    {arches.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setArch(a)}
                        className={`sel-card soft-card px-4 py-2.5 font-mono text-xs tracking-widest ${arch === a ? "selected" : ""}`}
                      >
                        <span className="tick"><Check className="w-3 h-3 stroke-[3]" /></span>
                        <span className="flex items-center gap-2">
                          <Cpu className="ic w-4 h-4" /> {a.toUpperCase()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <span className="font-mono text-xs text-[#4c4c4c]">03</span>
                    <h2 className="font-display font-bold tracking-wide text-sm">RESOURCES</h2>
                    <span className="flex-1 h-px bg-[#232323]"></span>
                  </div>

                  <p className="mb-6 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                    PICK A QUICK PRESET OR TYPE AN EXACT VALUE — ALL SIZES ARE IN GB.
                  </p>

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5">
                    <Cpu className="w-4 h-4" /> vCPU Cores
                  </label>
                  <div className="mb-7 flex flex-wrap items-center gap-2.5">
                    {CPU_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCpu(p)}
                        className={`border px-3.5 py-2 font-mono text-xs tracking-widest transition-all ${cpu === p ? "border-white bg-white text-black" : "border-[#232323] text-[#8f8f8f] hover:border-[#5a5a5a] hover:text-white"}`}
                      >
                        {p} CORE{p > 1 ? "S" : ""}
                      </button>
                    ))}
                    <NumberField value={cpu} min={1} max={64} onChange={setCpu} unit="CORES" />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5">
                    <MemoryStick className="w-4 h-4" /> Memory
                  </label>
                  <div className="mb-7 flex flex-wrap items-center gap-2.5">
                    {MEMORY_PRESETS_GB.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setMemoryGb(p)}
                        className={`border px-3.5 py-2 font-mono text-xs tracking-widest transition-all ${memoryGb === p ? "border-white bg-white text-black" : "border-[#232323] text-[#8f8f8f] hover:border-[#5a5a5a] hover:text-white"}`}
                      >
                        {p} GB
                      </button>
                    ))}
                    <NumberField value={memoryGb} min={1} max={128} onChange={setMemoryGb} unit="GB RAM" />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5">
                    <HardDrive className="w-4 h-4" /> Disk
                  </label>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {DISK_PRESETS_GB.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDiskGb(p)}
                        className={`border px-3.5 py-2 font-mono text-xs tracking-widest transition-all ${diskGb === p ? "border-white bg-white text-black" : "border-[#232323] text-[#8f8f8f] hover:border-[#5a5a5a] hover:text-white"}`}
                      >
                        {p} GB
                      </button>
                    ))}
                    <NumberField value={diskGb} min={1} max={2000} onChange={setDiskGb} unit="GB DISK" />
                  </div>

                  <div className="mt-8 flex items-center gap-3 mb-5">
                    <span className="font-mono text-xs text-[#4c4c4c]">03B</span>
                    <h2 className="font-display font-bold tracking-wide text-sm">NETWORK &amp; PORTS</h2>
                    <span className="flex-1 h-px bg-[#232323]"></span>
                  </div>

                  <p className="mb-6 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                    THE VPS SITS ON A PRIVATE BRIDGE AND GETS NO PUBLIC IPV4. LEAVE A FIELD BLANK TO LET THE PANEL
                    ALLOCATE THE FIRST FREE PORTS.
                  </p>

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5">
                    <Network className="w-4 h-4" /> Port Range
                  </label>
                  <div className="mb-3 flex flex-wrap items-end gap-3">
                    <div>
                      <span className="mb-1.5 block font-mono text-[10px] tracking-widest text-[#4c4c4c]">FROM</span>
                      <input
                        type="number"
                        min={1024}
                        max={65535}
                        value={portFrom}
                        onChange={(e) => setPortFrom(e.target.value)}
                        placeholder="auto"
                        className="w-32 border border-[#232323] bg-[#0b0b0b] px-3 py-2.5 font-mono text-sm text-white outline-none transition-colors placeholder:text-[#3a3a3a] focus:border-white"
                      />
                    </div>
                    <span className="pb-3 font-mono text-[#4c4c4c]">—</span>
                    <div>
                      <span className="mb-1.5 block font-mono text-[10px] tracking-widest text-[#4c4c4c]">TO</span>
                      <input
                        type="number"
                        min={1024}
                        max={65535}
                        value={portTo}
                        onChange={(e) => setPortTo(e.target.value)}
                        placeholder="auto"
                        className="w-32 border border-[#232323] bg-[#0b0b0b] px-3 py-2.5 font-mono text-sm text-white outline-none transition-colors placeholder:text-[#3a3a3a] focus:border-white"
                      />
                    </div>
                    <span className="pb-3.5 font-mono text-[10px] leading-relaxed text-[#4c4c4c]">
                      UP TO 100 PORTS · 1024–65535
                    </span>
                  </div>
                  {portRangeNotice && (
                    <p className={`mb-7 flex items-center gap-1.5 font-mono text-[11px] ${portRangeNotice.bad ? "text-[#ff8a8a]" : "text-[#8f8f8f]"}`}>
                      {portRangeNotice.bad && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                      {portRangeNotice.text}
                    </p>
                  )}

                  <label className="flex items-center gap-2 text-sm text-[#8f8f8f] mb-2.5">
                    <Terminal className="w-4 h-4" /> SSH Port Forward
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={sshHostPort}
                      onChange={(e) => setSshHostPort(e.target.value)}
                      placeholder="auto"
                      className="w-32 border border-[#232323] bg-[#0b0b0b] px-3 py-2.5 font-mono text-sm text-white outline-none transition-colors placeholder:text-[#3a3a3a] focus:border-white"
                    />
                    <span className="font-mono text-[10px] leading-relaxed text-[#4c4c4c]">
                      HOST PORT → TCP 22 INSIDE THE VPS
                    </span>
                  </div>
                  {sshPortNotice && (
                    <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-[#ff8a8a]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {sshPortNotice.text}
                    </p>
                  )}
                  <p className="mt-3 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                    ONCE DEPLOYED YOU CAN REACH THE GUEST WITH{" "}
                    <span className="text-white">ssh root@&lt;node-address&gt; -p {sshHostPort.trim() || "<port>"}</span> — THE
                    FORWARD IS CREATED AS PART OF THE DEPLOY.
                  </p>
                </div>
              )}

              {step === 3 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <span className="font-mono text-xs text-[#4c4c4c]">04</span>
                    <h2 className="font-display font-bold tracking-wide text-sm">DEVICES</h2>
                    <span className="flex-1 h-px bg-[#232323]"></span>
                  </div>

                  <p className="mb-6 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                    OFF BY DEFAULT. ENABLE THESE ONLY WHEN THE WORKLOAD INSIDE THE CONTAINER NEEDS HOST DEVICES.
                  </p>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-6 border border-[#232323] bg-[#0e0e0e] p-4">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-display font-bold text-sm tracking-wide">
                          <Zap className="w-4 h-4" /> ENABLE KVM
                        </p>
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                          Exposes /dev/kvm so the container can run virtual machines (nested virtualisation).
                        </p>
                        {!hostKvm && !simulated && (
                          <p className="mt-1 font-mono text-[11px] text-amber-300">
                            UNAVAILABLE — THIS HOST HAS NO /dev/kvm
                          </p>
                        )}
                      </div>
                      <Toggle checked={enableKvm} disabled={!hostKvm && !simulated} onChange={setEnableKvm} />
                    </div>

                    <div className="flex items-start justify-between gap-6 border border-[#232323] bg-[#0e0e0e] p-4">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-display font-bold text-sm tracking-wide">
                          <Box className="w-4 h-4" /> ENABLE DOCKER
                        </p>
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                          Lets the VPS run Docker / containerd inside it (container-in-container), including the
                          syscall interception Docker needs{hostFuse ? " and /dev/fuse for fuse-overlayfs" : ""}.
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-[#4c4c4c]">
                          security.nesting + syscalls.intercept.mknod/setxattr
                        </p>
                      </div>
                      <Toggle checked={allowDocker} onChange={setAllowDocker} />
                    </div>

                    <div className="flex items-start justify-between gap-6 border border-[#232323] bg-[#0e0e0e] p-4">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-display font-bold text-sm tracking-wide">
                          <Layers className="w-4 h-4" /> ENABLE ALL DEVICES (NO KVM)
                        </p>
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                          Full device access for container-in-container workloads: Docker, containerd, FUSE
                          {hostFuse ? " (/dev/fuse available)" : " (/dev/fuse not present on this host)"}, and the
                          syscall interception Docker needs.
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-[#4c4c4c]">
                          security.nesting + syscalls.intercept.mknod/setxattr
                        </p>
                      </div>
                      <Toggle checked={enableAllDevices} onChange={setEnableAllDevices} />
                    </div>
                  </div>

                  {(enableKvm || enableAllDevices) && (
                    <div className="mt-5 border border-amber-500/30 bg-amber-500/5 p-4">
                      <p className="font-mono text-[11px] leading-relaxed text-amber-200/90">
                        Device access widens the container's attack surface. Only enable these when the workload
                        genuinely needs them.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <span className="font-mono text-xs text-[#4c4c4c]">05</span>
                    <h2 className="font-display font-bold tracking-wide text-sm">REVIEW</h2>
                    <span className="flex-1 h-px bg-[#232323]"></span>
                  </div>

                  <div className="font-mono text-[13px] divide-y divide-[#232323] border border-[#232323] bg-[#0e0e0e]">
                    {reviewRow("NAME", name.trim() || "—")}
                    {reviewRow("CONTAINER", containerName)}
                    {reviewRow("IMAGE", selected?.image || "—")}
                    {reviewRow("ARCH", arch)}
                    {reviewRow("VCPU", `${cpu}`)}
                    {reviewRow("MEMORY", `${memoryGb} GB`)}
                    {reviewRow("DISK", `${diskGb} GB`)}
                    {reviewRow("DOCKER", allowDocker ? "ENABLED" : "DISABLED")}
                    {reviewRow("NODE", nodes.find((n) => n.id === nodeId)?.name || "—")}
                    {reviewRow("CPU MODEL", cpuModel.trim() || "HOST DEFAULT")}
                    {reviewRow("MOTHERBOARD", motherboard.trim() || "HOST DEFAULT")}
                    {reviewRow("NETWORK", "PRIVATE BRIDGE (NO PUBLIC IPV4)")}
                    {reviewRow(
                      "PORT RANGE",
                      portFrom.trim() && portTo.trim()
                        ? `${portFrom.trim()}–${portTo.trim()}`
                        : "AUTO (FIRST FREE 10 PORTS)",
                    )}
                    {reviewRow("SSH FORWARD", "HOST " + (sshHostPort.trim() || "AUTO") + " → TCP 22")}
                    {reviewRow("KVM", enableKvm ? "ENABLED" : "DISABLED")}
                    {reviewRow("ALL DEVICES", enableAllDevices ? "ENABLED (DOCKER / FUSE)" : "DISABLED")}
                  </div>

                  <div className="mt-6 border border-[#232323] bg-[#0e0e0e] p-4">
                    <p className="font-mono text-[11px] leading-relaxed text-[#8f8f8f]">
                      The root filesystem is fetched on the host, so provisioning can take a few minutes. Memory and
                      CPU limits are applied to the container automatically.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-9 flex items-center justify-between gap-3">
              <button type="button" onClick={back} disabled={deploying} className="btn-ghost px-5 py-3 font-mono text-xs tracking-widest">
                <span className="flex items-center gap-2">
                  <ArrowLeft className="w-3.5 h-3.5" /> {step === 0 ? "CANCEL" : "BACK"}
                </span>
              </button>

              {step < STEPS.length - 1 ? (
                <button type="button" onClick={next} className="btn-white px-6 py-3 font-mono text-xs tracking-widest font-bold">
                  <span className="flex items-center gap-2">CONTINUE <ArrowLeft className="w-3.5 h-3.5 rotate-180" /></span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={deploying || !canProvision}
                  className="btn-white px-6 py-3 font-mono text-xs tracking-widest font-bold"
                >
                  <span className="flex items-center gap-2">
                    <Rocket className="w-3.5 h-3.5" /> {deploying ? "PROVISIONING…" : "DEPLOY VPS"}
                  </span>
                </button>
              )}
            </div>
          </div>

          <p className="mt-5 flex items-center justify-center gap-2 font-mono text-[10px] tracking-widest text-[#4c4c4c]">
            <Cloud className="w-3 h-3" /> SYSTEM VPS · SHARED KERNEL · PRIVATE BRIDGE
          </p>
        </main>
      </div>
    </div>
  );
}
