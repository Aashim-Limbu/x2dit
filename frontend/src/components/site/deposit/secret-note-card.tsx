"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Key,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CtaButton } from "../cta-button";

type Props = {
  /** the (mock) secret note string */
  secret: string;
  /** human amount line, e.g. "100 USDC" */
  amountLabel: string;
  /** advance to the sealed state once acknowledged */
  onDone: () => void;
};

/**
 * The lifeline — the single most carefully designed surface in the deposit
 * flow. A SOLID weighted --surface card with a --gold hairline (explicitly NOT
 * glass): the note must feel like a physical safe-deposit key. Gravity copy
 * (wonder is spent), three confirmed-state backup affordances, and a real
 * acknowledgement gate that keeps "Done" disabled until the user confirms.
 */
export function SecretNoteCard({ secret, amountLabel, onDone }: Props) {
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [acked, setAcked] = useState(false);

  const masked = "•".repeat(Math.min(secret.length, 56));

  function copy() {
    void navigator.clipboard?.writeText(secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  function download() {
    // mock .txt blob — format only, no real crypto
    const blob = new Blob([secret + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zk-houdini-note.txt";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2200);
  }

  return (
    <div className="flex flex-col gap-6 text-left">
      <header className="flex flex-col gap-2">
        <h2 className="text-display-card text-ink">The vanish is complete.</h2>
        <p className="text-muted-ink">
          …now you don&rsquo;t. Here&rsquo;s your only way back.
        </p>
      </header>

      {/* THE NOTE — solid, gold hairline, never glass, never animated */}
      <div className="rounded-2xl border border-gold/45 bg-surface p-5 shadow-panel sm:p-6">
        <div className="flex items-center gap-2 text-gold">
          <Key className="size-4" aria-hidden />
          <span className="text-sm font-medium">Your secret note</span>
        </div>

        <pre
          className="mt-4 overflow-hidden rounded-lg bg-bg/60 p-4 font-mono text-[0.95rem] font-medium leading-relaxed tracking-[0.01em] text-ink"
          style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
          aria-label="secret note value"
        >
          {revealed ? secret : masked}
        </pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-sm transition-colors duration-[var(--dur-fast)]",
              copied
                ? "border-success/40 text-success"
                : "text-muted-ink hover:bg-[var(--hover-tint)] hover:text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            )}
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>

          <button
            type="button"
            onClick={download}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-sm transition-colors duration-[var(--dur-fast)]",
              downloaded
                ? "border-success/40 text-success"
                : "text-muted-ink hover:bg-[var(--hover-tint)] hover:text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            )}
          >
            {downloaded ? <Check className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {downloaded ? "Downloaded" : "Download"}
          </button>

          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-pressed={!revealed}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-sm text-muted-ink transition-colors duration-[var(--dur-fast)] hover:bg-[var(--hover-tint)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {revealed ? "Hide" : "Reveal"}
          </button>
        </div>
      </div>

      {/* GRAVITY copy — calm, serious, contrast-safe */}
      <div className="flex items-start gap-3 rounded-xl border border-gold/30 bg-bg-2/60 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
        <p className="text-sm leading-relaxed text-ink">
          This note is the <strong className="font-semibold">only</strong> thing
          that can withdraw your {amountLabel}. We can&rsquo;t recover it. If you
          lose it, the funds stay in the pool forever.
        </p>
      </div>

      {/* acknowledgement gate — deliberately slows the highest-anxiety moment */}
      <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-ink">
        <input
          type="checkbox"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <span>
          I&rsquo;ve saved my note. I understand it can&rsquo;t be recovered.
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <CtaButton onClick={onDone} disabled={!acked} size="lg" className="w-full sm:w-auto">
          Done
        </CtaButton>
        {!acked && (
          <p className="text-xs text-faint">
            Save your note and tick the box above to continue.
          </p>
        )}
      </div>
    </div>
  );
}
