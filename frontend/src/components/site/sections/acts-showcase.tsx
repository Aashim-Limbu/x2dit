"use client";

import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { motion } from "motion/react";
import { Section, SectionHeading } from "@/components/site/section";
import { Reveal } from "@/components/site/reveal";
import { CtaButton } from "@/components/site/cta-button";
import { useMotionReady } from "@/lib/use-anim";
import { EVM, STELLAR } from "@/lib/site";

// Shared viewport config for the scroll-in motif beats.
const VIEW = { once: true, margin: "-20%" } as const;
const EXPO = [0.16, 1, 0.3, 1] as const;

/* ── Act I visual: a coin dissolving into the pool ─────────────────────────
   A clear indigo coin breaks apart and falls into a glowing pool — the deposit
   vanishing. Reads at rest; the scroll-in beat enacts the dissolve. Bright
   strokes + glow for the dark navy card. */
const FALL = [
  { cx: 70, cy: 60, r: 1.5 },
  { cx: 90, cy: 58, r: 1.2 },
  { cx: 78, cy: 70, r: 1.3 },
  { cx: 86, cy: 74, r: 1.0 },
  { cx: 80, cy: 64, r: 1.6 },
  { cx: 66, cy: 72, r: 1.0 },
  { cx: 94, cy: 70, r: 1.0 },
];

function VanishMotif() {
  const animate = useMotionReady();
  return (
    <svg
      viewBox="0 0 160 110"
      fill="none"
      aria-hidden
      role="img"
      className="h-[104px] w-full"
    >
      {/* the pool */}
      <ellipse cx="80" cy="92" rx="44" ry="7" fill="oklch(0.22 0.012 265 / 0.06)" />
      <path
        d="M40 92 Q80 86 120 92"
        stroke="oklch(0.22 0.012 265 / 0.45)"
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="round"
      />

      {/* particles breaking off, falling in */}
      {FALL.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill="oklch(0.22 0.012 265 / 0.55)"
          initial={animate ? { opacity: 0 } : false}
          whileInView={animate ? { opacity: [0, 1, 0.55] } : undefined}
          viewport={VIEW}
          transition={{ duration: 1.4, delay: 0.25 + i * 0.07, ease: EXPO }}
        />
      ))}

      {/* the coin, dissolving */}
      <motion.g
        initial={animate ? { opacity: 1, scale: 1 } : false}
        whileInView={animate ? { opacity: [1, 0.35], scale: [1, 1.1] } : undefined}
        viewport={VIEW}
        transition={{ duration: 1.6, ease: EXPO }}
        style={{ transformOrigin: "80px 44px" }}
      >
        <circle cx="80" cy="44" r="19" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
        <circle cx="80" cy="44" r="11" stroke="oklch(0.22 0.012 265 / 0.4)" strokeWidth="1" />
        <circle cx="80" cy="44" r="3" fill="var(--primary)" />
      </motion.g>
    </svg>
  );
}

/* ── Act II visual: value re-coalescing into a coin ────────────────────────
   Scattered points converge and a cyan coin precipitates out of them — the
   withdrawal reappearing at a fresh address. Mirror of the vanish. */
const RISE = [
  { cx: 80, cy: 24, r: 1.4 },
  { cx: 65, cy: 31, r: 1.1 },
  { cx: 95, cy: 31, r: 1.1 },
  { cx: 72, cy: 40, r: 1.3 },
  { cx: 88, cy: 40, r: 1.3 },
  { cx: 80, cy: 35, r: 1.0 },
];

