import { ArrowRight } from "lucide-react";
import { CtaButton } from "@/components/site/cta-button";
import { Reveal } from "@/components/site/reveal";
import { REPO_URL } from "@/lib/site";

// Widths of the blacked-out "lines" behind the heading — a redacted page.
const LINES = ["86%", "64%", "92%", "48%", "74%", "58%"];

export function ClosingCta() {
  return (
    <section className="relative overflow-hidden bg-[var(--ink-panel)] text-[var(--on-ink)]">
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-5 py-28 text-center sm:px-8 sm:py-40">
        {/* a fully redacted document, faint behind the message */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 flex w-[min(90%,40rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3.5 [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_30%,transparent_80%)]"
        >
          {LINES.map((w, i) => (
            <span
              key={i}
              className="h-3.5 rounded-[2px] bg-[oklch(0.955_0.004_248/0.07)]"
              style={{ width: w }}
            />
          ))}
        </div>

        <Reveal className="relative z-10 flex flex-col items-center gap-6">
          <h2 className="text-display-hero max-w-[18ch] text-balance text-[var(--on-ink)]">
            Bridge it. Leave no trail.
          </h2>

          <p className="max-w-[52ch] text-[1.0625rem] leading-relaxed text-[var(--on-ink-muted)] text-pretty">
            Lock your first deposit and break the link between the two chains. It
            takes about a minute, and the privacy is permanent.
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <CtaButton href="/deposit" size="lg">
              Make a private deposit
              <ArrowRight className="size-4" aria-hidden />
            </CtaButton>
            <CtaButton
              href={REPO_URL}
              external
              variant="glass"
              size="lg"
              className="!border-[color-mix(in_oklch,var(--on-ink)_45%,transparent)] !text-[var(--on-ink)] hover:!border-[var(--on-ink)] hover:!bg-[oklch(1_0_0/0.08)]"
            >
              View the source
            </CtaButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
