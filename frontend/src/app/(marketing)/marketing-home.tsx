import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { HeroScatter } from "@/components/marketing/hero-scatter";
import { IntegrationMarquee } from "@/components/marketing/integration-marquee";
import { ForgottenNotes } from "@/components/marketing/forgotten-notes";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { FeatureBento } from "@/components/marketing/feature-bento";
import { TrustBand } from "@/components/marketing/trust-band";
import { PricingTeaser } from "@/components/marketing/pricing-teaser";
import { FinalCta } from "@/components/marketing/final-cta";

export function MarketingHome() {
  return (
    <div className="marketing-surface flex min-h-[100dvh] flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        <HeroScatter />

        <section aria-label="Supported AI platforms" className="border-y border-border/70 bg-card py-6">
          <IntegrationMarquee />
        </section>

        <ForgottenNotes />
        <HowItWorks />
        <FeatureBento />
        <TrustBand />
        <PricingTeaser />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  );
}
