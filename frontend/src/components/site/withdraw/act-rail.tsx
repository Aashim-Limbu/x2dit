"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type RailStep = {
  /** 1-based step number shown in the badge. */
  n: number;
  label: string;
};

type StepState = "done" | "current" | "future";

/**
 * Persistent, legible source of truth for the flow's position. Status is carried
 * by number + label + ring shape + a Check glyph on completion — never color
 * alone, so it survives reduced motion and color-blindness. The whole rail is an
 * aria-live region; the active step is aria-current="step".
 */
export function ActRail({
  steps,
  active,
  className,
}: {
  steps: RailStep[];
  /** index (0-based) of the current step. */
  active: number;
  className?: string;
}) {
  return (
    <ol
      aria-label="Progress"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-3 sm:gap-x-3",
        className,
      )}
    >
      {steps.map((step, i) => {
        const state: StepState =
          i < active ? "done" : i === active ? "current" : "future";
        return (
          <li
            key={step.n}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-medium tabular-nums transition-colors",
                state === "done" &&
                  "border-success/50 bg-success/15 text-success",
                state === "current" &&
                  "border-primary bg-primary/15 text-primary-bright ring-2 ring-primary/40",
                state === "future" && "border-hairline text-faint",
              )}
            >
              {state === "done" ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                step.n
              )}
            </span>
            <span
              className={cn(
                "text-xs font-medium sm:text-[0.8125rem]",
                state === "current" && "text-ink",
                state === "done" && "text-muted-ink",
                state === "future" && "text-faint",
              )}
            >
              {step.label}
              {state === "done" && <span className="sr-only"> (done)</span>}
              {state === "current" && <span className="sr-only"> (current step)</span>}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="mx-0.5 hidden h-px w-5 bg-hairline sm:block"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
