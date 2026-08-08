import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { requireBucketMembership } from '../../shared/bucketAccess';
import { getJobRunner } from '../../shared/providers/job-runner.provider';

const GRAPH_BATCH_LIMIT = 50;
const GRAPH_EXTRACTION_INTERVAL_MS = 60 * 60 * 1000; // hourly — compute-heavy, Pro-only, no need to be more eager than that

export interface GraphNode {
  id: string;
  name: string;
  type: string;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
  sourceMemoryId: string | null;
  sourceMessageId: string | null;
}

function normalize(name: string): string {
  return name.toLowerCase().trim();
}

// Same P2002-retry-on-race pattern categorization.service.ts established for concurrent creates
// under a unique constraint — the batch job processes many rows and two entities that resolve to
// the same node can race to create it first (docs/Phase9_Implementation_Plan.md §4).
async function findOrCreateNode(userId: string, name: string, type: string): Promise<{ id: string }> {
  const normalizedName = normalize(name);
  const existing = await prisma.knowledgeGraphNode.findUnique({
    where: { userId_normalizedName_type: { userId, normalizedName, type } },
  });
  if (existing) return existing;

  try {
    return await prisma.knowledgeGraphNode.create({ data: { userId, name, normalizedName, type } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.knowledgeGraphNode.findUnique({
        where: { userId_normalizedName_type: { userId, normalizedName, type } },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

async function extractAndLink(
  userId: string,
  content: string,
  attribution: { sourceMemoryId: string } | { sourceMessageId: string },
): Promise<void> {
  const { entities, relations } = await getLlmProvider().extractEntities(content);
  if (entities.length === 0) return;

  const nodesByName = new Map<string, { id: string }>();
  for (const entity of entities) {
    nodesByName.set(normalize(entity.name), await findOrCreateNode(userId, entity.name, entity.type));
  }

  for (const relation of relations) {
    const fromNode = nodesByName.get(normalize(relation.from));
    const toNode = nodesByName.get(normalize(relation.to));
    if (!fromNode || !toNode || fromNode.id === toNode.id) continue;

    await prisma.knowledgeGraphEdge.create({
      data: {
        userId,
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        label: relation.label,
        ...attribution,
      },
    });
  }
}

export const graphService = {
  async extractForMemory(memoryId: string): Promise<void> {
    const memory = await prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, userId: true, content: true, graphProcessedAt: true },
    });
    if (!memory || memory.graphProcessedAt) return;

    await extractAndLink(memory.userId, memory.content, { sourceMemoryId: memory.id });
    await prisma.memory.update({ where: { id: memory.id }, data: { graphProcessedAt: new Date() } });
  },

  async extractForMessage(messageId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, content: true, graphProcessedAt: true, conversation: { select: { userId: true } } },
    });
    if (!message || message.graphProcessedAt) return;

    await extractAndLink(message.conversation.userId, message.content, { sourceMessageId: message.id });
    await prisma.message.update({ where: { id: message.id }, data: { graphProcessedAt: new Date() } });
  },

  /** The JobRunner-scheduled entry point — Pro-plan users only (Phase 9's own stopgap inline
   * check; Phase 10's requirePlan() replaces this once it exists — see Phase9_Implementation_Plan.md §9). */
  async runBatch(limit: number = GRAPH_BATCH_LIMIT): Promise<void> {
    const proUserIds = (
      await prisma.subscription.findMany({ where: { plan: 'pro' }, select: { userId: true } })
    ).map((s) => s.userId);
    if (proUserIds.length === 0) return;

    const memories = await prisma.memory.findMany({
      where: { userId: { in: proUserIds }, graphProcessedAt: null },
      select: { id: true },
      take: limit,
    });
    for (const memory of memories) {
      await graphService.extractForMemory(memory.id).catch((err) => {
        logger.error({ err, memoryId: memory.id }, 'Knowledge graph extraction failed for memory');
      });
    }

    const messages = await prisma.message.findMany({
      where: { conversation: { userId: { in: proUserIds } }, graphProcessedAt: null },
      select: { id: true },
      take: limit,
    });
    for (const message of messages) {
      await graphService.extractForMessage(message.id).catch((err) => {
        logger.error({ err, messageId: message.id }, 'Knowledge graph extraction failed for message');
      });
    }
  },

  async getGraph(userId: string, opts: { bucketId?: string } = {}): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    if (opts.bucketId) await requireBucketMembership(userId, opts.bucketId, 'viewer');

    const edges = await prisma.knowledgeGraphEdge.findMany({
      where: {
        userId,
        ...(opts.bucketId
          ? {
              OR: [
                { sourceMemory: { bucketId: opts.bucketId } },
                { sourceMessage: { conversation: { bucketId: opts.bucketId } } },
              ],
            }
          : {}),
      },
      include: { fromNode: true, toNode: true },
    });

    const nodeMap = new Map<string, GraphNode>();
    for (const edge of edges) {
      nodeMap.set(edge.fromNode.id, { id: edge.fromNode.id, name: edge.fromNode.name, type: edge.fromNode.type });
      nodeMap.set(edge.toNode.id, { id: edge.toNode.id, name: edge.toNode.name, type: edge.toNode.type });
    }

    return {
      nodes: [...nodeMap.values()],
      edges: edges.map((e) => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        label: e.label,
        sourceMemoryId: e.sourceMemoryId,
        sourceMessageId: e.sourceMessageId,
      })),
    };
  },

  /** Registers the extraction batch job with JobRunner — called once at process startup. */
  registerScheduledJob(): void {
    getJobRunner().schedule('knowledge-graph-extraction', GRAPH_EXTRACTION_INTERVAL_MS, () => graphService.runBatch());
  },
};
