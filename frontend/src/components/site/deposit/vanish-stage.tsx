"use client";

import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { GlowOrb } from "../glow-orb";

type Props = {
  /** the figure that vanishes, e.g. "100 USDC" */
  figure: string;
  /** called when the climax finishes (or immediately under reduced motion) */
  onDone: () => void;
};

const CLIMAX_MS = 1600;

/**
 * THE VANISH (§4b). The deposit figure scales up, its glyphs disperse/blur and
 * are drawn toward the orb center, which blooms gold→cyan as it swallows the
 * value. Caption fades in beneath. ~1600ms, ease-out-expo. No sparkles.
 *
 * Reduced motion: the parent never routes here — it renders the note result
 * tree directly. But as a safety net this component still calls onDone() and
 * shows the figure statically with a caption, never stranding the user.
 */
export function VanishStage({ figure, onDone }: Props) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const t = setTimeout(onDone, reduced ? 0 : CLIMAX_MS);
    return () => clearTimeout(t);
  }, [onDone, reduced]);

  const glyphs = figure.split("");

  if (reduced) {
    // Should not normally render (parent skips the climax), but stay legible.
    return (
      <div className="relative flex min-h-[44vh] flex-col items-center justify-center">
        <p className="font-mono text-3xl font-semibold text-ink">{figure}</p>
        <p className="mt-6 text-muted-ink">Now you see it…</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[44vh] flex-col items-center justify-center overflow-hidden">
      {/* the orb blooms behind, swallowing the value */}
      <motion.div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        initial={{ scale: 0.7, opacity: 0.45 }}
        animate={{ scale: [0.7, 1.18, 0.96], opacity: [0.45, 1, 0.9] }}
        transition={{ duration: CLIMAX_MS / 1000, ease: [0.16, 1, 0.3, 1] }}
      >
        <GlowOrb size="md" />
      </motion.div>

      {/* the figure scales up, then its glyphs disperse toward the core */}
      <div className="relative z-10 flex items-center justify-center">
        {glyphs.map((g, i) => {
          const mid = (glyphs.length - 1) / 2;
          const dir = i - mid;
          return (
            <motion.span
              key={i}
              className="inline-block font-mono text-4xl font-semibold text-ink sm:text-5xl"
              style={{ whiteSpace: "pre" }}
              initial={{ x: 0, y: 0, scale: 1, opacity: 1, filter: "blur(0px)" }}
              animate={{
                x: [0, dir * 6, dir * -2],
                scale: [1, 1.18, 0.2],
                opacity: [1, 1, 0],
                filter: ["blur(0px)", "blur(0px)", "blur(8px)"],
              }}
              transition={{
                duration: CLIMAX_MS / 1000,
                ease: [0.16, 1, 0.3, 1],
                times: [0, 0.45, 1],
                delay: Math.abs(dir) * 0.02,
              }}
            >
              {g}
            </motion.span>
          );
        })}
      </div>

      <motion.p
        className="relative z-10 mt-10 text-lg text-muted-ink"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1] }}
        transition={{ duration: CLIMAX_MS / 1000, ease: "easeOut", times: [0, 0.5, 1] }}
      >
        Now you see it…
      </motion.p>
    </div>
  );
}
