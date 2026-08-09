import { disconnect } from './testUtils';
import { prisma } from '../src/shared/prisma';

/**
 * Guards the Phase 12 vector indexes against silent removal.
 *
 * These indexes live in raw-SQL migrations because they sit on `Unsupported("vector(1536)")`
 * columns Prisma's schema language cannot describe. Prisma consequently sees them as drift and
 * emits `DROP INDEX` for them at the top of the NEXT migration `prisma migrate dev` generates —
 * which is exactly how all four were lost once already, inside a one-line migration that added a
 * boolean column and looked entirely harmless in review.
 *
 * Nothing else in the suite would notice: every query still returns correct results, just via a
 * sequential scan. The only symptom is latency, at a data volume no test fixture reaches. So the
 * invariant is asserted directly.
 */
const REQUIRED_INDEXES = [
  { index: 'memory_embedding_hnsw_idx', table: 'Memory' },
  { index: 'message_chunk_embedding_hnsw_idx', table: 'MessageChunk' },
  { index: 'file_chunk_embedding_hnsw_idx', table: 'FileChunk' },
  { index: 'category_centroid_hnsw_idx', table: 'Category' },
];

describe('Phase 12: vector indexes exist and are HNSW', () => {
  afterAll(disconnect);

  it.each(REQUIRED_INDEXES)('$index is present on $table', async ({ index, table }) => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = ${index} AND tablename = ${table}
    `;

    expect(rows).toHaveLength(1);
    // Not just "an index exists" — the access method and operator class both matter. A btree here,
    // or vector_l2_ops against queries that use the `<=>` cosine operator, would never be chosen
    // by the planner and would leave the sequential scan in place while looking fixed.
    expect(rows[0].indexdef).toMatch(/USING hnsw/);
    expect(rows[0].indexdef).toMatch(/vector_cosine_ops/);
  });
});
