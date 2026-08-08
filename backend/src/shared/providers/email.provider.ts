import { logger } from '../logger';

export interface EmailProvider {
  send(params: { to: string; subject: string; html: string }): Promise<void>;
}

// Test-only outbox — every stub-sent email lands here so a test can assert "an invite email went
// out" without a real inbox. Cleared between tests via clearStubOutbox() (see tests/testUtils.ts).
export const stubOutbox: { to: string; subject: string; html: string }[] = [];

export const stubEmailProvider: EmailProvider = {
  async send(params) {
    stubOutbox.push(params);
    logger.info({ to: params.to, subject: params.subject }, 'Stub email sent (no EMAIL provider configured)');
  },
};

// Real implementation plugs in here behind the same interface (codebase-design), gated by an API
// key exactly the way Phase 2's LlmProvider picks Anthropic/OpenAI vs. its stub.
class ResendEmailProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(params: { to: string; subject: string; html: string }): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.from, to: params.to, subject: params.subject, html: params.html }),
    });
    if (!res.ok) {
      logger.error({ status: res.status, to: params.to }, 'Resend email send failed');
      throw new Error('Failed to send email');
    }
  }
}

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'onboarding@memoryos.dev';
  cached = apiKey ? new ResendEmailProvider(apiKey, from) : stubEmailProvider;
  return cached;
}

export function clearStubOutbox() {
  stubOutbox.length = 0;
}
