import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { importService } from './import.service';
import { conversationService } from './conversation.service';
import { chatSearchService } from './chat-search.service';
import { historyLimitService } from './history-limit.service';
import { insightService } from './insight.service';
import { prisma } from '../../shared/prisma';
import {
  deleteConversationsSchema,
  importSchema,
  ingestCustomOnlineSchema,
  listConversationsSchema,
  searchSchema,
} from './chat-history.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

export const chatHistoryController = {
  async import_(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const file = req.file;
    if (!file) throw AppError.badRequest('An export file is required', 'MISSING_FILE');
    const { bucketId, platform } = importSchema.parse(req.body);
    const result = await importService.importFile(userId, bucketId, platform, file.buffer);
    res.status(202).json(result);
  },

  async list(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId, cursor, limit } = listConversationsSchema.parse(req.query);
    const page = await conversationService.list(userId, { bucketId, cursor, limit: limit ?? 20 });
    res.status(200).json(page);
  },

  async transcript(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const result = await conversationService.getTranscript(userId, req.params.id, { cursor, limit });
    res.status(200).json(result);
  },

  async search(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { query, bucketId, mode } = searchSchema.parse(req.body);
    const results = await chatSearchService.search(userId, { query, bucketId, mode });
    res.status(200).json({ results });
  },

  async usage(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const usage = await historyLimitService.usage(userId);
    res.status(200).json(usage);
  },

  async insights(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const month = typeof req.query.month === 'string' ? req.query.month : insightService.monthKey(new Date());
    const insight = await prisma.monthlyInsight.findUnique({ where: { userId_month: { userId, month } } });
    res.status(200).json({ insight: insight ?? { month, summary: null } });
  },

  async ingestCustomOnline(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId, platform, conversation } = ingestCustomOnlineSchema.parse(req.body);
    const result = await importService.ingestCustomOnline(userId, bucketId, platform, {
      externalId: conversation.id,
      title: conversation.title,
      messages: conversation.messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt ?? new Date() })),
    });
    res.status(202).json(result);
  },

  async deleteConversations(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { ids } = deleteConversationsSchema.parse(req.body);
    const result = await conversationService.deleteMany(userId, ids);
    res.status(200).json(result);
  },
};
