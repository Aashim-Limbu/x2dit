"use client";

import { Lock, ShieldCheck, Zap } from "lucide-react";
import { motion } from "motion/react";
import { Section, SectionHeading } from "@/components/site/section";
import { Reveal } from "@/components/site/reveal";
import { useMotionReady } from "@/lib/use-anim";
import { EVM, STELLAR } from "@/lib/site";

const STEPS = [
  {
    index: 1,
    icon: Lock,
    title: "Lock",
    tag: `on ${EVM.short}`,
    description:
      "Commit USDC into the pool and receive a secret note — the only key to your funds, so back it up.",
  },
  {
    // ShieldCheck, not Eye — the eye metaphor belongs to WhyPrivate's EyeOff.
    index: 2,
    icon: ShieldCheck,
    title: "Prove",
    tag: "zero-knowledge",
    description:
      "A zero-knowledge proof shows you're one of the depositors without revealing which deposit is yours.",
  },
  {
    index: 3,
    icon: Zap,
    title: "Reappear",
    tag: `on ${STELLAR.short}`,
    description:
      "Claim the same value at a fresh Stellar address — no link, no trace, no trusted middleman.",
  },
] as const;

/**
 * The connector thread carries a single travelling dot Lock → Prove → Reappear
 * on scroll-in. Static gradient is the reduced-motion / no-JS fallback — the
 * pipeline reads correctly without any animation.
 */
function ConnectorThread({ vertical }: { vertical?: boolean }) {
  const animate = useMotionReady();
  return (
    <span
      aria-hidden
      className={[
        "absolute overflow-hidden",
        vertical
          ? "left-1/2 top-[3.5rem] h-[calc(100%-3.5rem)] w-px -translate-x-1/2 bg-gradient-to-b from-hairline via-hairline/40 to-transparent"
          : "left-[calc(50%+3.5rem)] top-[1.75rem] hidden h-px w-[calc(100%-7rem)] bg-gradient-to-r from-hairline via-hairline/40 to-transparent sm:block",
      ].join(" ")}
    >
      {animate && (
        <motion.span
          className={[
            "absolute bg-primary",
            vertical ? "left-0 h-6 w-px" : "top-0 h-px w-6",
          ].join(" ")}
          initial={vertical ? { top: "-1.5rem" } : { left: "-1.5rem" }}
          whileInView={vertical ? { top: "100%" } : { left: "100%" }}
          viewport={{ once: true, margin: "-20%" }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        />
      )}
    </span>
  );
}

export function HowItWorks() {
  return (
    <Section id="how" tone="navy" seam>
      <Reveal>
        <SectionHeading
          title="How the bridge works"
          lead="Three steps. No link survives between them."
          tone="navy"
        />
      </Reveal>

      <ol
        aria-label="Steps to use the bridge"
        className="relative mt-16 flex flex-col items-stretch gap-0 sm:flex-row sm:items-start"
      >
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const isLast = i === STEPS.length - 1;

          return (
            <Reveal
              as="li"
              index={i}
              key={step.index}
              className="relative flex flex-1 flex-col items-center text-center sm:px-4"
            >
              {!isLast && (
                <>
                  <ConnectorThread vertical />
                  <ConnectorThread />
                </>
              )}

              {/* Node */}
              <div
                className={[
                  "relative z-10 flex size-14 shrink-0 items-center justify-center",
                  "rounded-[var(--radius-md)] border border-hairline bg-surface shadow-panel",
                ].join(" ")}
              >
                <Icon className="size-5 stroke-[1.5] text-ink" aria-hidden />
                <span
                  className={[
                    "absolute -right-2 -top-2 flex size-5 items-center justify-center",
                    "rounded-[3px] border border-primary/40 bg-surface",
                    "font-mono text-[0.65rem] font-semibold text-primary",
                  ].join(" ")}
                  aria-hidden
                >
                  {step.index}
                </span>
              </div>

              {/* Text */}
              <div className="mt-6 pb-16 sm:pb-0">
                <h3 className="text-display-card text-ink">{step.title}</h3>

                {/* sentence-case mono marker — not an uppercase tracked eyebrow */}
                <p className="mt-1.5 font-mono text-xs text-faint">{step.tag}</p>

                <p className="mx-auto mt-3 max-w-[24ch] text-[0.9375rem] leading-relaxed text-muted-ink">
                  {step.description}
                </p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </Section>
  );
}
