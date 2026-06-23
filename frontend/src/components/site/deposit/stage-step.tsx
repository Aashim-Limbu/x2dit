"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type Props = {
  /** changes when the visible step changes — drives the keyed transition */
  stepKey: string;
  children: React.ReactNode;
};

/**
 * Wraps a single flow step. Under full motion the step cross-fades via
 * AnimatePresence (mode="wait"). Under reduced motion the global CSS reset
 * zeroes durations, so we render the tree DIRECTLY (no AnimatePresence) — the
 * swap is instant and meaning lives in the markup, never in a transition.
 * The region is aria-live so each new step heading is announced.
 */
export function StageStep({ stepKey, children }: Props) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div aria-live="polite" className="w-full">
        {children}
      </div>
    );
  }

  return (
    <div aria-live="polite" className="w-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={stepKey}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
