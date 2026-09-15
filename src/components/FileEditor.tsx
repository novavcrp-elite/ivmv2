import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  AlertTriangle, Check, Copy, FileWarning, Loader2, RefreshCw, Save, WrapText, X,
} from "lucide-react";

type Loaded = {
  name: string;
  size: number;
  modified: string;
  binary: boolean;
  truncated: boolean;
  editableLimit: number;
  content: string | null;
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/**
 * Text editor for the file manager.
 *
 * Replaces an inline textarea that only accepted a hardcoded list of
 * extensions and read whole files with no size limit. Here the server decides
 * what is editable (binary detection + a size cap) and the editor reports that
 * honestly rather than showing mojibake or hanging on a multi-hundred-MB log.
 */
export default function FileEditor({
  serverId,
  filePath,
  onClose,
  showToast,
}: {
  serverId: string;
  filePath: string;
  onClose: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const dirty = content !== original;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/servers/${serverId}/files/read`, {
        params: { path: filePath },
      });
      const data: Loaded = res.data;
      setFile(data);
      const text = data.content ?? "";
      setContent(text);
      setOriginal(text);
    } catch (e: any) {
      const message = e?.response?.data?.error || "Failed to open file";
      setError(message);
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  }, [serverId, filePath]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the line-number gutter aligned with the textarea's scroll position.
  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const save = useCallback(async () => {
    if (isSaving || !dirty || !file || file.binary) return;
    setIsSaving(true);
    try {
      const res = await axios.post(`/api/servers/${serverId}/files/save`, {
        filePath,
        content,
      });
      setOriginal(content);
      setFile((prev) =>
        prev
          ? { ...prev, size: res.data?.size ?? prev.size, modified: res.data?.modified ?? prev.modified }
          : prev,
      );
      showToast(`Saved ${file.name}`, "success");
    } catch (e: any) {
      showToast(e?.response?.data?.error || "Failed to save file", "error");
    } finally {
      setIsSaving(false);
    }
  }, [content, dirty, file, filePath, isSaving, serverId, showToast]);

  const requestClose = () => {
    // Losing typed changes silently is the classic editor complaint.
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  // Ctrl/Cmd+S saves; Tab inserts two spaces instead of leaving the field.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart, selectionEnd, value } = el;
      const next = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
      setContent(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 2;
      });
    }
  };

  const lineCount = useMemo(() => content.split("\n").length, [content]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("Clipboard is blocked on plain-http installs", "error");
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-white/10 bg-black/20">
        <FileWarning size={15} className="text-theme-500 shrink-0" />
        <span className="font-mono text-sm text-foreground truncate max-w-[240px]" title={filePath}>
          {file?.name || filePath.split("/").pop()}
        </span>
        {dirty && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
            UNSAVED
          </span>
        )}
        {file && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {formatBytes(file.size)} · {lineCount} lines
          </span>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={() => setShowLineNumbers((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold transition ${
              showLineNumbers
                ? "border-theme-500/50 text-theme-400 bg-theme-500/10"
                : "border-white/15 text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle line numbers"
          >
            #
          </button>
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold inline-flex items-center gap-1 transition ${
              wrap
                ? "border-theme-500/50 text-theme-400 bg-theme-500/10"
                : "border-white/15 text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle word wrap"
          >
            <WrapText size={13} />
          </button>
          <button
            type="button"
            onClick={copyAll}
            disabled={!file || file.binary}
            className="px-2 py-1 rounded border border-white/15 text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-40"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="px-2 py-1 rounded border border-white/15 text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-40"
            title="Reload from disk"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || isSaving || !file || file.binary}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide inline-flex items-center gap-1.5 transition bg-theme-600 text-white hover:bg-theme-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isSaving ? "Saving" : "Save"}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="px-2 py-1.5 rounded-lg border border-white/15 text-muted-foreground hover:text-foreground"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Notices */}
      {file?.binary && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs bg-amber-500/10 border-b border-amber-500/30 text-amber-200">
          <AlertTriangle size={14} />
          This looks like a binary file, so it is not shown here. Download it instead.
        </div>
      )}
      {file?.truncated && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs bg-amber-500/10 border-b border-amber-500/30 text-amber-200">
          <AlertTriangle size={14} />
          Showing the first {formatBytes(file.editableLimit)} of {formatBytes(file.size)}. Saving will
          overwrite the file with what you see here.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs bg-red-500/10 border-b border-red-500/30 text-red-300">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Editor body */}
      {isLoading ? (
        <div className="flex-1 grid place-items-center text-muted-foreground text-sm gap-2">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : file && !file.binary ? (
        <div className="flex-1 min-h-0 flex bg-[#0b0f14]">
          {showLineNumbers && (
            <div
              ref={gutterRef}
              className="select-none overflow-hidden text-right font-mono text-[12px] leading-[1.55] text-white/25 py-3 px-2 border-r border-white/10 bg-black/30"
              style={{ minWidth: 52 }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={syncScroll}
            spellCheck={false}
            wrap={wrap ? "soft" : "off"}
            className="flex-1 min-h-0 resize-none bg-transparent text-[12.5px] leading-[1.55] font-mono text-white/90 p-3 outline-none caret-theme-400"
            style={{ tabSize: 2 }}
          />
        </div>
      ) : !error ? (
        <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
          Nothing to show.
        </div>
      ) : null}

      <div className="px-3 py-1.5 border-t border-white/10 text-[10px] text-muted-foreground font-mono flex items-center gap-3">
        <span>Ctrl/⌘+S save</span>
        <span>Tab indent</span>
        {file && <span className="ml-auto">{new Date(file.modified).toLocaleString()}</span>}
      </div>
    </div>
  );
}
