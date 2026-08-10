"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { NoteColor } from "@/components/marketing/memory-note";

const STEPS: { title: string; body: string; color: NoteColor; rotate: number }[] = [
  {
    title: "Save it once",
    body: "Highlight anything in ChatGPT, Claude, or Cursor and save it with one click, or let auto-capture notice it and ask first.",
    color: "blue",
    rotate: -2,
  },
  {
    title: "Smart Memory selects what matters",
    body: "Not a dump of every memory into every prompt. A relevant handful, chosen per question, so you're not burning context on noise.",
    color: "green",
    rotate: 1.5,
  },
  {
    title: "It shows up everywhere you work",
    body: "Extension, MCP, API, Custom GPT. The same notebook, injected into whichever tool you're actually in.",
    color: "purple",
    rotate: -1,
  },
];

const TAG_BG: Record<NoteColor, string> = {
  blue: "bg-note-blue",
  orange: "bg-note-orange",
  green: "bg-note-green",
  purple: "bg-note-purple",
  pink: "bg-note-pink",
};

// A real ordered flow earns its numbering, but instead of a generic 01/02/03 baseline strip, this
// renders as three sticky notes handed off left to right, connected by a drawn arrow between each,
// so the "process" section stays inside the collage world instead of reverting to a SaaS component.
export function HowItWorks() {
  const reduced = useReducedMotion();

  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <h2 className="font-marker text-[clamp(2.4rem,5vw,3.6rem)] leading-[0.95] text-balance">
        How your notebook travels with you
      </h2>
      <p className="mt-4 max-w-md text-muted-foreground">
        Three steps, not a new workflow. It runs quietly underneath the tools you already use.
      </p>

      <div className="mt-14 flex flex-col items-stretch gap-6 md:flex-row md:items-center md:gap-4">
        {STEPS.map((step, i) => (
          <div key={step.title} className="flex flex-1 items-center gap-4 md:gap-3">
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0, rotate: step.rotate }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ type: "spring", stiffness: 240, damping: 24, delay: i * 0.1 }}
              className="relative flex-1 rounded-2xl border border-black/5 bg-card p-6 shadow-[var(--shadow-note)]"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${TAG_BG[step.color]}`} />
              <h3 className="mt-3 font-display text-lg">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
            </motion.div>
            {i < STEPS.length - 1 && (
              <ArrowRight
                aria-hidden="true"
                className="hidden h-5 w-5 shrink-0 text-muted-foreground/50 md:block"
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
