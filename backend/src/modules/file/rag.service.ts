import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { requireBucketMembership } from '../../shared/bucketAccess';
import { getLlmProvider, callProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';
import { tokenCount } from '../../shared/tokenizer';

const TOP_K = 8;
const TOKEN_BUDGET = 2000;
// A first calibrated guess, same status as Phase 2/4's thresholds: above this cosine distance,
// "closest chunk" doesn't mean "actually relevant" — the honest answer is "nothing here answers
// that" (US-FIL-03's third Given/When/Then), not a low-confidence guess forced through the LLM.
const RELEVANCE_DISTANCE_CEILING = 0.9;

interface ChunkRow {
  id: string;
  page: number;
  content: string;
  distance: number;
}

export interface Citation {
  page: number;
  excerpt: string;
}

export const ragService = {
  async answer(userId: string, fileId: string, question: string): Promise<{ answer: string; citations: Citation[] }> {
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw AppError.notFound('File not found');
    await requireBucketMembership(userId, file.bucketId, 'viewer');

    if (file.status !== 'ready') {
      throw AppError.badRequest('This file is still processing — try again shortly.', 'FILE_NOT_READY');
    }

    const provider = getLlmProvider();
    const questionEmbedding = await callProvider(
      () => provider.embed(question),
      'Could not search this file right now — the AI provider is temporarily unavailable.',
    );
    const vectorLiteral = toVectorLiteral(questionEmbedding);

    const candidates = await prisma.$queryRaw<ChunkRow[]>`
      SELECT id, page, content, (embedding <=> ${vectorLiteral}::vector) AS distance
      FROM "FileChunk"
      WHERE "fileId" = ${fileId} AND embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${TOP_K}
    `;

    const relevant = candidates.filter((c) => c.distance <= RELEVANCE_DISTANCE_CEILING);
    if (relevant.length === 0) {
      return { answer: "This file doesn't seem to have anything that answers that.", citations: [] };
    }

    const withinBudget: ChunkRow[] = [];
    let tokens = 0;
    for (const chunk of relevant) {
      const t = tokenCount(chunk.content);
      if (tokens + t > TOKEN_BUDGET) break;
      tokens += t;
      withinBudget.push(chunk);
    }

    const { answer, usedChunkIds } = await callProvider(
      () =>
        provider.answerWithContext(
          question,
          withinBudget.map((c) => ({ id: c.id, content: c.content })),
        ),
      'Could not generate an answer right now — the AI provider is temporarily unavailable.',
    );

    const usedSet = new Set(usedChunkIds);
    const citedChunks = withinBudget.filter((c) => usedSet.has(c.id));
    const citations: Citation[] = (citedChunks.length > 0 ? citedChunks : [withinBudget[0]]).map((c) => ({
      page: c.page,
      excerpt: c.content.slice(0, 300),
    }));

    return { answer, citations };
  },
};
