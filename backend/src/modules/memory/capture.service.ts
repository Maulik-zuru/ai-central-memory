import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';

// US-MEM-03: automatic capture never writes a real Memory — only a pending "capture"
// MemorySuggestion with draftContent, surfaced for the user to approve or dismiss.
export const captureService = {
  async submit(userId: string, snippet: string) {
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