function RevealMotif() {
  const animate = useMotionReady();
  return (
    <svg
      viewBox="0 0 160 110"
      fill="none"
      aria-hidden
      role="img"
      className="h-[104px] w-full"
    >
      {/* converging guide lines */}
      <path d="M64 30 L80 64" stroke="oklch(0.22 0.012 265 / 0.25)" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M96 30 L80 64" stroke="oklch(0.22 0.012 265 / 0.25)" strokeWidth="0.8" strokeLinecap="round" />

      {/* converging particles */}
      {RISE.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill="oklch(0.22 0.012 265 / 0.55)"
          initial={animate ? { opacity: 0, y: -8 } : false}
          whileInView={animate ? { opacity: [0, 1, 0.5], y: 0 } : undefined}
          viewport={VIEW}
          transition={{ duration: 1.3, delay: 0.15 + i * 0.06, ease: EXPO }}
        />
      ))}

      {/* the coin, precipitating out */}
      <motion.g
        initial={animate ? { opacity: 0, scale: 0.7 } : false}
        whileInView={animate ? { opacity: 1, scale: 1 } : undefined}
        viewport={VIEW}
        transition={{ duration: 1.4, delay: 0.3, ease: EXPO }}
        style={{ transformOrigin: "80px 72px" }}
      >
        <circle cx="80" cy="72" r="19" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
        <circle cx="80" cy="72" r="11" stroke="oklch(0.22 0.012 265 / 0.4)" strokeWidth="1" />
        <circle cx="80" cy="72" r="3.2" fill="var(--primary)" />
      </motion.g>
    </svg>
  );
}

/* ── Chain tag — a quiet ink file-label; the dot is the only differentiator ── */
function ChainTag({ chain }: { chain: "ethereum" | "stellar" }) {
  const isEth = chain === "ethereum";
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-[3px] border border-hairline bg-bg-2 px-3 py-1 font-mono text-[0.7rem] tracking-wide text-muted-ink">
      <span
        aria-hidden
        className={[
          "inline-block size-1.5 rounded-full",
          isEth ? "bg-ink" : "bg-primary",
        ].join(" ")}
      />
      {isEth ? EVM.name : STELLAR.name}
    </span>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */
export function ActsShowcase() {
  return (
    <Section id="acts" tone="navy" seam>
      <Reveal>
        <SectionHeading
          title="Two acts. One disappearance."
          lead="Lock on Ethereum, claim on Stellar — the link between them never exists."
        />
      </Reveal>

      <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* ── ACT I: The Vanish ──────────────────────────────────────────── */}
        <Reveal as="div" index={0}>
          <article className="flex h-full flex-col gap-6 rounded-[var(--radius-lg)] border border-hairline bg-surface p-8 shadow-panel">
            <span className="font-mono text-xs tracking-wide text-faint">Exhibit A · Act I</span>

            <VanishMotif />

            <h3 className="text-display-card text-ink">The Vanish</h3>

            <p className="max-w-[60ch] text-[0.9375rem] leading-relaxed text-muted-ink">
              Choose a denomination — 1, 10, or 100 USDC — and lock it into the
              pool contract on Ethereum. You receive a secret note. Nothing else
              leaves.
            </p>

            <p className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-ink">
              <KeyRound
                className="mt-0.5 size-4 shrink-0 text-primary"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                That note is the <strong className="font-semibold">only</strong>{" "}
                key to your funds. Back it up — lose it and they&rsquo;re gone for
                good.
              </span>
            </p>

            <div className="mt-auto flex flex-col items-start gap-4 pt-2">
              <ChainTag chain="ethereum" />
              <CtaButton href="/deposit" variant="primary" size="md">
                Lock funds
                <ArrowRight className="size-4" aria-hidden />
              </CtaButton>
            </div>
          </article>
        </Reveal>

        {/* ── ACT II: The Reveal ─────────────────────────────────────────── */}
        <Reveal as="div" index={1}>
          <article className="flex h-full flex-col gap-6 rounded-[var(--radius-lg)] border border-hairline bg-surface p-8 shadow-panel">
            <span className="font-mono text-xs tracking-wide text-faint">Exhibit B · Act II</span>

            <RevealMotif />

            <h3 className="text-display-card text-ink">The Reveal</h3>

            <p className="max-w-[60ch] text-[0.9375rem] leading-relaxed text-muted-ink">
              Bring your note to a fresh Stellar address. A zero-knowledge proof
              demonstrates pool membership without revealing which deposit you
              made — then the funds arrive.
            </p>

            {/* quiet inline link — asymmetric to Act I's solid button */}
            <div className="mt-auto flex flex-col items-start gap-4 pt-2">
              <ChainTag chain="stellar" />
              <Link
                href="/withdraw"
                className="inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-ink transition-colors duration-[var(--dur-fast)] hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Claim funds
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </article>
        </Reveal>
      </div>
    </Section>
  );
}
