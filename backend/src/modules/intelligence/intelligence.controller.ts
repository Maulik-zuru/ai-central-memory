import { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { prisma } from '../../shared/prisma';
import { graphService } from './graph.service';
import { analyticsService } from './analytics.service';
import { graphQuerySchema, usageQuerySchema, insightsQuerySchema } from './intelligence.types';

function requireAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

// Plan gating for these three endpoints now lives entirely in intelligence.routes.ts's
// requirePlan('pro') middleware — Phase 9 shipped this module with its own inline
// subscription.plan === 'pro' check as an explicit stopgap (docs/Phase9_Implementation_Plan.md §9);
// this is that stopgap's removal, not a new gate.
export const intelligenceController = {
  async graph(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { bucketId } = graphQuerySchema.parse(req.query);
    const graph = await graphService.getGraph(userId, { bucketId });
    res.status(200).json(graph);
  },

  async usage(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { period } = usageQuerySchema.parse(req.query);
    const usage = await analyticsService.getUsage(userId, period);
    res.status(200).json({ usage: usage ?? { period: period ?? analyticsService.monthKey(new Date()), memoriesCreated: 0, askQueries: 0, syncsCompleted: 0, tokensSaved: 0, computedAt: null } });
  },

  // Thin read reusing Phase 5's MonthlyInsight generation — exposed here per US-ADV-03's "surfaced
  // through a dedicated read endpoint here" (docs/Phase9_Implementation_Plan.md §5.2).
  async insights(req: Request, res: Response) {
    const { userId } = requireAuth(req);
    const { month } = insightsQuerySchema.parse(req.query);
    const targetMonth = month ?? analyticsService.monthKey(new Date());
    const insight = await prisma.monthlyInsight.findUnique({ where: { userId_month: { userId, month: targetMonth } } });
    res.status(200).json({ insight: insight ?? { month: targetMonth, summary: null } });
  },
};
