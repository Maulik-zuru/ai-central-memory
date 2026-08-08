import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Structured logging (nodejs-backend-patterns): plain console.log/error loses request context and
// can't be shipped to a log aggregator. pino-http (see app.ts) attaches a per-request child logger.
export const logger = pino({
  level: isTest ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  transport:
    isProd || isTest ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
