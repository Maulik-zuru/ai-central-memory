---
target: marketing landing page (src/app/(marketing)/marketing-home.tsx)
total_score: 30
p0_count: 1
p1_count: 1
timestamp: 2026-08-10T10-27-47Z
slug: src-app-marketing-marketing-home-tsx
---
Method: dual-agent (A: a828f7d3305145c17 · B: a4fab213c383ae059)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Hover/aria states present; no scroll-progress or async feedback needed for a static page |
| 2 | Match System / Real World | 3/4 | Copy sells a "notebook," the visual is a data-flow hub diagram — metaphor mismatch |
| 3 | User Control and Freedom | 4/4 | Clean nav, mobile menu closes on link click, no traps |
| 4 | Consistency and Standards | 4/4 | Very consistent — to a fault; this is also the slop tell |
| 5 | Error Prevention | 3/4 | No forms to protect against; "no card required" pre-empts a concern |
| 6 | Recognition Rather Than Recall | 4/4 | Nav mirrors footer, labels match anchors |
| 7 | Flexibility and Efficiency | 2/4 | No skip-link, no shortcuts, one CTA path repeated identically everywhere |
| 8 | Aesthetic and Minimalist Design | 2/4 | Minimalism without a point of view — the 3x repeated icon-grid is minimal-by-template, not minimal-with-intent |
| 9 | Error Recovery | 3/4 | N/A by default (no error states present) |
| 10 | Help and Documentation | 2/4 | No FAQ/docs/help entry point anywhere |
| **Total** | | **30/40** | **Good band, but heuristic depth masks the actual problem: distinctiveness, not usability** |

## Anti-Patterns Verdict

**Yes — immediately, unambiguously AI slop.** Both assessments agree independently.

**LLM assessment (Assessment A):** Centered 50/50 hero split, three separate icon+heading+one-line-body grids (Steps, Features, Proof Points), Lucide icons at the exact scale every LLM reaches for by default, identical section shell repeated 6+ times (`max-w-6xl` → `max-w-2xl` intro → grid), and a hero illustration that is a generic hub-and-spoke node diagram — structurally indistinguishable from stock "integrations" hero art used across hundreds of AI-wrapper SaaS sites. `font-display` is a system serif fallback stack (`ui-serif, Georgia, Cambria`), not a real chosen typeface, so the "oversized display type" the reference bar wants never actually appears.

**Deterministic scan:** `detect.mjs` returned zero findings (exit 0) on the source files. This is expected and not reassuring — the regex/static detector only catches lexical anti-patterns (gradient text, side-stripes) in source text; it cannot see rendered composition, repeated structural patterns, or font-hierarchy ratios. Assessment B's browser-evidence pass (Playwright screenshots + computed-style extraction) supplied the numbers the static scan can't: hero headline is **68px**, body text **18px** — only a **3.78×** ratio, modest by the references' "confident oversized" standard. Exactly **one accent color** (`rgb(44,75,224)` blue) is used identically across every button, bullet, and icon — safe and consistent, but doing no structural work anywhere. Only **one element on the entire page** has any rotation (a single hero "memory card" chip at ≈−5°, and it's low-contrast enough to be barely legible against its background — Assessment B flagged this as looking accidental, not intentional). Zero elements break the container edge except the marquee (intentional infinite-scroll). 3 of 8 sections (37.5%) use the icon+heading+body repeated pattern.

**Visual overlays:** Not applicable this run — no live-injection overlay was requested; both assessments used direct Playwright screenshots + computed-style inspection instead, which is why the numbers above are precise rather than qualitative.

## Overall Impression

The copy is genuinely good — specific, confident, occasionally wry ("That's a configuration, not a promise"). Everything else is generic component-library default: symmetric grids, one safe accent color, a hero graphic that's a data-flow diagram instead of anything tactile, and a "display font" that's just a serif fallback stack pretending to be a decision. The biggest opportunity: the product's own metaphor — a *notebook* that travels with you — was never translated into anything visual. The hero should look like a notebook (or an index card, a stamped card, something with physical specificity), not a network diagram.

## What's Working

1. **Copy voice.** Concrete scenarios ("Client: Fenwick Labs — NDA scope," "Writes in a direct, no-fluff tone") instead of vague benefit-speak — the strongest asset on the page, currently wasted on generic visual packaging.
2. **Accessibility groundwork is real.** `prefers-reduced-motion` overrides on every custom keyframe (not just a blanket rule), a documented WCAG-AA contrast fix on `--muted-foreground` verified against both paper and muted backgrounds, correct `aria-expanded`/`aria-label` on the mobile menu.
3. **The token system underneath is sound.** One accent, coherent shadow tokens, a restrained named palette (paper/ink/cobalt/moss/rust/amber-tape) — the raw materials for something distinctive exist; they're just not deployed distinctively yet.

## Priority Issues

