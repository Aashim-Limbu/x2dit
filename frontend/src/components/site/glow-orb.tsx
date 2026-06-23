"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Color blobs that orbit the center; screen-blend so they add light over navy.
// Colors reference the orb palette tokens so the orb tracks the brand.
const BLOBS = [
  { c: "var(--primary)", size: "62%", top: "6%", left: "16%" },
  { c: "var(--cyan)", size: "55%", top: "30%", left: "40%" },
  { c: "var(--gold)", size: "44%", top: "44%", left: "20%" },
  { c: "var(--magenta)", size: "46%", top: "18%", left: "44%" },
  { c: "oklch(0.55 0.16 268)", size: "58%", top: "34%", left: "8%" },
];

// Anemone filaments radiating from the core (deterministic by index).
const FILAMENTS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  const r = i % 2 === 0 ? 86 : 70;
  const ex = 100 + Math.cos(a) * r;
  const ey = 100 + Math.sin(a) * r;
  const bend = i % 3 === 0 ? 16 : -12;
  const mx = 100 + Math.cos(a) * r * 0.55 - Math.sin(a) * bend;
  const my = 100 + Math.sin(a) * r * 0.55 + Math.cos(a) * bend;
  return `M100 100 Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
});

const SIZES = {
  sm: "max-w-[240px]",
  md: "max-w-[400px]",
  lg: "max-w-[540px]",
} as const;

type Props = {
  className?: string;
  /** visual scale — hero uses `lg`, flow backgrounds `md`, closing echo `sm`. */
  size?: keyof typeof SIZES;
  /** 0–1 overall opacity for dimmed/background instances (default 1). */
  intensity?: number;
};

/**
 * The luminous orb — the privacy pool made visible, the one sanctioned glow.
 * Reduced-motion → fully static. Pauses its rotations when scrolled offscreen
 * (21 blended layers are GPU-costly). aria-hidden; purely decorative.
 */
export function GlowOrb({ className, size = "lg", intensity = 1 }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [onscreen, setOnscreen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    const io = new IntersectionObserver(
      ([entry]) => setOnscreen(entry.isIntersecting),
      { rootMargin: "10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  // animate only when onscreen and motion is allowed
  const spin = !reduce && onscreen;

  return (
    <div
      ref={ref}
      className={cn("relative isolate mx-auto aspect-square w-full", SIZES[size], className)}
      style={{ opacity: intensity }}
      aria-hidden
    >
      {/* ambient halo */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 46%, oklch(0.62 0.17 280 / 0.40), transparent 62%)",
          filter: "blur(34px)",
        }}
      />

      {/* orbiting color blobs (additive light) */}
      <motion.div
        className="absolute inset-[10%]"
        style={{ willChange: "transform" }}
        animate={spin ? { rotate: 360 } : undefined}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      >
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-full mix-blend-screen"
            style={{
              width: b.size,
              height: b.size,
              top: b.top,
              left: b.left,
              background: `radial-gradient(circle, ${b.c}, transparent 68%)`,
              filter: "blur(30px)",
              opacity: 0.85,
            }}
          />
        ))}
      </motion.div>

      {/* counter-rotating filaments */}
      <motion.svg
        viewBox="0 0 200 200"
        className="absolute inset-[8%] h-[84%] w-[84%]"
        style={{ filter: "drop-shadow(0 0 4px oklch(0.80 0.13 200 / 0.5))", willChange: "transform" }}
        animate={spin ? { rotate: -360 } : undefined}
        transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
      >
        {FILAMENTS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={i % 3 === 0 ? "oklch(0.83 0.13 80 / 0.5)" : "oklch(0.85 0.10 205 / 0.45)"}
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        ))}
        {FILAMENTS.map((d, i) => {
          const end = d.split(" ").slice(-2);
          return (
            <circle
              key={`d${i}`}
              cx={end[0]}
              cy={end[1]}
              r={i % 2 === 0 ? 1.4 : 0.9}
              fill={i % 3 === 0 ? "oklch(0.90 0.10 85)" : "oklch(0.90 0.08 205)"}
              opacity="0.8"
            />
          );
        })}
      </motion.svg>

      {/* hot core */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, oklch(0.99 0.02 90) 0%, oklch(0.86 0.13 70) 38%, oklch(0.62 0.17 280 / 0.5) 70%, transparent 78%)",
          filter: "blur(2px)",
          boxShadow: "0 0 60px 10px oklch(0.83 0.13 80 / 0.45)",
        }}
        animate={spin ? { scale: [1, 1.08, 1], opacity: [0.92, 1, 0.92] } : undefined}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
