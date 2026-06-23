"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { DENOMS } from "@/lib/site";
import { cn } from "@/lib/utils";

type Props = {
  value: number | null;
  onChange: (value: number) => void;
};

/**
 * Denomination picker — a role="radiogroup" of cards from DENOMS. Selected
 * carries a --primary ring + Check (not color alone). Arrow keys move the
 * selection; roving tabindex keeps it keyboard-operable.
 */
export function DenomPicker({ value, onChange }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % DENOMS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + DENOMS.length) % DENOMS.length;
    else return;
    e.preventDefault();
    onChange(DENOMS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Choose a deposit amount"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {DENOMS.map((d, i) => {
        const selected = value === d.value;
        const tabbable = selected || (value === null && i === 0);
        return (
          <button
            key={d.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(d.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex flex-col items-start gap-1 rounded-xl border bg-surface p-4 text-left transition-all duration-[var(--dur-ui)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              selected
                ? "border-transparent shadow-glow ring-2 ring-primary-bright"
                : "border-hairline hover:-translate-y-0.5 hover:bg-[var(--hover-tint)]",
            )}
          >
            {selected && (
              <Check
                className="absolute right-3 top-3 size-4 text-primary-bright"
                aria-hidden
              />
            )}
            <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
              {d.value}
            </span>
            <span className="font-mono text-xs text-faint">USDC</span>
            <span className="mt-1 text-xs text-muted-ink">
              becomes {d.value} zUSDC on Stellar
            </span>
          </button>
        );
      })}
    </div>
  );
}
