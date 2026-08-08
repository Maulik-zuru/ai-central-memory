import { Request, Response } from 'express';
import { authService } from './auth.service';
import { loginSchema, refreshSchema, registerSchema } from './auth.types';

function requestMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

const REFRESH_COOKIE = 'refreshToken';
const isProd = process.env.NODE_ENV === 'production';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}

function respondWithAuth(res: Response, status: number, result: Awaited<ReturnType<typeof authService.register>>) {
  setRefreshCookie(res, result.refreshToken);
  res.status(status).json({ user: result.user, accessToken: result.accessToken });
}

export const authController = {
  async register(req: Request, res: Response) {
    const { email, password } = registerSchema.parse(req.body);
    const result = await authService.register(email, password, requestMeta(req));
    respondWithAuth(res, 201, result);
  },

  async login(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login(email, password, requestMeta(req));
    respondWithAuth(res, 200, result);
  },

  async refresh(req: Request, res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] ?? refreshSchema.parse(req.body).refreshToken;
    const result = await authService.refresh(raw, requestMeta(req));
    respondWithAuth(res, 200, result);
  },

  async logout(req: Request, res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (raw) await authService.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).send();
  },

  // Phase 1 stub: real Google OAuth code-exchange is an infra/credentials task (needs a
  // GOOGLE_CLIENT_ID/SECRET pair from Google Cloud Console). This endpoint accepts an
  // already-verified Google profile (as a real OAuth library would hand back after exchange)
  // so the rest of the account-linking logic is real and testable today.
  async googleCallback(req: Request, res: Response) {
    const { googleId, email } = req.body as { googleId?: string; email?: string };
    if (!googleId || !email) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'googleId and email are required' } });
      return;
    }
    const result = await authService.loginWithGoogle({ googleId, email }, requestMeta(req));
    respondWithAuth(res, 200, result);
  },
};
