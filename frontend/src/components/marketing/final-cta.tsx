"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// Closes the page inside the same collage world it opened in, instead of dropping into a bare
// centered manifesto line: the headline sits on the canvas like a note itself, with one literal
// sticky note tilted beside it, so the last thing a visitor sees still looks handled, not templated.
export function FinalCta() {
  const reduced = useReducedMotion();

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-28 text-center sm:px-6">
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 lg:flex-row lg:justify-center">
        <h2 className="font-marker text-[clamp(2.4rem,5.5vw,4.2rem)] leading-[0.95] text-balance">
          Say it once. It remembers everywhere.
        </h2>

        <motion.div
          initial={reduced ? false : { opacity: 0, rotate: -8, scale: 0.9 }}
          whileInView={{ opacity: 1, rotate: -6, scale: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ type: "spring", stiffness: 220, damping: 20 }}
          className="hidden w-40 shrink-0 rounded-2xl border border-black/5 bg-note-pink p-3 text-left shadow-[var(--shadow-note)] lg:block"
        >
          <span className="mono-tag text-[10px] uppercase tracking-[0.08em] text-note-pink-foreground">
            Last one
          </span>
          <p className="mt-1 text-xs leading-snug text-note-pink-foreground/80">
            Promise. Now go save something.
          </p>
        </motion.div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/register">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
