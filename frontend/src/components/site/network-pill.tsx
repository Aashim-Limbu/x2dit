import { cn } from "@/lib/utils";

/**
 * Honest "we're on testnet" chrome. Status is dot + shape + the explicit word
 * "Testnet" — never color alone, so it survives reduced motion and color-blindness.
 * The dot breathes; reduced motion stops the ping.
 */
export function NetworkPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 font-mono text-[0.6875rem] text-muted-ink",
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70 [animation-duration:2.4s] motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
      </span>
      Testnet
    </span>
  );
}
