"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A staged status list (Signing → Broadcasting → Confirmed …). It is information,
 * so it renders fully under reduced motion (the spinner just stops spinning via
 * motion-reduce:animate-none). Each line carries icon + label, never color alone:
 * done = Check, active = spinner, pending = a hollow ring.
 */
export function StatusList({
  steps,
  /** number of completed steps (0..steps.length). The step at this index is "active". */
  done,
  className,
}: {
  steps: string[];
  done: number;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-2.5", className)}>
      {steps.map((label, i) => {
        const complete = i < done;
        const active = i === done;
        return (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2.5 text-sm transition-colors",
              complete && "text-ink",
              active && "text-ink",
              !complete && !active && "text-faint",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              {complete ? (
                <Check className="size-4 text-success" aria-hidden />
              ) : active ? (
                <Loader2
                  className="size-4 animate-spin text-primary-bright motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <span
                  aria-hidden
                  className="size-3 rounded-full border border-hairline"
                />
              )}
            </span>
            <span>{label}</span>
            {complete && <span className="sr-only"> — done</span>}
            {active && <span className="sr-only"> — in progress</span>}
          </li>
        );
      })}
    </ul>
  );
}
