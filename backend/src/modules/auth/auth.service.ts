import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { auditService } from '../audit/audit.service';
import { generateRefreshToken, sha256Hex, signAccessToken } from '../../shared/tokens';

const BCRYPT_ROUNDS = 12;
const TRIAL_DAYS = 7;

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthResult {
  user: { id: string; email: string; planId: string };
  accessToken: string;
  refreshToken: string;
}

async function createSession(userId: string, meta: RequestMeta) {
  const rawRefreshToken = generateRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId,
      refreshToken: sha256Hex(rawRefreshToken),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });
  const accessToken = signAccessToken({ sub: userId, sessionId: session.id });
  return { accessToken, refreshToken: rawRefreshToken };
}

function toPublicUser(user: { id: string; email: string; planId: string }) {
  return { id: user.id, email: user.email, planId: user.planId };
}

export const authService = {
  async register(email: string, password: string, meta: RequestMeta = {}): Promise<AuthResult> {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Deliberately generic — never reveal that the email is already registered (US-ACC-01 AC).
      throw AppError.conflict('Could not create account with the provided details', 'REGISTRATION_FAILED');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        subscription: {
          create: { plan: 'core', status: 'trialing', trialEndsAt },
        },
      },
    });

    await auditService.record(user.id, 'user.register', { type: 'User', id: user.id });
    const tokens = await createSession(user.id, meta);
    return { user: toPublicUser(user), ...tokens };
  },

  async login(email: string, password: string, meta: RequestMeta = {}): Promise<AuthResult> {
    const genericError = () => AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw genericError();

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw genericError();

    await auditService.record(user.id, 'user.login', { type: 'User', id: user.id });
    const tokens = await createSession(user.id, meta);
    return { user: toPublicUser(user), ...tokens };
  },

  async loginWithGoogle(profile: { googleId: string; email: string }, meta: RequestMeta = {}): Promise<AuthResult> {
    let user = await prisma.user.findUnique({ where: { oauthGoogleId: profile.googleId } });

    if (!user) {
      // Link by email if the account already exists, otherwise provision a new one — either way,
      // no separate password step (US-ACC-01 AC).
      user = await prisma.user.upsert({
        where: { email: profile.email },
        update: { oauthGoogleId: profile.googleId },
        create: {
          email: profile.email,
          oauthGoogleId: profile.googleId,
          subscription: {
            create: {
              plan: 'core',
              status: 'trialing',
              trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
            },
          },
        },
      });
    }

    await auditService.record(user.id, 'user.login.google', { type: 'User', id: user.id });
    const tokens = await createSession(user.id, meta);
    return { user: toPublicUser(user), ...tokens };
  },

  async refresh(rawRefreshToken: string, meta: RequestMeta = {}): Promise<AuthResult> {
    const tokenHash = sha256Hex(rawRefreshToken);
    const session = await prisma.session.findUnique({ where: { refreshToken: tokenHash } });

    if (!session || session.revokedAt) {
      throw AppError.unauthorized('Invalid or expired session', 'INVALID_SESSION');
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });

    // Rotate: revoke the old session row and issue a brand new one, so a leaked refresh token
    // can't be replayed indefinitely.
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await createSession(user.id, {
      userAgent: meta.userAgent ?? session.userAgent ?? undefined,
      ipAddress: meta.ipAddress ?? session.ipAddress ?? undefined,
    });
    return { user: toPublicUser(user), ...tokens };
  },

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = sha256Hex(rawRefreshToken);
    const session = await prisma.session.findUnique({ where: { refreshToken: tokenHash } });
    if (!session || session.revokedAt) return; // idempotent

    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await auditService.record(session.userId, 'user.logout', { type: 'Session', id: session.id });
  },
};
