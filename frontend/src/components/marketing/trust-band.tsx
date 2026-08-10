const PROOF_POINTS = [
  {
    title: "Encrypted in transit and at rest",
    body: "TLS on every call, encryption at the infrastructure level, not just a line in a privacy page.",
  },
  {
    title: "Never used to train a model",
    body: "Your content doesn't train anyone's model and isn't sold. That's a configuration, not a promise.",
  },
  {
    title: "Duplicate and stale detection",
    body: "New information that contradicts an old memory gets flagged for review. It never silently overwrites.",
  },
];

// A single full-width band with a divided list, not the icon+heading+body grid used for features
// above. Varies density (tighter, text-led) and structure (rows, not cells) from FeatureBento.
export function TrustBand() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
        <h2 className="font-marker text-[clamp(2.4rem,5vw,3.6rem)] leading-[0.95] text-balance">
          Your memory.
          <br />
          Not training data.
        </h2>

        <div className="divide-y divide-border border-t border-border">
          {PROOF_POINTS.map((p) => (
            <div key={p.title} className="grid gap-1 py-5 sm:grid-cols-[1fr_1.5fr] sm:gap-8">
              <p className="text-sm font-medium">{p.title}</p>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
