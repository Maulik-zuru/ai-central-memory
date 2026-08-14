import { describe, expect, it } from "vitest";
import { extractMarkerLineMemory } from "../src/lib/marker-line";

describe("extractMarkerLineMemory", () => {
  it("extracts the memory text from a reply ending in a marker line", () => {
    const reply = "Sure, here's how to set that up.\n\nto=memoryos&&memory=[Prefers Postgres over MySQL for new projects.]";
    expect(extractMarkerLineMemory(reply)).toBe("Prefers Postgres over MySQL for new projects.");
  });

  it("returns null when no marker line is present", () => {
    expect(extractMarkerLineMemory("Just a normal reply, nothing to remember here.")).toBeNull();
  });

  it("returns null for an empty marker (model skipped the note as instructed)", () => {
    expect(extractMarkerLineMemory("to=memoryos&&memory=[]")).toBeNull();
    expect(extractMarkerLineMemory("to=memoryos&&memory=[   ]")).toBeNull();
  });

  it("extracts a marker line embedded mid-reply, not only at the end", () => {
    const reply = "to=memoryos&&memory=[Uses TypeScript strict mode.] More context follows after it.";
    expect(extractMarkerLineMemory(reply)).toBe("Uses TypeScript strict mode.");
  });

  it("does not match a similarly-worded line that isn't the exact marker form", () => {
    expect(extractMarkerLineMemory("I could remember that you use to=someone&&memory=lookups, but this isn't the marker form.")).toBeNull();
  });
});
