import { Router } from 'express';
import { asyncHandler } from '../../shared/errorHandler';
import { authController } from './auth.controller';
import { authRateLimit } from '../../shared/rateLimit';

export const authRouter = Router();

authRouter.post('/register', authRateLimit, asyncHandler(authController.register));
authRouter.post('/login', authRateLimit, asyncHandler(authController.login));
authRouter.post('/refresh', asyncHandler(authController.refresh));
authRouter.post('/logout', asyncHandler(authController.logout));
authRouter.post('/google/callback', authRateLimit, asyncHandler(authController.googleCallback));
