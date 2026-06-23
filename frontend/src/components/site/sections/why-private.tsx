import { EyeOff, KeyRound, ShieldCheck, ArrowUpRight } from "lucide-react";
import { Section, SectionHeading } from "@/components/site/section";
import { Reveal } from "@/components/site/reveal";
import { STELLAR, stellarExpert, truncate } from "@/lib/site";

export function WhyPrivate() {
  return (
    <Section id="why-private" tone="paper" seam>
      <Reveal>
        <SectionHeading
          tone="paper"
          title="Privacy by construction"
          lead="Not a mixer you trust — math you can verify."
        />
      </Reveal>

      {/* Asymmetric, not a second 3-up icon grid: one lead pillar (Unlinkable)
          spans the row, two supporting columns sit beneath it — and the third
          claim becomes a live verifier receipt. */}
      <div className="mt-16 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
        {/* Lead pillar — Unlinkable */}
        <Reveal
          as="div"
          index={0}
          className="flex flex-col gap-5 px-1 py-8 sm:col-span-2 sm:px-8 lg:col-span-1"
        >
          <EyeOff className="size-8 text-ink" strokeWidth={1.5} aria-hidden />
          <h3 className="font-display text-2xl font-semibold tracking-[-0.02em] text-paper-ink">
            Unlinkable
          </h3>
          <p className="max-w-[42ch] text-base leading-relaxed text-paper-muted">
            A withdrawal cannot be tied to any deposit. Your anonymity set is
            every depositor who has ever used the pool — the crowd is your
            cover.
          </p>
        </Reveal>

        {/* Supporting — Non-custodial */}
        <Reveal
          as="div"
          index={1}
          className="flex flex-col gap-5 border-t border-paper-line px-1 py-8 sm:px-8 lg:border-l lg:border-t-0"
        >
          <KeyRound className="size-7 text-ink" strokeWidth={1.5} aria-hidden />
          <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-paper-ink">
            Non-custodial
          </h3>
          <p className="max-w-[38ch] text-[0.9375rem] leading-relaxed text-paper-muted">
            Your secret note is the only key. No operator, relayer, or multisig
            can move, freeze, or seize the funds once they enter the pool. The
            one thing still trusted today: a single relayer backs the bridge&rsquo;s
            solvency &mdash; a documented limitation, not part of the privacy model.
          </p>
        </Reveal>

        {/* Supporting — Verifiable on-chain, as a live receipt */}
        <Reveal
          as="div"
          index={2}
          className="flex flex-col gap-5 border-t border-paper-line px-1 py-8 sm:col-span-2 sm:px-8 lg:col-span-1 lg:border-l lg:border-t-0"
        >
          <ShieldCheck className="size-7 text-ink" strokeWidth={1.5} aria-hidden />
          <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-paper-ink">
            Verifiable on-chain
          </h3>
          <p className="max-w-[38ch] text-[0.9375rem] leading-relaxed text-paper-muted">
            A Groth16 proof is checked by the Soroban verifier contract itself.
            Nothing is taken on trust — read it yourself:
          </p>

          {/* the receipt: live verifier id → stellar.expert */}
          <a
            href={stellarExpert.contract(STELLAR.verifier)}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center justify-between gap-3 rounded-lg border border-paper-line bg-paper-2 px-3.5 py-2.5 transition-colors duration-[var(--dur-fast)] hover:border-paper-ink/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[0.7rem] font-medium text-paper-muted">
                Soroban verifier
              </span>
              <span className="font-mono text-[0.8125rem] text-paper-ink">
                {truncate(STELLAR.verifier, 8, 6)}
              </span>
            </span>
            <ArrowUpRight
              className="size-4 shrink-0 text-paper-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>
        </Reveal>
      </div>
    </Section>
  );
}
