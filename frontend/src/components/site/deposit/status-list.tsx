import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusLine = {
  label: string;
};

type Props = {
  lines: StatusLine[];
  /** number of lines completed; lines[done] (if any) is in-progress */
  done: number;
  className?: string;
};

/**
 * A staged status list (e.g. Signing → Broadcasting → Confirmed). This is
 * information, so it renders under reduced motion too — only the spinner spin
 * is suppressed. Each line carries icon + label; never color alone.
 */
export function StatusList({ lines, done, className }: Props) {
  return (
    <ul className={cn("flex flex-col gap-2.5 text-left", className)}>
      {lines.map((line, i) => {
        const complete = i < done;
        const active = i === done;
        return (
          <li
            key={line.label}
            className="flex items-center gap-2.5 font-mono text-[0.8125rem]"
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
                <span className="size-1.5 rounded-full bg-faint/50" aria-hidden />
              )}
            </span>
            <span
              className={cn(
                complete && "text-muted-ink",
                active && "text-ink",
                !complete && !active && "text-faint",
              )}
            >
              {line.label}
              {complete && <span className="sr-only"> — done</span>}
              {active && <span className="sr-only"> — in progress</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
