import { Section } from "@/components/site/section";

// Grouped by chain side, mirroring the bridge story.
const ETHEREUM = ["circom 2.2", "Groth16", "BN254", "Poseidon2"] as const;
const STELLAR_SIDE = ["Soroban (Protocol 26)", "Stellar SEP-41"] as const;

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <li className="select-none rounded-full border border-hairline bg-surface/40 px-3 py-1 font-mono text-xs text-muted-ink">
      {children}
    </li>
  );
}

export function TechStrip() {
  return (
    <Section tone="navy-2" reveal innerClassName="py-12 sm:py-16">
      <p className="mb-7 text-center text-sm tracking-wide text-faint">
        Open, battle-tested cryptography
      </p>

      <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-5">
        <ul
          className="flex flex-wrap justify-center gap-2"
          aria-label="Ethereum-side stack"
        >
          {ETHEREUM.map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </ul>

        <span
          aria-hidden
          className="font-mono text-base text-faint sm:px-1"
        >
          ⇄
        </span>

        <ul
          className="flex flex-wrap justify-center gap-2"
          aria-label="Stellar-side stack"
        >
          {STELLAR_SIDE.map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </ul>
      </div>
    </Section>
  );
}
