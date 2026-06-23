"use client";

import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { GlowOrb } from "@/components/site/glow-orb";

/**
 * ACT II climax — the emerge-from-orb reveal. The orb blooms, then a "100 zUSDC"
 * figure precipitates and sharpens out of the glow. ~1600ms (--dur-climax),
 * then onDone() advances to the revealed result so the user is never stranded.
 *
 * Reduced motion: NO coalesce, NOT routed through any motion timing for meaning.
 * We render the figure + a ShieldCheck + the captions directly (already present),
 * and fire onDone after a short, non-load-bearing delay. Meaning is carried by
 * the rendered DOM + copy + icon, never by motion.
 */
export function RevealClimax({
  figure,
  onDone,
}: {
  /** e.g. "100 zUSDC" — the value reappearing. */
  figure: string;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();

  useEffect(() => {
    // Both paths auto-advance; reduced motion gets a brief, non-meaningful beat.
    const t = window.setTimeout(onDone, reduced ? 350 : 1600);
    return () => window.clearTimeout(t);
  }, [onDone, reduced]);

  return (
    <div
      className="relative flex min-h-[44vh] flex-col items-center justify-center text-center"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <GlowOrb size="md" intensity={reduced ? 0.55 : 1} />
      </div>

      {reduced ? (
        // Instant, transition-free result — meaning in the markup, not motion.
        <div className="flex flex-col items-center">
          <ShieldCheck className="size-7 text-success" aria-hidden />
          <p className="mt-4 font-display text-[clamp(2rem,6vw,3.25rem)] font-semibold tracking-[-0.03em] text-ink">
            {figure}
          </p>
          <p className="mt-3 text-sm text-muted-ink">
            And now you don&rsquo;t&hellip; you do.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {/* the figure coalescing out of the bloom: blurred + scaled-up → sharp */}
          <motion.p
            initial={{ opacity: 0, scale: 1.35, filter: "blur(14px)", y: 6 }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)", y: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
            className="font-display text-[clamp(2rem,6vw,3.25rem)] font-semibold tracking-[-0.03em] text-ink"
            style={{ textShadow: "0 0 38px oklch(0.80 0.13 200 / 0.55)" }}
          >
            {figure}
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.9 }}
            className="mt-3 text-sm text-muted-ink"
          >
            And now you don&rsquo;t&hellip; you do.
          </motion.p>
        </div>
      )}
    </div>
  );
}
