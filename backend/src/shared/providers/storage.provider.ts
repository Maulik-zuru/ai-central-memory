import crypto from 'crypto';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';

export interface StoredFile {
  key: string;
  url: string;
}

export interface StorageProvider {
  put(buffer: Buffer, filename: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /** Reads the stored bytes back — Phase 6's document parser needs the raw file, not just its
   * public URL (image memories never needed this; they're only ever served, never re-read). */
  get(key: string): Promise<Buffer>;
}

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');

// Local-disk implementation for dev/self-hosted use — files under backend/uploads/, served via
// the static route mounted in app.ts. A production deployment swaps this for an S3-compatible
// provider behind the same two-method interface; nothing in memory.service.ts would need to
// change (codebase-design: the seam is the interface, not the call sites).
export const localDiskStorageProvider: StorageProvider = {
  async put(buffer, filename) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(filename).slice(0, 10);
    const key = `${crypto.randomUUID()}${ext}`;
    await writeFile(path.join(UPLOAD_DIR, key), buffer);
    return { key, url: `/uploads/${key}` };
  },

  async delete(key) {
    await unlink(path.join(UPLOAD_DIR, key)).catch(() => {
      // Already gone — deleting a memory whose image was never fully written is not an error.
    });
  },

  async get(key) {
    return readFile(path.join(UPLOAD_DIR, key));
  },
};

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  return cached ?? localDiskStorageProvider;
}

/** Test-only escape hatch so suites can inject a failing/fake provider, matching the shape
 * llm.provider.ts and payment.provider.ts already expose. Phase 11 needs it to prove an export
 * that fails mid-write lands in "failed" rather than hanging in "running" — a path that cannot be
 * exercised against a real disk that always succeeds. */
export function __setStorageProviderForTests(provider: StorageProvider | null) {
  cached = provider;
}

export { UPLOAD_DIR };
