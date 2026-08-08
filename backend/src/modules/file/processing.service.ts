import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getStorageProvider } from '../../shared/providers/storage.provider';
import { getDocumentParser, type ParsedPage } from '../../shared/providers/document-parser.provider';
import { getLlmProvider } from '../../shared/providers/llm.provider';
import { toVectorLiteral } from '../../shared/vector';

const MAX_CHUNK_CHARS = 1200;

// A chunk never spans two pages (Phase6_Implementation_Plan.md §4: a citation must point to
// exactly one page) — split within a page's own text by paragraph, only when the page is
// unusually long.
function chunkPage(page: ParsedPage): string[] {
  if (page.text.length <= MAX_CHUNK_CHARS) return [page.text];
  const paragraphs = page.text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length > 0 && current.length + para.length > MAX_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [page.text];
}

export const processingService = {
  async process(fileId: string): Promise<void> {
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file) return;

    try {
      const parser = getDocumentParser(file.mimeType);
      if (!parser) throw new Error(`No parser registered for ${file.mimeType}`);

      const buffer = await getStorageProvider().get(file.storageKey);
      const pages = await parser.parse(buffer);

      // A scanned/no-text-layer PDF (or any file with nothing extractable) ends in a clear error
      // state, not stuck at "processing" forever and not silently "ready" with zero chunks.
      if (pages.length === 0) {
        await prisma.file.update({
          where: { id: fileId },
          data: { status: 'error', errorReason: 'No readable text found in this file.' },
        });
        return;
      }

      const provider = getLlmProvider();
      for (const page of pages) {
        for (const chunkText of chunkPage(page)) {
          const embedding = await provider.embed(chunkText);
          const chunk = await prisma.fileChunk.create({
            data: { fileId, page: page.number, content: chunkText },
          });
          await prisma.$executeRaw`
            UPDATE "FileChunk" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${chunk.id}
          `;
        }
      }

      await prisma.file.update({
        where: { id: fileId },
        data: { status: 'ready', errorReason: null, pageCount: pages.length },
      });
    } catch (err) {
      logger.error({ err, fileId }, 'File processing failed');
      await prisma.file.update({
        where: { id: fileId },
        data: { status: 'error', errorReason: err instanceof Error ? err.message : 'Unknown error' },
      });
    }
  },
};
