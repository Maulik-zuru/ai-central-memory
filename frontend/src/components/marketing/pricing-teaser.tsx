import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const INCLUDED = [
  "Unlimited memories on every plan",
  "21+ AI platform integrations included",
  "Cancel anytime, data export always available",
];

// The one card-shaped section on the page, and it earns the card: a real elevation moment for the
// pricing decision, broken out of the container's max-width like a note pinned slightly forward
// of the page, with a rotated corner tag echoing the sticky-note tag language instead of a plain
// bordered box.
export function PricingTeaser() {
  return (
    <section className="border-t border-border/70 bg-card py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative rounded-2xl border border-border bg-background p-8 shadow-[var(--shadow-raised)] md:p-12">
          <span className="mono-tag absolute -top-3 left-8 rotate-[-2deg] rounded-full bg-note-green px-3 py-1 text-[10px] uppercase tracking-[0.08em] text-note-green-foreground shadow-[var(--shadow-note)]">
            No trial clock
          </span>

          <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="font-display text-3xl tracking-tight text-balance">
                Start free. Upgrade when you outgrow it.
              </h2>
              <p className="mt-3 max-w-md text-sm text-muted-foreground">
                Core covers memories, buckets, Smart Memory, and 500 conversations of history. No
                card required. Pro adds unlimited history, the knowledge graph, and full category
                tuning.
              </p>
              <ul className="mt-6 flex flex-col gap-2.5 text-sm">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col justify-center gap-3 md:border-l md:border-border md:pl-10">
              <Button asChild size="lg">
                <Link href="/register">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">Compare Core vs. Pro</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