**[P0] Hero is a generic node-diagram, not a tactile/physical scene.**
- Why it matters: every one of the 12 reference designs leads with something dimensional — a 3D render, an organic blob, or physical-artifact mimicry (key card, receipt, session meter). A flat hub-and-spoke SVG diagram is the single most common "AI/data platform" hero motif in the category; it's the #1 reason this reads as AI-made at first glance, and it actively contradicts the product's own "notebook" metaphor.
- Fix: Replace the diagram with a physical-artifact composition — an index-card/notebook-page stack with real tactile detail (visible fold, stitching, a stamped date, handwriting-style annotation), rendered with depth (layered z-index, drop shadow falloff, slight perspective) and scattered/overlapping placement rather than centered symmetric layout.
- Suggested command: `/impeccable shape` (recompose the hero structurally), then `/impeccable delight` for tactile motion polish.

**[P1] Six-plus sections share one identical shell; 3 of 8 use the exact icon+heading+body grid.**
- Why it matters: this is the second-biggest slop tell, and independently a cognitive-load failure — nothing teaches the eye to expect variety, so nothing stands out and the page becomes skippable. Confirmed by both assessments (A: structural monotony; B: 37.5% of sections match the pattern exactly).
- Fix: Break the grid intentionally in at least two sections — let a feature block overlap/rotate slightly, let the pricing card break its max-width, replace one icon-grid with a collaged/asymmetric composition.
- Suggested command: `/impeccable layout`, then `/impeccable bolder` on whichever section is chosen to carry the page's one "loud" moment.

**[P2] No real display typeface; headline-to-body scale ratio is modest (3.78×) against the references' "confident oversized" standard.**
- Why it matters: `--font-display` resolves to `ui-serif, Georgia, Cambria` — a fallback stack, not a chosen face. The reference bar wants oversized serif/handwritten headline type paired with tiny tracked mono metadata for contrast; this page has the mono-metadata idea (used in exactly 2 places) but not the oversized-display half, so the intended contrast never registers.
- Fix: Load a real distinctive display face (self-hosted variable font with actual personality) and push the hero headline meaningfully larger (90–120px range desktop); widen `.mono-tag` usage to more spots (timestamps, memory IDs, platform tags) so the type-contrast pairing shows up more than twice.
- Suggested command: `/impeccable typeset`.

**[P3] Color accent is decorative-safe, not structural — same job, same weight, five times.**
- Why it matters: cobalt blue is used identically as button-fill, bullet-dot, and icon-tint everywhere. The reference bar wants the accent to either carry real weight (a hero object, a background wash) or a full playful palette — always intentional, never generic "restrained SaaS default."
- Fix: Give the accent 1-2 moments of real structural weight — a colored wash behind the hero, bold accent-colored treatment on the step numerals (currently flat gray at 25% opacity), or a duotone pass on the hero illustration itself.
- Suggested command: `/impeccable colorize`.

**[P3] The one rotated element on the entire page is low-contrast enough to look like a rendering bug rather than an intentional tilt.**
- Why it matters: Assessment B measured the desktop hero's "Prefers TypeScript over JS" card at ≈−5° rotation but low contrast against its cream background — the only gesture toward the references' "scattered/tilted composition" strategy is currently so faint it may not even register as a design choice.
- Fix: Either commit harder (higher contrast, clearer card treatment, more rotation variety across all three cards) or fold this into the P0 hero rebuild.
- Suggested command: folds into `/impeccable shape` above.

## Persona Red Flags

**Jordan (first-timer):** Spends the first few seconds decoding the hero diagram's shapes instead of absorbing the value prop — for a device meant to *be* the hero, this is backwards. The repeated 3-column icon-grid means Jordan has seen this exact shape on a dozen other SaaS sites already; nothing here builds distinct brand memory.

**Riley (stress tester):** Notices the page has zero distinguishing motion/interaction beyond entrance fades and a marquee. Also clocks that the mobile hero graphic is a materially weaker experience than desktop (arrow + comma-separated platform list) rather than an adapted version of the same visual idea — "the interesting part was cut, not adapted."

**Casey (mobile, 390px):** The hero collapses to headline + subhead + buttons + plain stacked text chips + an arrow + a comma-list of names — there is no illustration left, only a degraded text list standing in for what was a diagram on desktop. Given mobile is likely the majority of first-touch traffic for a prosumer tool discovered via social/search, this is a real loss of the one moment the desktop page had to make a visual impression.

## Minor Observations

- Same dot token (`h-1.5 w-1.5 rounded-full bg-primary`) reused in the header badge, hero graphic nodes, and pricing checkmarks — repeated so often it stops registering as an accent.
- H3 sizing is inconsistent across sections (20px steps section vs 18px one-click-save vs 14px trust row) for elements at the same semantic level.
- `.mono-tag` is a good, well-reasoned idea per its own CSS comment but used in exactly 2 places on the whole page — under-deployed relative to its stated ambition.
- Marquee is plain-text platform names with no logos/wordmarks — a missed low-effort opportunity for visual interest.
- Logo mark is a plain rounded-square "M" — functionally fine, zero personality, unlike every reference's distinctive mark treatment.

## Questions to Consider

- If the copy is this specific and confident, why is the visual system this generic — was it ever actually art-directed, or did it inherit whatever the component scaffold produces by default?
- The product's core metaphor is a notebook that travels with you. If the redesign started from "what does a notebook look like physically" instead of "what does data-flow look like," would the entire visual identity change, not just the hero?
- Every section is restrained to the same visual volume. If exactly one section had to be loud, which one earns it — hero, pricing, or final CTA? Right now the answer is "none of them," and that absence is arguably worse than picking wrong.
