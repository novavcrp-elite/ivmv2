import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

type InstallState = "idle" | "installing" | "done" | "error";

/**
 * Runs the panel's one-click LXD install (apt + snapd + snap install lxd +
 * lxd init --auto) and polls until the driver reports ready.
 */
export function VpsInstallButton({ onReady, variant = "light" }: { onReady?: () => void; variant?: "light" | "dark" }) {
  const [state, setState] = useState<InstallState>("idle");
  const [message, setMessage] = useState("");
  const [log, setLog] = useState("");
  const [showLog, setShowLog] = useState(false);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const res = await axios.get("/api/vps/install-status");
      setLog(res.data.log || "");

      if (res.data.available) {
        setState("done");
        setMessage(`Container runtime ready (driver: ${res.data.driver}).`);
        onReady?.();
        return false;
      }
      if (res.data.running) {
        setState("installing");
        setMessage("Installing the container runtime — this can take a few minutes…");
        return true;
      }
      if (typeof res.data.exitCode === "number" && res.data.exitCode !== 0) {
        setState("error");
        setMessage(`Install failed (exit ${res.data.exitCode}). Check the log below.`);
        return false;
      }
      setState("error");
      setMessage(res.data.reason || "The container runtime is still not reachable after the install.");
      return false;
    } catch (err: any) {
      setState("error");
      setMessage(err.response?.data?.error || "Failed to read the install status");
      return false;
    }
  }, [onReady]);

  // If an install was already running before this page mounted, keep watching it.
  useEffect(() => {
    let active = true;
    axios
      .get("/api/vps/install-status")
      .then((res) => {
        if (!active) return;
        if (res.data.running) {
          setState("installing");
          setMessage("Installing the container runtime — this can take a few minutes…");
          setShowLog(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state !== "installing") return;
    timer.current = window.setInterval(async () => {
      const keepGoing = await poll();
      if (!keepGoing && timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    }, 4000);
    return () => {
      if (timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [state, poll]);

  const start = async () => {
    setState("installing");
    setMessage("Starting the installer…");
    setShowLog(true);
    try {
      await axios.post("/api/vps/install");
    } catch (err: any) {
      setState("error");
      setMessage(err.response?.data?.error || "Failed to start the installation");
    }
  };

  const dark = variant === "dark";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={state === "installing" || state === "done"}
          className={
            dark
              ? "inline-flex items-center gap-2 border border-white/60 bg-white/10 px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-white transition-all duration-200 hover:border-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
              : "inline-flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-amber-100 shadow-sm shadow-amber-500/10 transition-all duration-200 hover:border-amber-300 hover:bg-amber-500/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          }
          title="Install LXD (apt-get update && apt-get upgrade -y && apt-get install -y snapd && snap install lxd && lxd init --auto)"
        >
          {state === "installing" ? (
            <Loader2 className="h-4 w-4 animate-spin stroke-[2.5]" />
          ) : state === "done" ? (
            <Check className="h-4 w-4 stroke-[3]" />
          ) : (
            <AlertTriangle className="h-4 w-4 stroke-[2.5]" />
          )}
          {state === "idle" && "INSTALL NOW"}
          {state === "installing" && "INSTALLING…"}
          {state === "done" && "INSTALLED"}
          {state === "error" && "RETRY INSTALL"}
        </button>
        {message && (
          <span className={`text-xs ${state === "error" ? "text-red-400" : "opacity-80"}`}>{message}</span>
        )}
        {log && (
          <button
            type="button"
            onClick={() => setShowLog((s) => !s)}
            className={`font-mono text-[10px] font-semibold uppercase tracking-widest underline-offset-4 transition-colors hover:underline ${dark ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            {showLog ? "HIDE LOG" : "SHOW LOG"}
          </button>
        )}
      </div>

      {showLog && log && (
        <pre className="max-h-56 overflow-auto rounded-lg border border-[#232323] bg-black/70 p-3 font-mono text-[10px] leading-relaxed text-[#9a9a9a] whitespace-pre-wrap">
{log}
        </pre>
      )}
    </div>
  );
}
