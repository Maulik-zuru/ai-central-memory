/**
 * Prisma has no native pgvector type — Memory.embedding is `Unsupported("vector(1536)")`, so every
 * read/write touching it goes through $queryRaw/$executeRaw (see prisma-client-api skill's
 * raw-query safety rule: parameterized, never string-concatenated with user input).
 *
 * This helper only ever receives numbers we generated ourselves (embedding provider output), never
 * user-controlled strings, so building the literal here and passing it as a single bound parameter
 * is safe.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/** Inverse of `toVectorLiteral` — parses a pgvector `::text` cast back into a plain number array. */
export function parseVectorLiteral(literal: string): number[] {
  return literal
    .slice(1, -1)
    .split(',')
    .map(Number);
}
