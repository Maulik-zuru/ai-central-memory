import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

function parseVectorLiteral(literal: string): number[] {
  return literal
    .slice(1, -1)
    .split(',')
    .map(Number);
}

// See docs/Phase4_Implementation_Plan.md §5.2. A first calibrated guess (no PRD value to inherit,
// same open-question status as Phase 2's duplicate/stale thresholds): near-identical topical
// content lands under this cosine distance from an existing category's running-average centroid.
export const CATEGORY_DISTANCE_THRESHOLD = 0.35;

interface CategoryCandidate {
  id: string;
  distance: number;
}

// Categories are scoped per-account (creator), not per-bucket — a category is a property of a
// memory's content, not of where it's organized (Phase3_Implementation_Plan.md §9).
export const categorizationService = {
  async run(userId: string, memoryId: string): Promise<void> {
    const memory = await prisma.memory.findUnique({ where: { id: memoryId }, select: { content: true } });
    if (!memory) return;

    // Two memories saved back-to-back can each reach the "no matching category yet" decision
    // before either one's write commits — the embedding pipeline is fire-and-forget, so nothing
    // else serializes concurrent runs for the same user. Rather than detect the resulting races
    // after the fact (duplicate categories, lost centroid updates), an advisory lock scoped to
    // this userId + $transaction serializes the whole "decide, then read-modify-write" section
    // per user, so the second call always sees the first call's committed category.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      await categorize(tx, userId, memoryId, memory.content);
    });
  },
};

async function categorize(tx: Tx, userId: string, memoryId: string, content: string): Promise<void> {
  const nearest = await tx.$queryRaw<CategoryCandidate[]>`
    SELECT id, (centroid <=> (SELECT embedding FROM "Memory" WHERE id = ${memoryId})) AS distance
    FROM "Category"
    WHERE "userId" = ${userId}
    ORDER BY distance ASC
    LIMIT 1
  `;

  const best = nearest[0];
  if (best && best.distance <= CATEGORY_DISTANCE_THRESHOLD) {
    // The plan's design (§5.2) calls for the running-average centroid update as a single
    // `$executeRaw`, vector arithmetic and all. The pgvector version this database actually has
    // installed (0.6.0) only implements `+`/`-` between two vectors — no vector/scalar multiply
    // or divide (those landed in pgvector 0.7.0) — so `(embedding - centroid) / (memoryCount +
    // 1)` cannot run in SQL here. Computing the new centroid in JS and writing it as one `UPDATE`
    // is the closest equivalent this Postgres can execute: still a single write, just with the
    // division done in the application layer instead of by the database.
    const rows = await tx.$queryRaw<{ centroid: string; embedding: string; memoryCount: number }[]>`
      SELECT c.centroid::text AS centroid, m.embedding::text AS embedding, c."memoryCount" AS "memoryCount"
      FROM "Category" c, "Memory" m
      WHERE c.id = ${best.id} AND m.id = ${memoryId}
    `;
    const row = rows[0];
    if (!row) return;
    const centroid = parseVectorLiteral(row.centroid);
    const embedding = parseVectorLiteral(row.embedding);
    const newCount = row.memoryCount + 1;
    const newCentroid = centroid.map((v, i) => v + (embedding[i] - v) / newCount);

    await tx.$executeRaw`
      UPDATE "Category"
      SET centroid = ${toVectorLiteral(newCentroid)}::vector, "memoryCount" = ${newCount}
      WHERE id = ${best.id}
    `;
    await tx.memory.update({ where: { id: memoryId }, data: { categoryId: best.id } });
    return;
  }

  const embedding = await tx.$queryRaw<{ embedding: string }[]>`
    SELECT embedding::text FROM "Memory" WHERE id = ${memoryId}
  `;
  if (!embedding[0]) return;

  const label = await getLlmProvider().suggestCategoryLabel(content);
  const uniqueLabel = await resolveUniqueLabel(tx, userId, label);

  const category = await tx.category.create({
    data: { userId, label: uniqueLabel, memoryCount: 1 },
  });
  await tx.$executeRaw`
    UPDATE "Category" SET centroid = ${embedding[0].embedding}::vector WHERE id = ${category.id}
  `;
  await tx.memory.update({ where: { id: memoryId }, data: { categoryId: category.id } });
}

// The stub labeler is deterministic per content, so two memories about different topics that
// happen to produce the same top word (e.g. both mention "project") would otherwise collide on
// the @@unique([userId, label]) constraint — append a disambiguating suffix rather than let
// category creation fail. Safe to check-then-create here (no separate race) since the advisory
// lock above already serializes every categorization decision for this user.
async function resolveUniqueLabel(tx: Tx, userId: string, label: string): Promise<string> {
  let candidate = label;
  let suffix = 2;
  while (await tx.category.findUnique({ where: { userId_label: { userId, label: candidate } } })) {
    candidate = `${label} ${suffix}`;
    suffix++;
  }
  return candidate;
}

