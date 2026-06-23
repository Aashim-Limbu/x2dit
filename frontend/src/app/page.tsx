import { GlassNav } from "@/components/site/glass-nav";
import { Hero } from "@/components/site/hero";
import { StatsStrip } from "@/components/site/sections/stats-strip";
import { HowItWorks } from "@/components/site/sections/how-it-works";
import { ActsShowcase } from "@/components/site/sections/acts-showcase";
import { WhyPrivate } from "@/components/site/sections/why-private";
import { TechStrip } from "@/components/site/sections/tech-strip";
import { Faq } from "@/components/site/sections/faq";
import { ClosingCta } from "@/components/site/sections/closing-cta";
import { BigFooter } from "@/components/site/sections/big-footer";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-surface px-4 py-2 text-sm text-ink shadow-panel focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-2 focus:outline-offset-2 focus:outline-focus"
      >
        Skip to content
      </a>

      <GlassNav />

      <main id="main" className="flex-1">
        {/* Vanish → reveal narrative order */}
        <Hero />
        <StatsStrip />
        <HowItWorks />
        <ActsShowcase />
        <WhyPrivate />
        <TechStrip />
        <Faq />
        <ClosingCta />
      </main>

      <BigFooter />
    </>
  );
}
