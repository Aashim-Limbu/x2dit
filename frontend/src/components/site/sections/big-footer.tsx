import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Wordmark } from "@/components/site/brand";
import {
  EVM,
  STELLAR,
  REPO_URL,
  etherscan,
  stellarExpert,
  truncate,
} from "@/lib/site";

// ── GitHub inline SVG (brand icon was dropped from lucide-react v1) ──────────
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
      width="14"
      height="14"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ── Column-heading label (mono, sentence-case, faint, xs) ────────────────────
function ColLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 font-mono text-xs tracking-wide text-faint">{children}</p>
  );
}

// ── Reusable link row with optional external arrow ───────────────────────────
function FooterLink({
  href,
  external,
  mono,
  children,
}: {
  href: string;
  external?: boolean;
  mono?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "group inline-flex items-center gap-1.5 text-sm text-muted-ink transition-colors duration-150 hover:text-ink focus-visible:text-ink";
  const inner = (
    <>
      <span className={mono ? "font-mono" : undefined}>{children}</span>
      {external && (
        <ArrowUpRight className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
      )}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

// ── On-chain contract rows ────────────────────────────────────────────────────
function ContractLink({
  label,
  id,
  href,
}: {
  label: string;
  id: string;
  href: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex items-center gap-1.5 text-sm text-muted-ink transition-colors duration-150 hover:text-ink focus-visible:text-ink"
      >
        <span>{label}</span>
        <ArrowUpRight className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
      </a>
      <span className="font-mono text-[0.7rem] leading-none text-faint">
        {truncate(id, 8, 6)}
      </span>
    </div>
  );
}

// ── BigFooter ─────────────────────────────────────────────────────────────────
export function BigFooter() {
  return (
    <footer className="border-t border-hairline bg-bg-2">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">

        {/* Top grid */}
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.6fr_1fr]">

          {/* Col 1 — Brand */}
          <div className="flex flex-col gap-4">
            <Wordmark />
            <p className="max-w-[26ch] text-sm leading-relaxed text-muted-ink">
              A private bridge. Lock on Ethereum, reappear on Stellar.
            </p>
            <span className="inline-flex w-fit items-center rounded-full border border-hairline px-3 py-1 text-xs text-muted-ink">
              Testnet prototype — do not send real funds.
            </span>
          </div>

          {/* Col 2 — The bridge */}
          <div>
            <ColLabel>The bridge</ColLabel>
            {/* sentence-case mono labels, not uppercase tracked eyebrows */}
            <nav aria-label="Bridge navigation" className="flex flex-col gap-3">
              <FooterLink href="/deposit">Launch app</FooterLink>
              <FooterLink href="/withdraw">Withdraw</FooterLink>
              <FooterLink href="/#how">How it works</FooterLink>
              <FooterLink href="/#faq">FAQ</FooterLink>
            </nav>
          </div>

          {/* Col 3 — On-chain */}
          <div>
            <ColLabel>On-chain</ColLabel>
            <div className="flex flex-col gap-4">
              <ContractLink
                label="EVM Privacy pool"
                id={EVM.pool}
                href={etherscan.address(EVM.pool)}
              />
              <ContractLink
                label="Stellar Bridge pool"
                id={STELLAR.pool}
                href={stellarExpert.contract(STELLAR.pool)}
              />
              <ContractLink
                label="Groth16 verifier"
                id={STELLAR.verifier}
                href={stellarExpert.contract(STELLAR.verifier)}
              />
              <ContractLink
                label="zUSDC"
                id={STELLAR.zusdcSac}
                href={stellarExpert.contract(STELLAR.zusdcSac)}
              />
            </div>
          </div>

          {/* Col 4 — Project */}
          <div>
            <ColLabel>Project</ColLabel>
            <div className="flex flex-col gap-3">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-1.5 text-sm text-muted-ink transition-colors duration-150 hover:text-ink focus-visible:text-ink"
              >
                <GitHubIcon className="opacity-60 transition-opacity group-hover:opacity-100" />
                <span>Source</span>
                <ArrowUpRight className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
              </a>
              <p className="font-mono text-xs text-faint">
                Groth16 · BN254 · Soroban P26
              </p>
            </div>
          </div>
        </div>

        {/* Bottom bar — Source lives once (Project column); here we carry the
            honest network identity instead of repeating the link. */}
        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6">
          <p className="text-sm text-faint">A zero-knowledge vanishing act</p>
          <p className="font-mono text-[0.7rem] text-faint">
            {STELLAR.passphrase}
          </p>
        </div>
      </div>
    </footer>
  );
}
