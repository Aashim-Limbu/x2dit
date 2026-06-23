"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Wraps the active step's tree. With motion allowed it crossfades between steps
 * (AnimatePresence, mode="wait"). Under reduced motion it renders the current
 * tree directly — NO AnimatePresence — because the global CSS reset zeroes all
 * durations to ~0.001ms, which makes an AnimatePresence crossfade meaningless.
 * The `stepKey` drives the swap; each step heading should carry aria-live.
 */
export function StageStep({
  stepKey,
  children,
}: {
  stepKey: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    // Plain conditional render: instant, transition-free, never via AnimatePresence.
    return <div>{children}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={stepKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
