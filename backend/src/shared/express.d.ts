import type { Logger } from 'pino';

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
      bucketRole?: 'viewer' | 'editor' | 'owner';
    }
  }
}
