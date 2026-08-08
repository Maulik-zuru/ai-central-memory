import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';

// US-ARC-05: async, post-sync — never blocks the import itself, same "appended step in the
// fire-and-forget chain" shape as Phase 4's categorization appended to Phase 2's embedding chain.
export const summaryService = {
  async summarize(conversationId: string): Promise<void> {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { position: 'asc' },
      select: { role: true, content: true },
    });
    if (messages.length === 0) return;

    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const summary = await getLlmProvider().summarize(transcript);
    await prisma.conversation.update({ where: { id: conversationId }, data: { summary } });
  },
};
