"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useMotionReady } from "@/lib/use-anim";

const EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * The hero signature — "the redacted link."
 *
 * A deposit on Ethereum and a withdrawal on Stellar sit at either end. Between
 * them the link is drawn… then a true-black redaction bar slams across and
 * blacks it out — the deposit↔withdrawal link, made unrecoverable. That is the
 * literal cryptographic fact, rendered as a document redaction.
 *
 * The message is fully legible at rest: under reduced motion (or no JS) the
 * link renders already redacted. When motion is allowed, the sequence plays on
 * mount and can be replayed — it re-enacts the act of redaction, it never
 * reveals what was hidden.
 */

function Endpoint({
  chain,
  role,
  glyph,
  align,
}: {
  chain: string;
  role: string;
  glyph: string;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1 rounded-[var(--radius-md)] border border-hairline bg-surface px-4 py-3 shadow-panel",
        align === "right" ? "items-end text-right" : "items-start text-left",
      )}
    >
      <span className="flex items-center gap-1.5 font-mono text-[0.7rem] font-medium tracking-[0.12em] text-ink">
        <span aria-hidden className="text-faint">
          {glyph}
        </span>
        {chain}
      </span>
      <span className="font-mono text-[0.65rem] text-faint">{role}</span>
    </div>
  );
}

export function RedactedLink({ className }: { className?: string }) {
  const animate = useMotionReady();
  const [replay, setReplay] = useState(0);

  // Shared sequence — endpoints settle, the link draws, the bar redacts it,
  // then the caption files in. Reused for mount + each replay (keyed remount).
  const link = (
    <div className="relative flex min-w-0 flex-1 flex-col items-center px-2">
      {/* the track */}
      <div className="relative h-7 w-full">
        {/* drawn link (dotted) — covered by the bar once redacted */}
        {animate ? (
          <motion.span
            key={`line-${replay}`}
            aria-hidden
            className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 origin-left border-t border-dashed border-ink/60"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: [0, 1, 1] }}
            transition={{ duration: 0.6, delay: 0.4, ease: EXPO }}
          />
        ) : null}

        {/* the redaction bar */}
        <motion.span
          key={`bar-${replay}`}
          aria-hidden
          className="redaction absolute left-0 top-1/2 flex h-7 w-full -translate-y-1/2 origin-left items-center justify-center rounded-[3px]"
          initial={animate ? { scaleX: 0 } : false}
          animate={animate ? { scaleX: 1 } : undefined}
          transition={{ duration: 0.42, delay: 1.05, ease: EXPO }}
        >
          <motion.span
            className="font-mono text-[0.6rem] font-medium tracking-[0.3em] text-surface"
            initial={animate ? { opacity: 0 } : false}
            animate={animate ? { opacity: 1 } : undefined}
            transition={{ duration: 0.3, delay: 1.4 }}
          >
            REDACTED
          </motion.span>
        </motion.span>
      </div>

      {/* caption — files in under the bar */}
      <motion.span
        key={`cap-${replay}`}
        className="mt-2 font-mono text-[0.62rem] tracking-wide text-faint"
        initial={animate ? { opacity: 0, y: 3 } : false}
        animate={animate ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.35, delay: 1.55, ease: EXPO }}
      >
        no on-chain link
      </motion.span>
    </div>
  );

  const body = (
    <div className="flex w-full items-start justify-center gap-3 sm:gap-5">
      {animate ? (
        <motion.div
          key={`eth-${replay}`}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: EXPO }}
        >
          <Endpoint chain="ETHEREUM" role="deposit · locked" glyph="Ξ" align="left" />
        </motion.div>
      ) : (
        <Endpoint chain="ETHEREUM" role="deposit · locked" glyph="Ξ" align="left" />
      )}

      <div className="flex flex-1 flex-col items-center pt-3.5">{link}</div>

      {animate ? (
        <motion.div
          key={`xlm-${replay}`}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: EXPO }}
        >
          <Endpoint chain="STELLAR" role="withdrawal · minted" glyph="✦" align="right" />
        </motion.div>
      ) : (
        <Endpoint chain="STELLAR" role="withdrawal · minted" glyph="✦" align="right" />
      )}
    </div>
  );

  // When motion is allowed, the whole exhibit replays the redaction on click.
  if (animate) {
    return (
      <button
        type="button"
        onClick={() => setReplay((n) => n + 1)}
        aria-label="Replay the redaction: a deposit on Ethereum and a withdrawal on Stellar, with the link between them blacked out"
        className={cn(
          "group block w-full cursor-pointer rounded-[var(--radius-md)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
          className,
        )}
        title="Replay"
      >
        {body}
      </button>
    );
  }

  return (
    <div
      role="img"
      aria-label="A deposit on Ethereum and a withdrawal on Stellar, with the link between them redacted"
      className={cn("w-full", className)}
    >
      {body}
    </div>
  );
}
