"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { truncate } from "@/lib/site";
import { connectWallet } from "@/lib/evm/client";
import { connectFreighter } from "@/lib/stellar/wallet";

function EthGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5", className)}>
      <path d="M12 2 6 12l6 3.5L18 12 12 2Z" fill="currentColor" opacity="0.85" />
      <path d="M6 13.3 12 22l6-8.7-6 3.5-6-3.5Z" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function StellarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5", className)}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="12" cy="4" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** EVM chip: real injected-wallet connect via connectWallet(). No programmatic disconnect. */
function EvmChip({ glyph }: { glyph: React.ReactNode }) {
  const [evmAddress, setEvmAddress] = useState<`0x${string}` | null>(null);
  const [evmConnecting, setEvmConnecting] = useState(false);

  async function toggleEvm() {
    if (evmAddress) return; // already connected; injected wallets have no programmatic disconnect
    if (evmConnecting) return;
    setEvmConnecting(true);
    try {
      const { address } = await connectWallet();
      setEvmAddress(address);
    } catch {
      /* user rejected / no wallet installed — leave disconnected, no crash */
    } finally {
      setEvmConnecting(false);
    }
  }

  const connected = evmAddress !== null;
  const label = "Sepolia";

  return (
    <button
      type="button"
      onClick={toggleEvm}
      aria-label={
        connected
          ? `${label} connected: ${evmAddress}. Click to disconnect.`
          : `Connect ${label} wallet`
      }
      title={connected ? evmAddress : `Connect ${label}`}
      className="group/chip flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      <span
        className={cn(
          "transition-colors",
          connected ? "text-success" : "text-faint group-hover/chip:text-muted-ink",
        )}
      >
        {glyph}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[0.625rem] tracking-[0.02em] text-faint">{label}</span>
        {evmConnecting ? (
          // skeleton, not a spinner (DESIGN.md). Carries no meaning by color alone.
          <span className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-muted-ink">
            <span
              className="h-3 w-16 animate-pulse rounded bg-surface-2 motion-reduce:animate-none"
              aria-hidden
            />
            <span className="sr-only">Summoning…</span>
          </span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-ink">
            <Check className="size-3 text-success" aria-hidden />
            {truncate(evmAddress)}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-ink group-hover/chip:text-ink">
            Connect
          </span>
        )}
      </span>
    </button>
  );
}

/** Stellar chip: real Freighter connect (wired in Task 17). No programmatic disconnect. */
function WalletChip({
  label,
  glyph,
}: {
  label: string;
  glyph: React.ReactNode;
}) {
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);
  const [stellarConnecting, setStellarConnecting] = useState(false);

  async function toggleStellar() {
    if (stellarAddress) return; // already connected; Freighter has no programmatic disconnect
    if (stellarConnecting) return;
    setStellarConnecting(true);
    try {
      setStellarAddress(await connectFreighter());
    } catch {
      /* user cancelled or Freighter not installed — leave disconnected, no crash */
    } finally {
      setStellarConnecting(false);
    }
  }

  const connected = stellarAddress !== null;

  return (
    <button
      type="button"
      onClick={toggleStellar}
      aria-label={
        connected
          ? `${label} connected: ${stellarAddress}. Click to disconnect.`
          : `Connect ${label} wallet`
      }
      title={connected ? stellarAddress : `Connect ${label}`}
      className="group/chip flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      <span
        className={cn(
          "transition-colors",
          connected ? "text-success" : "text-faint group-hover/chip:text-muted-ink",
        )}
      >
        {glyph}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[0.625rem] tracking-[0.02em] text-faint">{label}</span>
        {stellarConnecting ? (
          // skeleton, not a spinner (DESIGN.md). Carries no meaning by color alone.
          <span className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-muted-ink">
            <span
              className="h-3 w-16 animate-pulse rounded bg-surface-2 motion-reduce:animate-none"
              aria-hidden
            />
            <span className="sr-only">Summoning…</span>
          </span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-ink">
            <Check className="size-3 text-success" aria-hidden />
            {truncate(stellarAddress)}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-ink group-hover/chip:text-ink">
            Connect
          </span>
        )}
      </span>
    </button>
  );
}

/** Dual-wallet status bar. Both chips wired to real wallet connect; no programmatic disconnect. */
export function WalletStatus({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-stretch divide-x divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface",
        className,
      )}
    >
      <EvmChip glyph={<EthGlyph />} />
      <WalletChip label="Stellar" glyph={<StellarGlyph />} />
    </div>
  );
}
