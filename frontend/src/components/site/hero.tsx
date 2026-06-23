"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { RedactedLink } from "./redacted-link";
import { FilingGrid } from "./filing-grid";
import { CtaButton } from "./cta-button";
import { useMotionReady } from "@/lib/use-anim";

/**
 * Live status as a rubber stamp — the word carries the meaning, the colour and
 * the slight rotation reinforce it. A deliberate, named brand device.
 */
function LiveStamp() {
  return (
    <span className="stamp pointer-events-auto inline-flex -rotate-1 items-center gap-2 px-3 py-1 text-[0.7rem] font-medium">
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 [animation-duration:2.6s] motion-reduce:hidden" />
        <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
      </span>
      LIVE · TESTNET · SEPOLIA&nbsp;⇄&nbsp;STELLAR
    </span>
  );
}

export function Hero() {
  const animateHeadline = useMotionReady();

  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-5 pb-24 pt-32 text-center sm:pt-36">
      {/* interactive ledger grid — hover stamps cells in faint red */}
      <FilingGrid />

      {/* pointer-events-none so the grid behind catches hover across the whole
          hero; interactive controls below re-enable it for themselves. */}
      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center pointer-events-none">
        <LiveStamp />

        {/* Literal headline — fully legible at rest; line 2 rises in when motion
            is allowed, but opacity never gates meaning. */}
        <h1 className="text-display-hero pointer-events-auto mt-8 text-balance text-ink">
          Lock on Ethereum.
          {!animateHeadline ? (
            <span className="block">Reappear on Stellar.</span>
          ) : (
            <motion.span
              className="block"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              Reappear on Stellar.
            </motion.span>
          )}
        </h1>

        <p className="pointer-events-auto mt-4 font-mono text-xs tracking-wide text-faint">
          Now you see it, now you don&rsquo;t.
        </p>

        <p className="pointer-events-auto mt-5 max-w-[56ch] text-[1.0625rem] leading-relaxed text-muted-ink text-pretty">
          Claim your USDC on the other side through a zero-knowledge proof — with{" "}
          <span className="font-medium text-ink underline decoration-primary decoration-2 underline-offset-4">
            no link
          </span>{" "}
          between the two sides.
        </p>

        {/* the signature exhibit */}
        <RedactedLink className="pointer-events-auto mt-12 max-w-xl" />

        <div className="pointer-events-auto mt-12 flex flex-wrap items-center justify-center gap-3">
          <CtaButton href="/deposit" size="lg">
            Make a private deposit
            <ArrowRight className="size-4" aria-hidden />
          </CtaButton>
          <CtaButton href="/#how" variant="glass" size="lg">
            See how it works
          </CtaButton>
        </div>
      </div>
    </section>
  );
}
