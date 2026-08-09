import crypto from 'crypto';
import path from 'path';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';

export interface StoredFile {
  key: string;
  /** Public URL. Null for private objects, which are never reachable over the static route and
   * must be served through an authenticated endpoint instead. */
  url: string | null;
}

export interface StorageProvider {
  /** Stores an object in the PUBLIC namespace, served directly by the /uploads static route.
   * Only for content that is safe to hand to anyone holding the URL — image memories, whose
   * `imageUrl` is embedded in an <img> tag the browser fetches without credentials. */
  put(buffer: Buffer, filename: string): Promise<StoredFile>;
  /** Stores an object in the PRIVATE namespace, which no static route serves. For anything that
   * needs an ownership check before release — Phase 11 data-export archives, which contain a
   * complete plaintext dump of an account (see export.service.ts). Putting one of those in the
   * public namespace would make export.service.download()'s ownership and expiry checks
   * unenforceable: the identical bytes would be fetchable at /uploads/<key> with no credentials. */
  putPrivate(buffer: Buffer, filename: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /** Reads the stored bytes back — Phase 6's document parser needs the raw file, not just its
   * public URL (image memories never needed this; they're only ever served, never re-read). */
  get(key: string): Promise<Buffer>;
}

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');
// A sibling of UPLOAD_DIR, deliberately NOT the same tree: app.ts mounts express.static on
// UPLOAD_DIR, and any private object living underneath it would be served unauthenticated.
const PRIVATE_DIR = path.join(__dirname, '../../../private-storage');

/** Private keys carry a prefix so delete()/get() can route to the right directory from the key
 * alone — callers store only a key string and shouldn't have to remember which namespace it came
 * from. */
const PRIVATE_PREFIX = 'private/';

function resolveKeyPath(key: string): string {
  if (key.startsWith(PRIVATE_PREFIX)) {
    return path.join(PRIVATE_DIR, key.slice(PRIVATE_PREFIX.length));
  }
  return path.join(UPLOAD_DIR, key);
}

// Local-disk implementation for dev/self-hosted use. A production deployment swaps this for an
// S3-compatible provider behind the same interface; the public/private split maps onto a
// public-read bucket vs. a private bucket there (codebase-design: the seam is the interface, not
// the call sites).
export const localDiskStorageProvider: StorageProvider = {
  async put(buffer, filename) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(filename).slice(0, 10);
    const key = `${crypto.randomUUID()}${ext}`;
    await writeFile(path.join(UPLOAD_DIR, key), buffer);
    return { key, url: `/uploads/${key}` };
  },

  async putPrivate(buffer, filename) {
    await mkdir(PRIVATE_DIR, { recursive: true });
    const ext = path.extname(filename).slice(0, 10);
    const key = `${PRIVATE_PREFIX}${crypto.randomUUID()}${ext}`;
    await writeFile(resolveKeyPath(key), buffer);
    return { key, url: null };
  },

  async delete(key) {
    await unlink(resolveKeyPath(key)).catch(() => {
      // Already gone — deleting a memory whose image was never fully written is not an error.
    });
  },

  async get(key) {
    return readFile(resolveKeyPath(key));
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

export { UPLOAD_DIR, PRIVATE_DIR };
