import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "../src/lib/types";

// The bug this whole module exists to fix: capture.service.ts's extraction loop can create more
// than one MemorySuggestion from a single turn, but the original inline poll (`.find(...)`) only
// ever picked the first one — the rest sat pending forever with no in-page nudge for them, only
// discoverable later in the dashboard. These tests pin down the fixed, extracted behavior.

const sendToBackground = vi.fn();

vi.mock("../src/lib/messages", () => ({
  sendToBackground: (...args: unknown[]) => sendToBackground(...args),
}));

function suggestion(id: string, overrides: Partial<Suggestion> = {}): Suggestion {
  return { id, type: "capture", draftContent: `draft ${id}`, status: "pending", ...overrides };
}

describe("pollForNewCaptureSuggestions", () => {
  let captureReview: typeof import("../src/lib/capture-review");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    captureReview = await import("../src/lib/capture-review");
  });

  it("returns every fresh capture suggestion found on the first successful poll, not just one", async () => {
    sendToBackground.mockResolvedValue({
      suggestions: [suggestion("a"), suggestion("b"), suggestion("c", { status: "dismissed" })],
    });

    const result = await captureReview.pollForNewCaptureSuggestions(new Set(), 1, 0);

    expect(result.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("ignores already-known ids and suggestions that aren't type 'capture'", async () => {
    sendToBackground.mockResolvedValue({
      suggestions: [suggestion("a"), suggestion("b"), suggestion("d", { type: "remove" })],
    });

    const result = await captureReview.pollForNewCaptureSuggestions(new Set(["a"]), 1, 0);

    expect(result.map((s) => s.id)).toEqual(["b"]);
  });

  it("keeps polling until something new shows up, then stops immediately instead of exhausting every attempt", async () => {
    sendToBackground.mockResolvedValueOnce({ suggestions: [] }).mockResolvedValueOnce({ suggestions: [suggestion("a")] });

    const result = await captureReview.pollForNewCaptureSuggestions(new Set(), 5, 0);

    expect(result.map((s) => s.id)).toEqual(["a"]);
    expect(sendToBackground).toHaveBeenCalledTimes(2);
  });

  it("returns an empty array once every attempt is exhausted with nothing new", async () => {
    sendToBackground.mockResolvedValue({ suggestions: [] });

    const result = await captureReview.pollForNewCaptureSuggestions(new Set(), 3, 0);

    expect(result).toEqual([]);
    expect(sendToBackground).toHaveBeenCalledTimes(3);
  });
});

describe("mergeNewSuggestions", () => {
  let captureReview: typeof import("../src/lib/capture-review");

  beforeEach(async () => {
    vi.resetModules();
    captureReview = await import("../src/lib/capture-review");
  });

  it("appends fresh suggestions after whatever is already pending", () => {
    const merged = captureReview.mergeNewSuggestions([suggestion("a")], [suggestion("b"), suggestion("c")]);
    expect(merged.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("never duplicates a suggestion already in the pending list", () => {
    const merged = captureReview.mergeNewSuggestions([suggestion("a")], [suggestion("a"), suggestion("b")]);
    expect(merged.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
