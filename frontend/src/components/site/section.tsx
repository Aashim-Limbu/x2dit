import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

/**
 * Full-bleed section wrapper with consistent max-width + vertical rhythm.
 * `tone="paper"` flips to the daylight panel (light bg, dark ink) for the
 * navy↔paper alternation. `bare` drops the inner padding/container.
 * `seam` adds a static 1px hairline→transparent top edge for premium boundaries.
 * `reveal` opts the inner content into the translate-only scroll reveal.
 */
export function Section({
  id,
  tone = "navy",
  seam = false,
  reveal = false,
  className,
  innerClassName,
  children,
}: {
  id?: string;
  tone?: "navy" | "navy-2" | "paper";
  seam?: boolean;
  reveal?: boolean;
  className?: string;
  innerClassName?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <div className={cn("mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28", innerClassName)}>
      {children}
    </div>
  );
  return (
    <section
      id={id}
      className={cn(
        "relative scroll-mt-24",
        tone === "paper" && "section-paper",
        tone === "navy-2" && "bg-bg-2",
        seam &&
          "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-hairline before:to-transparent",
        className,
      )}
    >
      {reveal ? <Reveal>{inner}</Reveal> : inner}
    </section>
  );
}

/** Centered section heading + optional lead. Display heading, no eyebrow. */
export function SectionHeading({
  title,
  lead,
  align = "center",
  tone = "navy",
  className,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "center" | "left";
  tone?: "navy" | "paper";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className,
      )}
    >
      <h2 className="text-display-section text-balance">{title}</h2>
      {lead && (
        <p
          className={cn(
            "mt-4 max-w-[60ch] text-[1.0625rem] leading-relaxed text-pretty",
            align === "center" && "mx-auto",
            tone === "paper" ? "text-paper-muted" : "text-muted-ink",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
