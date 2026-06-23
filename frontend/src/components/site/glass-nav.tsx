"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Wordmark } from "./brand";
import { CtaButton } from "./cta-button";
import { REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "How it works", href: "/#how", id: "how" },
  { label: "The acts", href: "/#acts", id: "acts" },
  { label: "FAQ", href: "/#faq", id: "faq" },
  { label: "GitHub", href: REPO_URL, id: null, external: true },
] as const;

/**
 * Letterhead bar — a full-width document header pinned to the top. Scroll-aware:
 * tightens and raises a hairline shadow after 24px. Tracks the in-view section
 * for aria-current via IntersectionObserver. Collapses to a hamburger sheet on
 * small screens. Fully legible / operable with no JS (links render server-side).
 */
export function GlassNav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // condense after 24px
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // track the in-view section
  useEffect(() => {
    const ids = LINKS.map((l) => l.id).filter(Boolean) as string[];
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const linkClass =
    "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm text-muted-ink transition-colors duration-[var(--dur-fast)] hover:bg-[var(--hover-tint)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:text-ink aria-[current=page]:font-medium";

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b bg-[color-mix(in_oklch,var(--bg)_88%,transparent)] backdrop-blur-md transition-all duration-[var(--dur-ui)] ease-[var(--ease-out-expo)]",
        scrolled ? "border-hairline shadow-nav" : "border-transparent",
      )}
    >
      <nav
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 transition-all duration-[var(--dur-ui)] ease-[var(--ease-out-expo)] sm:px-6",
          scrolled ? "py-2.5" : "py-3.5",
        )}
      >
        <Link
          href="/"
          aria-label="zk-houdini home"
          className="shrink-0 rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) =>
            "external" in l && l.external ? (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.label}
                href={l.href}
                aria-current={active && l.id === active ? "page" : undefined}
                className={linkClass}
              >
                {l.label}
              </Link>
            ),
          )}
        </div>

        <div className="flex items-center gap-2">
          <CtaButton href="/deposit" size="sm" className="hidden shrink-0 sm:inline-flex">
            Launch app
          </CtaButton>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="nav-sheet"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-ink transition-colors hover:bg-[var(--hover-tint)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {/* mobile disclosure sheet */}
      {open && (
        <div
          id="nav-sheet"
          className="flex flex-col gap-1 border-b border-hairline bg-surface px-4 py-3 shadow-nav md:hidden"
        >
          {LINKS.map((l) =>
            "external" in l && l.external ? (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm text-muted-ink hover:bg-[var(--hover-tint)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={active && l.id === active ? "page" : undefined}
                className="rounded-xl px-3 py-2.5 text-sm text-muted-ink hover:bg-[var(--hover-tint)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:text-ink"
              >
                {l.label}
              </Link>
            ),
          )}
          <CtaButton
            href="/deposit"
            size="sm"
            className="mt-1 w-full"
          >
            Launch app
          </CtaButton>
        </div>
      )}
    </header>
  );
}
