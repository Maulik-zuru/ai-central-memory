import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getLlmProvider } from '../../shared/providers/llm.provider';

// Phase 11 (US-ACC-07): the toggle has been stored on User.autoCapture since Phase 1 but nothing
// read it — this is the enforcement point. An unset platform defaults to enabled, preserving the
// pre-Phase-11 behaviour for any account that never touched the setting, and an omitted platform
// (a direct API integration rather than one of the extension's site adapters) has no toggle to
// check against. Disabling only stops *new* suggestions; existing ones are untouched, which is
// exactly what US-ACC-07's AC requires.
async function autoCaptureAllowed(userId: string, platform: string | undefined): Promise<boolean> {
  if (!platform) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { autoCapture: true } });
  const toggles = (user?.autoCapture ?? {}) as Record<string, boolean>;
  return toggles[platform] !== false;
}

// Phase 18 (§7.4 "write path must never block the response path"): the extraction LLM call used
// to sit inline in `submit()`, so the capture endpoint's response time included however long the
// provider took to reply. This runs fire-and-forget instead, matching the established pattern in
// embedding.service.ts — the caller gets an immediate ack and the suggestion (if any) appears once
// this resolves, surfaced by a later `GET /api/suggestions` poll rather than the original response.
async function processCapture(userId: string, snippet: string, platform: string | undefined): Promise<void> {
  try {
    if (!(await autoCaptureAllowed(userId, platform))) return;

    const provider = getLlmProvider();
    const candidates = await provider.extractMemoryCandidates(snippet);

    for (const candidate of candidates) {
      // Dismissing a suggestion must not re-ask for the identical snippet in the same session
      // (US-MEM-03 AC) — a prior suggestion for this exact draft, in any status, blocks a repeat.
      const existing = await prisma.memorySuggestion.findFirst({
        where: { userId, type: 'capture', draftContent: candidate.content },
      });
      if (existing) continue;

      await prisma.memorySuggestion.create({
        data: { userId, type: 'capture', draftContent: candidate.content },
      });
    }
  } catch (err) {
    logger.error({ err, userId }, 'Capture extraction pipeline failed');
  }
}

// US-MEM-03: automatic capture never writes a real Memory — only a pending "capture"
// MemorySuggestion with draftContent, surfaced for the user to approve or dismiss.
export const captureService = {
  async submit(userId: string, snippet: string, platform?: string): Promise<void> {
    void processCapture(userId, snippet, platform);
  },
};
