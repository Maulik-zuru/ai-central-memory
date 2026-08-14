import type { Logger } from 'pino';
import type { BucketRole } from './bucketAccess';

export {};

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        via: 'session' | 'apiKey';
        sessionId?: string;
        apiKeyId?: string;
        scopes?: string[];
      };
      log: Logger;
      bucketRole?: BucketRole;
    }
  }
}
