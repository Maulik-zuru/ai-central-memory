"use client";

import { motion, useReducedMotion } from "motion/react";

const FADED = [
  { text: "Explain your codebase to Cursor. Again.", rotate: -4 },
  { text: "Remind ChatGPT how you like feedback.", rotate: 3 },
  { text: "Re-paste the client brief into Claude.", rotate: -2 },
];

// The inverse of the hero's notes: same physical object, drained of color and tilted like they've
// slid off a desk, each with a strike-through. Visualizes "you already said this and it vanished"
// without reusing the hero's arrangement (varies the collage rather than repeating the section shell).
export function ForgottenNotes() {
  const reduced = useReducedMotion();

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="grid gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-center md:gap-16">
        <div>
          <h2 className="font-marker text-[clamp(2.4rem,5vw,3.6rem)] leading-[0.95] text-balance">
            You already said this. Somewhere.
          </h2>
          <p className="mt-4 max-w-sm text-muted-foreground">
            Every AI tool starts you from zero. The context you built up in one conversation
            disappears the moment you open a different tab.
          </p>
        </div>

        <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-6">
          {FADED.map((note, i) => (
            <motion.div
              key={note.text}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ type: "spring", stiffness: 220, damping: 24, delay: i * 0.08 }}
              style={{ rotate: note.rotate }}
              className="relative w-full max-w-[13rem] rounded-2xl border border-border/70 bg-secondary/60 p-4 shadow-[var(--shadow-note)] sm:w-auto"
            >
              <p className="text-sm leading-snug text-muted-foreground line-through decoration-muted-foreground/50">
                {note.text}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
