import crypto from 'crypto';
import path from 'path';
import { mkdir, unlink, writeFile } from 'fs/promises';

export interface StoredFile {
  key: string;
  url: string;
}

export interface StorageProvider {
  put(buffer: Buffer, filename: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
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
};

export function getStorageProvider(): StorageProvider {
  return localDiskStorageProvider;
}

export { UPLOAD_DIR };
