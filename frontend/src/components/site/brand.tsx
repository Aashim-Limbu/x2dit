import { cn } from "@/lib/utils";

/** The mark: a top hat in clean ink strokes, its band redacted with a black bar. */
export function HatMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("h-6 w-6", className)}>
      <path
        d="M7.4 17.5 L7 5.4 Q7 4.3 8.1 4.3 L15.9 4.3 Q17 4.3 17 5.4 L16.6 17.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="12" cy="18" rx="10" ry="2.2" stroke="currentColor" strokeWidth="1.3" />
      {/* redacted band — a true-black bar across the hat */}
      <rect x="7" y="12.7" width="10" height="2.9" rx="0.4" fill="var(--redact)" />
    </svg>
  );
}

export function Wordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <HatMark className={cn("text-ink", markClassName)} />
      <span className="font-display text-[1.2rem] font-semibold leading-none tracking-tight text-ink">
        zk<span className="text-faint">·</span>houdini
      </span>
    </span>
  );
}
