import { cn } from "@/lib/utils";

// Film-grain over the navy — premium depth, not a web3 glow grid.
// Fixed, non-interactive, static (no animation), so it's inert under
// reduced-motion by construction. aria-hidden. Sits at z-0 behind content
// (content lives in stacking contexts above it) and never intercepts events.
const NOISE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

/**
 * `intensity` scales the grain opacity (default 1 ≈ 0.045). Pass a lower value
 * (e.g. 0.5) for paper-heavy pages — daylight wants less grain.
 */
export function GrainOverlay({
  className,
  intensity = 1,
}: {
  className?: string;
  intensity?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-0 mix-blend-soft-light",
        className,
      )}
      style={{
        backgroundImage: `url("${NOISE}")`,
        backgroundSize: "160px 160px",
        opacity: 0.045 * intensity,
      }}
    />
  );
}
