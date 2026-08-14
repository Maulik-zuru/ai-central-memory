// US-INT-01: a short walkthrough after install, replayable later from settings. `onboardingPending`
// was already written on install (background/index.ts) — this module is the missing other half:
// something that actually reads it, and a way to set it again for a replay.
const ONBOARDING_PENDING_KEY = "onboardingPending";

export async function getOnboardingState(): Promise<{ pending: boolean }> {
  const result = await chrome.storage.local.get(ONBOARDING_PENDING_KEY);
  return { pending: Boolean(result[ONBOARDING_PENDING_KEY]) };
}

export async function dismissOnboarding(): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_PENDING_KEY]: false });
}

/** Settings → "Replay walkthrough" calls this, then the popup shows the walkthrough immediately
 * rather than waiting for the next open to re-check storage. */
export async function replayOnboarding(): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_PENDING_KEY]: true });
}
