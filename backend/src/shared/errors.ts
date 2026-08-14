export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND', details?: Record<string, unknown>) {
    return new AppError(404, code, message, details);
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }

  // Phase 18 (§7.4 "fail open, never fail silent"): the typed shape a caught `ProviderError`
  // becomes at a service boundary — a real, distinguishable 503, never a misleadingly-empty 200.
  static serviceUnavailable(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    return new AppError(503, code, message);
  }
}
