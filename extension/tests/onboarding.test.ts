import { beforeEach, describe, expect, it } from "vitest";

// US-INT-01: `onboardingPending` was already written on install and nothing ever read it — these
// tests exercise the module that reads/writes it, independent of the popup UI that consumes it.

function installChromeMock() {
  const store = new Map<string, unknown>();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
      },
    },
  };
  return store;
}

describe("onboarding walkthrough state", () => {
  let onboarding: typeof import("../src/lib/onboarding");

  beforeEach(async () => {
    installChromeMock();
    onboarding = await import("../src/lib/onboarding");
  });

  it("reports not pending when nothing has been set (e.g. an existing install, never touched)", async () => {
    expect(await onboarding.getOnboardingState()).toEqual({ pending: false });
  });

  it("reports pending once set (the shape background/index.ts writes on install)", async () => {
    const store = installChromeMock();
    store.set("onboardingPending", true);
    expect(await onboarding.getOnboardingState()).toEqual({ pending: true });
  });

  it("dismissing clears the pending flag", async () => {
    await onboarding.replayOnboarding();
    expect(await onboarding.getOnboardingState()).toEqual({ pending: true });

    await onboarding.dismissOnboarding();
    expect(await onboarding.getOnboardingState()).toEqual({ pending: false });
  });

  it("replaying sets the flag again after it was previously dismissed", async () => {
    await onboarding.dismissOnboarding();
    expect(await onboarding.getOnboardingState()).toEqual({ pending: false });

    await onboarding.replayOnboarding();
    expect(await onboarding.getOnboardingState()).toEqual({ pending: true });
  });
});
