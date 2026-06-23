import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type RailStep = {
  /** short label shown under the marker */
  label: string;
};

type Props = {
  steps: RailStep[];
  /** zero-based index of the active step */
  current: number;
  className?: string;
};

/**
 * The persistent, legible source of truth for both flows. Status is carried by
 * number + label + icon + ring shape — never color alone — so it survives
 * reduced motion and color-blindness. Wrapped in an aria-live region by the
 * stage shell so step transitions are announced.
 */
export function ActRail({ steps, current, className }: Props) {
  return (
    <ol
      className={cn(
        "flex w-full items-start justify-between gap-1 text-center",
        className,
      )}
    >
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.label}
            aria-current={active ? "step" : undefined}
            className="flex flex-1 flex-col items-center gap-2"
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[0.7rem] tabular-nums transition-colors duration-[var(--dur-ui)]",
                done && "border-success/40 bg-success/15 text-success",
                active && "border-primary-bright bg-primary/15 text-ink ring-2 ring-primary-bright/40",
                !done && !active && "border-hairline text-faint",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[0.7rem] leading-tight sm:text-xs",
                active ? "text-ink" : done ? "text-muted-ink" : "text-faint",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
