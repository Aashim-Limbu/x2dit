import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Interactive filing grid — the hero's ledger paper, now alive. Each cell fills
 * with a faint stamp-red wash on hover, as if you're marking boxes on a form.
 * Pure CSS :hover (no per-cell JS), so a thousand cells stay smooth, and it
 * degrades to an instant fill under reduced motion (global transition reset).
 *
 * Decorative: aria-hidden, and the outer layer is pointer-events-none so it
 * never blocks the hero. The inner grid re-enables pointer events to catch
 * hover; the hero marks its own interactive controls pointer-events-auto so
 * they still sit "above" the grid.
 */

const ROWS = 26;
const COLS = 46;

// Shades within the stamp-red family — analogous hues (≈9–47), varied lightness.
// Same category, never a rainbow. Each cell is assigned one deterministically so
// hover variation looks scattered but stays SSR-stable.
const SHADES = [
  "oklch(0.68 0.150 25)", // light coral
  "oklch(0.58 0.200 32)", // bright vermilion
  "oklch(0.50 0.200 27)", // stamp red
  "oklch(0.43 0.175 20)", // brick
  "oklch(0.35 0.140 16)", // deep maroon
];

// stable per-index hash → shade bucket (no Math.random: SSR-safe, no hydration drift)
function shadeFor(i: number): string {
  const h = ((i ^ 61) * 2654435761) >>> 0;
  return SHADES[h % SHADES.length];
}

const CELLS = Array.from({ length: ROWS * COLS });

export function FilingGrid({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        // z-0 (NOT a negative z): a negative-z child paints behind the parent's
        // background, which makes the section itself swallow the pointer and the
        // cells never get :hover. z-0 keeps it under the z-10 content but hittable.
        "pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden",
        "[mask-image:radial-gradient(ellipse_82%_72%_at_50%_42%,#000_24%,transparent_80%)]",
        className,
      )}
    >
      <div
        className="pointer-events-auto grid shrink-0"
        style={{
          gridTemplateColumns: `repeat(${COLS}, 2.25rem)`,
          gridAutoRows: "2.25rem",
        }}
      >
        {CELLS.map((_, i) => (
          <div
            key={i}
            className="filing-cell"
            style={{ "--cell": shadeFor(i) } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
