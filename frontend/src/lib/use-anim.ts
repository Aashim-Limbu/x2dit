"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Returns true only after mount AND when motion is allowed.
 *
 * `useReducedMotion()` reads the media query, which differs between the server
 * (always false) and a reduced-motion client (true) — so any component that
 * branches its *rendered DOM* on it hydration-mismatches. Gating on mount makes
 * SSR and the first client render identical (the static branch); motion is
 * opted into only after hydration. Entrance reveals still play on mount because
 * the content is visible at rest and the animation enhances from there.
 */
export function useMotionReady(): boolean {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready && !reduced;
}
