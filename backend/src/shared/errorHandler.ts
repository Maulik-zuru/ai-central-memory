import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { logger } from './logger';

// Centralized error shape so every client (dashboard, API consumers) parses errors the same way.
// Operational errors (AppError, validation) are expected and not logged as failures; anything else
// is logged with full context — the response body never leaks internals (nodejs-best-practices §4).
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
      },
    });
  }

  (req.log ?? logger).error({ err, method: req.method, url: req.url }, 'Unhandled error');
  const isProd = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: isProd ? 'Something went wrong' : (err as Error)?.message },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
