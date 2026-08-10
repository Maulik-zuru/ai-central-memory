"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const TAG_STYLES = {
  blue: "bg-note-blue text-note-blue-foreground",
  orange: "bg-note-orange text-note-orange-foreground",
  green: "bg-note-green text-note-green-foreground",
  purple: "bg-note-purple text-note-purple-foreground",
  pink: "bg-note-pink text-note-pink-foreground",
} as const;

export type NoteColor = keyof typeof TAG_STYLES;

export interface MemoryNoteProps {
  text: string;
  tag: string;
  color: NoteColor;
  rotate?: number;
  className?: string;
  delay?: number;
}

// The hero's core unit: a physical sticky-note standing in for one saved memory. Tag color
// carries category meaning (see TAG_STYLES) instead of the page's one cobalt accent doing every
// job — this is the palette's real structural work, per the collage direction.
export function MemoryNote({ text, tag, color, rotate = 0, className, delay = 0 }: MemoryNoteProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 16, rotate: rotate * 2 }}
      whileInView={{ opacity: 1, y: 0, rotate }}
      viewport={{ once: true, amount: 0.4 }}
      whileHover={reduced ? undefined : { rotate: 0, scale: 1.04, zIndex: 20 }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay }}
      className={cn(
        "relative w-full max-w-[15rem] cursor-default rounded-2xl border border-black/5 bg-card p-4 shadow-[var(--shadow-note)]",
        className,
      )}
    >
      <span
        className={cn(
          "mono-tag inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]",
          TAG_STYLES[color],
        )}
      >
        {tag}
      </span>
      <p className="mt-2.5 text-sm leading-snug text-foreground/85">{text}</p>
    </motion.div>
  );
}
