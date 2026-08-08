import { prisma } from '../../shared/prisma';
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

// US-MEM-03: automatic capture never writes a real Memory — only a pending "capture"
// MemorySuggestion with draftContent, surfaced for the user to approve or dismiss.
export const captureService = {
  async submit(userId: string, snippet: string, platform?: string) {
    if (!(await autoCaptureAllowed(userId, platform))) return [];

    const provider = getLlmProvider();
    const candidates = await provider.extractMemoryCandidates(snippet);

    const created = [];
    for (const candidate of candidates) {
      // Dismissing a suggestion must not re-ask for the identical snippet in the same session
      // (US-MEM-03 AC) — a prior suggestion for this exact draft, in any status, blocks a repeat.
      const existing = await prisma.memorySuggestion.findFirst({
        where: { userId, type: 'capture', draftContent: candidate.content },
      });
      if (existing) continue;

      const suggestion = await prisma.memorySuggestion.create({
        data: { userId, type: 'capture', draftContent: candidate.content },
      });
      created.push(suggestion);
    }
    return created;
  },
};
