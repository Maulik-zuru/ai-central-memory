import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { accessibleBucketIds, requireBucketMembership } from '../../shared/bucketAccess';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { tokenCount } from '../../shared/tokenizer';
import { retrievalService } from '../context/retrieval.service';
import { chatSearchService } from '../chat-history/chat-search.service';
import { fileSearchService } from '../file/file-search.service';
import { analyticsService } from '../intelligence/analytics.service';

export type AskMode = 'memories' | 'chat_history' | 'files' | 'all';
export type SourceType = 'memory' | 'message' | 'file';

const TOKEN_BUDGET = 3000;
const CANDIDATES_PER_SOURCE = 20;
// Same "closest isn't necessarily relevant" floor rag.service.ts introduced for single-file
// Q&A, applied per source here rather than inventing a cross-source relevance model
// (Phase7_Implementation_Plan.md §3: no cross-space re-ranking this phase) — tighter than
// rag.service's 0.9 because that ceiling filters candidates *within one file* (already a
// narrower, more self-similar population); Ask compares against every memory/message/chunk the
// user has, so a looser floor would let genuinely unrelated content through more often.
const RELEVANCE_DISTANCE_CEILING = 0.6;

interface MergedCandidate {
  id: string;
  content: string;
  distance: number;
  sourceType: SourceType;
  sourceId: string;
  meta: Record<string, unknown>;
}

export interface Citation {
  sourceType: SourceType;
  sourceId: string;
  snippet: string;
  meta: Record<string, unknown>;
}

async function gatherCandidates(bucketIds: string[], embedding: number[], mode: AskMode): Promise<MergedCandidate[]> {
  if (bucketIds.length === 0) return [];
  const tasks: Promise<MergedCandidate[]>[] = [];

  if (mode === 'memories' || mode === 'all') {
    tasks.push(
      retrievalService.scoreCandidates(bucketIds, embedding).then((rows) =>
        [...rows]
          .sort((a, b) => a.distance - b.distance)
          .slice(0, CANDIDATES_PER_SOURCE)
          .map((r) => ({
            id: r.id,
            content: r.content,
            distance: r.distance,
            sourceType: 'memory' as const,
            sourceId: r.id,
            meta: {},
          })),
      ),
    );
  }
  if (mode === 'chat_history' || mode === 'all') {
    tasks.push(
      chatSearchService.topCandidates(bucketIds, embedding, CANDIDATES_PER_SOURCE).then((rows) =>
        rows.map((r) => ({
          id: r.chunkId,
          content: r.content,
          distance: r.distance,
          sourceType: 'message' as const,
          sourceId: r.conversationId,
          meta: { conversationId: r.conversationId, position: r.position, title: r.title },
        })),
      ),
    );
  }
  if (mode === 'files' || mode === 'all') {
    tasks.push(
      fileSearchService.topCandidates(bucketIds, embedding, CANDIDATES_PER_SOURCE).then((rows) =>
        rows.map((r) => ({
          id: r.chunkId,
          content: r.content,
          distance: r.distance,
          sourceType: 'file' as const,
          sourceId: r.fileId,
          meta: { page: r.page, filename: r.filename },
        })),
      ),
    );
  }

  const results = await Promise.all(tasks);
  return results
    .flat()
    .filter((c) => c.distance <= RELEVANCE_DISTANCE_CEILING)
    .sort((a, b) => a.distance - b.distance);
}

function budget(candidates: MergedCandidate[]): MergedCandidate[] {
  const kept: MergedCandidate[] = [];
  let tokens = 0;
  for (const c of candidates) {
    const t = tokenCount(c.content);
    if (tokens + t > TOKEN_BUDGET) break;
    tokens += t;
    kept.push(c);
  }
  return kept;
}

async function nextPosition(conversationId: string): Promise<number> {
  const last = await prisma.askMessage.findFirst({ where: { conversationId }, orderBy: { position: 'desc' } });
  return (last?.position ?? -1) + 1;
}

export const askService = {
  async ask(
    userId: string,
    params: { conversationId?: string; question: string; mode: AskMode; bucketId?: string },
  ): Promise<{ conversationId: string; message: { id: string; content: string; citations: Citation[] } }> {
    let conversation;
    if (params.conversationId) {
      conversation = await prisma.askConversation.findUnique({ where: { id: params.conversationId } });
      if (!conversation || conversation.userId !== userId) throw AppError.notFound('Ask conversation not found');
    } else {
      if (params.bucketId) await requireBucketMembership(userId, params.bucketId, 'viewer');
      conversation = await prisma.askConversation.create({
        data: { userId, bucketId: params.bucketId ?? null, title: params.question.slice(0, 60) },
      });
    }

    const bucketIds = conversation.bucketId
      ? [(await requireBucketMembership(userId, conversation.bucketId, 'viewer')).bucketId]
      : await accessibleBucketIds(userId);

    // A follow-up folds prior turns into the prompt text rather than changing
    // answerWithContext()'s signature — it stays exactly the {question, chunks} shape Phase 6
    // introduced (Phase7_Implementation_Plan.md §5.2 step 7).
    const priorTurns = await prisma.askMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { position: 'asc' },
    });
    const historyPrefix = priorTurns
      .map((t) => `${t.role === 'user' ? 'Previous question' : 'Previous answer'}: ${t.content}`)
      .join('\n');
    const composedQuestion = historyPrefix ? `${historyPrefix}\n\nFollow-up question: ${params.question}` : params.question;

    const provider = getLlmProvider();
    const embedding = await provider.embed(params.question);
    const candidates = budget(await gatherCandidates(bucketIds, embedding, params.mode));

    const userPosition = await nextPosition(conversation.id);
    await prisma.askMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: params.question, mode: params.mode, position: userPosition },
    });

    let answer: string;
    let citations: Citation[];

    if (candidates.length === 0) {
      answer = "I don't have relevant context for that in the sources you selected.";
      citations = [];
    } else {
      const result = await provider.answerWithContext(
        composedQuestion,
        candidates.map((c) => ({ id: c.id, content: c.content })),
      );
      answer = result.answer;
      const usedSet = new Set(result.usedChunkIds);
      const cited = candidates.filter((c) => usedSet.has(c.id));
      citations = (cited.length > 0 ? cited : candidates.slice(0, 1)).map((c) => ({
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        snippet: c.content.slice(0, 300),
        meta: c.meta,
      }));
    }

    const assistantMessage = await prisma.askMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
        citations: citations as unknown as object,
        position: userPosition + 1,
      },
    });

    await prisma.askConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    analyticsService.record(userId, 'ask_query');

    return {
      conversationId: conversation.id,
      message: { id: assistantMessage.id, content: answer, citations },
    };
  },

  async listThreads(userId: string, opts: { cursor?: string; limit: number }) {
    const rows = await prisma.askConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  },

  async getThread(userId: string, id: string) {
    const conversation = await prisma.askConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { position: 'asc' } } },
    });
    if (!conversation || conversation.userId !== userId) throw AppError.notFound('Ask conversation not found');
    return conversation;
  },
};
