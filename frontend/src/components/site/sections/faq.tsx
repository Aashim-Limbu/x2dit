import { ChevronDown } from "lucide-react";
import { Section, SectionHeading } from "@/components/site/section";
import { Reveal } from "@/components/site/reveal";
import { DENOMS, EVM, STELLAR } from "@/lib/site";

const denomLabels = DENOMS.map((d) => d.label).join(", ");

const ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is zk-houdini custodial?",
    a: "No. Your secret note is the only key to your funds. The pool contract on Ethereum Sepolia and the Soroban contracts on Stellar are immutable and permissionless — no operator holds your assets or can censor a withdrawal.",
  },
  {
    q: "What do I actually have to trust?",
    a: "Privacy and custody are trustless: your secret note is the only key, the proof is verified on-chain, and no relayer can forge it or link your withdrawal to your deposit. The one assumption that remains is solvency — a single relayer currently backs the pool. That is a documented limitation we state plainly, not part of the privacy model.",
  },
  {
    q: "Can my withdrawal be linked to my deposit?",
    a: "No — that is the whole point. A zero-knowledge proof demonstrates that you know a valid secret note committed inside the pool, without revealing which deposit is yours. Your anonymity set is every depositor who used the same fixed denomination.",
  },
  {
    q: "What is the secret note, and what if I lose it?",
    a: "The note is a random 31-byte preimage generated in your browser at deposit time and never sent to any server. It is your claim ticket: the Groth16 circuit proves you hold it without exposing it. Lose it and the funds are permanently unrecoverable — back it up off-device before confirming the deposit.",
  },
  {
    q: "Is this production-ready?",
    a: (
      <>
        No. zk-houdini is a hackathon prototype deployed on{" "}
        <span className="font-mono text-sm text-faint">{EVM.name}</span> and{" "}
        <span className="font-mono text-sm text-faint">{STELLAR.name}</span>.
        The circuits and contracts have not been audited, and the trusted setup
        has not been replaced by a multi-party ceremony. Do not send real funds.
      </>
    ),
  },
  {
    q: "Which chains and amounts are supported?",
    a: (
      <>
        Lock USDC on{" "}
        <span className="font-mono text-sm text-faint">{EVM.name}</span>, then
        claim zUSDC on{" "}
        <span className="font-mono text-sm text-faint">{STELLAR.name}</span>.
        Deposits must be one of the fixed denominations:{" "}
        <span className="font-mono text-sm text-faint">{denomLabels}</span>.
        Fixed amounts are essential for a uniform anonymity set — variable
        amounts would fingerprint deposits.
      </>
    ),
  },
  {
    q: "How is the proof verified?",
    a: (
      <>
        Your browser generates a Groth16 proof over the BN254 elliptic curve
        using snarkjs. The relayer converts it to the byte layout expected by
        Soroban and submits it to the verifier contract (
        <span className="break-all font-mono text-[0.8rem] text-faint">
          {STELLAR.verifier}
        </span>
        ). Verification runs on-chain — no relayer can forge a proof or link
        your withdrawal to your deposit.
      </>
    ),
  },
];

export function Faq() {
  return (
    <Section id="faq" tone="navy" seam>
      <Reveal>
        <SectionHeading title="Questions" tone="navy" className="mb-14" />
      </Reveal>

      <Reveal
        className="mx-auto max-w-3xl divide-y divide-hairline border-y border-hairline"
      >
        {ITEMS.map(({ q, a }) => (
          <details key={q} className="group">
            <summary
              className={[
                "flex cursor-pointer list-none items-center justify-between gap-4",
                "py-5 font-display text-[1.0625rem] font-medium text-ink",
                "select-none rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                "[&::-webkit-details-marker]:hidden",
              ].join(" ")}
            >
              <span>{q}</span>
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-faint transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
              />
            </summary>

            <div className="pb-6 pt-0">
              <p className="max-w-prose text-[0.9875rem] leading-relaxed text-muted-ink">
                {a}
              </p>
            </div>
          </details>
        ))}
      </Reveal>
    </Section>
  );
}
