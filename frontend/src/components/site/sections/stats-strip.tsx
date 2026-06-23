import { Section } from "@/components/site/section";
import { DENOMS } from "@/lib/site";

// Four structural facts from site.ts — no fabricated numbers. All four are
// clean tnum numerals; the proof cell stays plain-language (the curve/lib
// details live in the FAQ + footer). The accent cell is honesty-corrected
// (see footnote).
const stats = [
  {
    figure: "2",
    label: "Chains bridged",
    sub: "Ethereum ⇄ Stellar",
    accent: false,
  },
  {
    figure: `${DENOMS.length}`,
    label: "Fixed denominations",
    sub: DENOMS.map((d) => d.value).join(" · ") + " USDC",
    accent: false,
  },
  {
    figure: "1",
    label: "Zero-knowledge proof, on-chain verified",
    sub: "proven in your browser",
    accent: false,
  },
  {
    figure: "0",
    label: "Trusted custodians",
    sub: "no party can move your funds",
    accent: true,
  },
] as const;

export function StatsStrip() {
  return (
    <Section tone="navy" reveal innerClassName="py-12 sm:py-14">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-hairline md:grid-cols-4">
        {stats.map(({ figure, label, sub, accent }) => (
          <div
            key={label}
            className="flex flex-col gap-2 bg-bg-2 px-6 py-8 sm:px-8"
          >
            <dt
              className={[
                "font-display text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[3rem]",
                accent ? "text-primary" : "text-ink",
              ].join(" ")}
            >
              {figure}
            </dt>
            <dd className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug text-muted-ink">
                {label}
              </span>
              <span className="font-mono text-xs leading-snug text-faint">
                {sub}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {/* Honesty footnote — keeps the accent cell literally true: the relayer
          serves Merkle paths and relays withdrawals, but never custodies. */}
      <p className="mt-4 max-w-prose text-xs leading-relaxed text-faint">
        The relayer serves Merkle paths and relays withdrawals — it never
        custodies funds and cannot forge a proof. Withdrawals require your note.
      </p>
    </Section>
  );
}
