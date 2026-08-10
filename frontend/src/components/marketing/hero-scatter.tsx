"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MemoryNote, type NoteColor } from "@/components/marketing/memory-note";

const NOTES: { text: string; tag: string; color: NoteColor; rotate: number; delay: number }[] = [
  { text: "Prefers TypeScript over JS", tag: "Preference", color: "blue", rotate: -6, delay: 0 },
  { text: "Client: Fenwick Labs, NDA scope", tag: "Context", color: "orange", rotate: 4, delay: 0.05 },
  { text: "Writes in a direct, no-fluff tone", tag: "Style", color: "green", rotate: -3, delay: 0.1 },
  { text: "Push to ChatGPT, Claude, Cursor", tag: "Reach", color: "purple", rotate: 5, delay: 0.15 },
  { text: "Deploys on Vercel, not Netlify", tag: "Preference", color: "blue", rotate: 3, delay: 0.2 },
  { text: "Sends recaps every Friday", tag: "Habit", color: "pink", rotate: -5, delay: 0.25 },
];

// The hero IS the collage: scattered sticky notes at varied rotation, no centered node-diagram,
// no symmetric grid. Each note carries a real memory and a category tag color doing the palette's
// structural work. This replaces the old hub-and-spoke SVG graphic entirely.
export function HeroScatter() {
  return (
    <section className="relative overflow-hidden px-4 pt-10 pb-20 sm:px-6 sm:pt-14 md:pt-16">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-6">
        <div className="relative z-10">
          <h1 className="font-marker text-[clamp(3.2rem,9vw,6.5rem)] leading-[0.92] text-balance">
            One memory,
            <br />
            every AI you use.
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground text-pretty">
            Stop re-explaining yourself to ChatGPT, Claude, and Cursor. Save it once. Smart Memory
            carries the right context into whichever one you open next.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </div>

        <div className="relative mx-auto grid h-[22rem] w-full max-w-md grid-cols-2 gap-4 sm:h-[26rem] md:h-[28rem]">
          <MemoryNote {...NOTES[0]} className="col-span-1 -translate-y-2 justify-self-end" />
          <MemoryNote {...NOTES[1]} className="col-span-1 translate-y-6 justify-self-start" />
          <MemoryNote {...NOTES[2]} className="col-span-2 justify-self-center" />
          <MemoryNote {...NOTES[3]} className="col-span-1 -translate-y-4 justify-self-start" />
          <MemoryNote {...NOTES[4]} className="col-span-1 translate-y-2 justify-self-end" />
          <MemoryNote {...NOTES[5]} className="col-span-2 translate-y-2 justify-self-center" />
        </div>
      </div>
    </section>
  );
}
