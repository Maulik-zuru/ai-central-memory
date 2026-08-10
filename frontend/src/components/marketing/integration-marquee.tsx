const PLATFORMS = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "Cursor",
  "Claude Code",
  "GitHub Copilot",
  "Grok",
  "DeepSeek",
  "TypingMind",
  "Perplexity",
];

// Doubled list + CSS-only translate loop: no JS animation library needed for a simple marquee,
// and it keeps running (paused visually, not literally) under prefers-reduced-motion via the
// global rule that zeroes animation-duration.
export function IntegrationMarquee() {
  return (
    <div className="relative overflow-hidden py-1 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee flex w-max items-center gap-10">
        {[...PLATFORMS, ...PLATFORMS].map((name, i) => (
          <span
            key={`${name}-${i}`}
            className="font-display text-xl text-muted-foreground/70 whitespace-nowrap"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
