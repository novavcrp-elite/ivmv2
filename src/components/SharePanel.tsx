import React, { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, ImageOff, Megaphone, Share2 } from "lucide-react";
import { useSettings } from "../context/SettingsContext";

/**
 * Builds the promo block an operator can paste into Discord, WhatsApp, Telegram
 * etc. Messengers render the trailing image URL as a logo preview, so the logo
 * link is only useful when it is an absolute http(s) URL.
 */
function usePromoText() {
  const { panelName, panelLogo } = useSettings();

  return useMemo(() => {
    const name = (panelName || "IVM Panel").trim();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const logoRaw = (panelLogo || "/ivm-logo.png").trim();
    const logoUrl = /^https?:\/\//i.test(logoRaw)
      ? logoRaw
      : logoRaw.startsWith("/")
        ? `${origin}${logoRaw}`
        : "";
    // A data: URL cannot be fetched by a messenger, so it is left out rather
    // than pasted as a wall of base64.
    const logoUsable = Boolean(logoUrl) && !/^data:/i.test(logoUrl);

    const lines = [
      "🎮 A WEB-BASED GAME & VPS SERVER MANAGEMENT PANEL",
      "🖥️ GAME SERVER MANAGEMENT • ☁️ VPS MANAGEMENT",
      "📁 FILE MANAGER • 💻 WEB TERMINAL • 👤 ACCOUNT MANAGEMENT",
      "🌐 PLAYIT INTEGRATION • ⚡ SERVER CONTROL & MONITORING",
      "",
      "🚀 POWERFUL • MODERN • FAST • ALL-IN-ONE",
      "",
      `${name} → ${origin}`,
    ];
    if (logoUsable) lines.push(logoUrl);

    return { name, origin, logoUrl: logoUsable ? logoUrl : "", logoUsable, text: lines.join("\n") };
  }, [panelName, panelLogo]);
}

export function SharePanel() {
  const { name, origin, logoUrl, logoUsable, text } = usePromoText();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  // Falls back to a manual selection when the clipboard API is unavailable
  // (the panel can be reached over plain http, where it is blocked).
  const selectAll = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    (e.target as HTMLTextAreaElement).select();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-lg bg-theme-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-theme-500"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied to clipboard" : "Copy promo text"}
        </button>
        <a
          href={origin}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-theme-500/60 hover:text-theme-300"
        >
          <ExternalLink className="h-4 w-4" /> Open panel
        </a>
        {!copied && (
          <span className="font-mono text-[10px] text-muted-foreground">
            If nothing copies, click the block and press Ctrl/Cmd + C.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-background/60 p-4">
        {logoUsable ? (
          <img
            src={logoUrl}
            alt="Panel logo"
            className="h-16 w-16 rounded-xl object-cover ring-1 ring-white/10"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-widest text-foreground">
            <Megaphone className="h-4 w-4" /> Share / invite
          </p>
          <p className="mt-1 max-w-xl font-mono text-[11px] leading-relaxed text-muted-foreground">
            {logoUsable
              ? "Paste this into Discord, WhatsApp or Telegram. The logo link sits on the last line so the messenger renders it as the preview image."
              : "Your panel logo is uploaded as an image file, which messengers cannot fetch. Upload the logo to a public URL, or set one under Branding, then the link will be included automatically."}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <Share2 className="h-3.5 w-3.5" /> {name} — ready to paste
        </p>
        <textarea
          readOnly
          value={text}
          onClick={selectAll}
          rows={9}
          spellCheck={false}
          className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors focus:border-theme-600"
        />
      </div>
    </div>
  );
}
