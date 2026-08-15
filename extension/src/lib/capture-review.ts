import { sendToBackground } from "./messages";
import type { Suggestion } from "./types";

/**
 * Watches for capture suggestions that appeared since `knownIds` was captured, so the in-page
 * nudge can show them once extraction (fire-and-forget server-side, Phase 18 §7.4) finishes.
 *
 * A single turn's extraction can surface more than one candidate at once
 * (capture.service.ts's `processCapture` loop creates one MemorySuggestion per candidate), so this
 * returns every fresh one found on the attempt that first turns up something — not just the first
 * match — rather than silently stranding the rest the way picking a single suggestion would.
 * Still stops as soon as something shows up, matching the original single-suggestion poll's
 * responsiveness for the common one-candidate case.
 */
export async function pollForNewCaptureSuggestions(
  knownIds: Set<string>,
  attempts = 8,
  intervalMs = 700,
): Promise<Suggestion[]> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const { suggestions } = await sendToBackground<{ suggestions: Suggestion[] }>({ type: "GET_PENDING_SUGGESTIONS" });
    const fresh = suggestions.filter((s) => s.type === "capture" && s.status === "pending" && !knownIds.has(s.id));
    if (fresh.length > 0) return fresh;
  }
  return [];
}

/** Merges newly-polled suggestions into an existing pending list without duplicating one already shown. */
export function mergeNewSuggestions(existing: Suggestion[], fresh: Suggestion[]): Suggestion[] {
  const seen = new Set(existing.map((s) => s.id));
  return [...existing, ...fresh.filter((s) => !seen.has(s.id))];
}
