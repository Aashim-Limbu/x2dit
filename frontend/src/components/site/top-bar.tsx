import Link from "next/link";
import { Wordmark } from "./brand";
import { NetworkPill } from "./network-pill";
import { WalletStatus } from "./wallet-status";

/**
 * The proscenium: wordmark left, network + dual-wallet status right.
 * App-shell chrome (flow routes); the landing uses the GlassNav pill instead —
 * both share tokens, the same logo, and the same focus/shadow treatment.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-surface/70 shadow-nav backdrop-blur-[16px]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-1.5 focus:text-sm focus:text-ink focus:outline-2 focus:outline-focus"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          aria-label="zk-houdini home"
          className="rounded-md transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Wordmark />
        </Link>

        <div className="flex items-center gap-3">
          <NetworkPill className="hidden sm:inline-flex" />
          <WalletStatus />
        </div>
      </div>
    </header>
  );
}
