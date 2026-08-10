import { ArrowUpRight, MessageSquareText, Network, Sparkles } from "lucide-react";

// 3 items, 3 cells, asymmetric (one wide feature + two compact rows). The two compact cells lead
// with an inline icon+heading row rather than the stacked icon-over-heading-over-body shell used
// on the wide cell and everywhere else on the page, so no cell repeats the same internal template.
export function FeatureBento() {
  return (
    <section id="integrations" className="border-t border-border/70 bg-card py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="font-marker text-[clamp(2.4rem,5vw,3.6rem)] leading-[0.95] text-balance">
          More than one-click save
        </h2>
        <p className="mt-4 max-w-md text-muted-foreground">
          A full second brain, not just a clipboard. Search, synthesis, and structure across
          everything you&rsquo;ve saved.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-background p-8 md:row-span-2 md:flex md:flex-col md:justify-center">
            <Sparkles className="h-6 w-6 text-primary" strokeWidth={1.75} />
            <h3 className="mt-4 font-display text-2xl">Ask across everything you&rsquo;ve saved</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              One question, one cited answer drawn from memories, past chats, and files. Every
              claim traceable to its source, never blended without attribution.
            </p>
          </div>

          <div className="group rounded-2xl border border-border bg-note-blue/40 p-6 transition-colors hover:bg-note-blue/60">
            <div className="flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 shrink-0 text-note-blue-foreground" strokeWidth={1.75} />
              <h3 className="font-display text-lg">Chat history, actually searchable</h3>
              <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Import from ChatGPT, Claude, and Gemini. Search by meaning, not just keywords you
              happened to type.
            </p>
          </div>

          <div className="group rounded-2xl border border-border bg-note-purple/40 p-6 transition-colors hover:bg-note-purple/60">
            <div className="flex items-center gap-3">
              <Network className="h-5 w-5 shrink-0 text-note-purple-foreground" strokeWidth={1.75} />
              <h3 className="font-display text-lg">See how it all connects</h3>
              <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The knowledge graph surfaces relationships between memories and conversations
              you&rsquo;d never think to search for.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
