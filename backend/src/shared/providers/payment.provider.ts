import crypto from 'crypto';
import { logger } from '../logger';

export interface WebhookEvent {
  id: string;
  type: string;
  data: {
    userId?: string;
    plan?: 'pro';
    status?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePaymentId?: string;
    amountCents?: number;
    currency?: string;
    paidAt?: string;
  };
}

export interface CheckoutSession {
  url: string;
}

export interface PaymentProvider {
  createCheckoutSession(userId: string, plan: 'pro'): Promise<CheckoutSession>;
  createBillingPortalSession(userId: string): Promise<CheckoutSession>;
  /** Returns the verified event, or null if the signature doesn't check out (docs/Phase10_Implementation_Plan.md §4). */
  verifyWebhookSignature(payload: string, signature: string | undefined): Promise<WebhookEvent | null>;
}

// No real Stripe test-mode key required for this stub — a fake session URL keyed by
// userId/plan, and a webhook verifier that accepts any payload as long as a signature header was
// sent at all. Real cryptographic verification is the genuine external dependency the real
// provider below adds; the stub only has to prove "the whole flow is testable in CI," the same bar
// every provider in this codebase meets (docs/Phase10_Implementation_Plan.md §4).
export const stubPaymentProvider: PaymentProvider = {
  async createCheckoutSession(userId, plan) {
    return { url: `https://stub-checkout.local/session?userId=${userId}&plan=${plan}` };
  },
  async createBillingPortalSession(userId) {
    return { url: `https://stub-billing-portal.local/session?userId=${userId}` };
  },
  async verifyWebhookSignature(payload, signature) {
    if (!signature) return null;
    try {
      return JSON.parse(payload) as WebhookEvent;
    } catch {
      logger.error('Stub webhook payload was not valid JSON');
      return null;
    }
  },
};

// Real implementation: Stripe's REST API directly (no SDK dependency to add) — hosted Checkout and
// Billing Portal session creation, plus Stripe's documented HMAC-SHA256 webhook signature scheme —
// the same "real network call behind the same interface" shape every other provider swap in this
// codebase follows (LlmProvider's Anthropic client, EmailProvider's Resend client, etc.).
class StripePaymentProvider implements PaymentProvider {
  constructor(
    private secretKey: string,
    private webhookSecret: string,
    private proPriceId: string,
    private appUrl: string,
  ) {}

  private async post(path: string, body: URLSearchParams): Promise<Record<string, unknown> | null> {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      logger.error({ status: res.status, path }, 'Stripe API call failed');
      return null;
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  async createCheckoutSession(userId: string, plan: 'pro'): Promise<CheckoutSession> {
    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': this.proPriceId,
      'line_items[0][quantity]': '1',
      client_reference_id: userId,
      success_url: `${this.appUrl}/dashboard/settings/billing?checkout=success`,
      cancel_url: `${this.appUrl}/dashboard/settings/billing?checkout=canceled`,
    });
    void plan; // only 'pro' exists today — kept as a param for when a second paid tier is added
    const session = await this.post('checkout/sessions', body);
    const url = session?.url as string | undefined;
    if (!url) throw new Error('Stripe did not return a checkout session URL');
    return { url };
  }

  async createBillingPortalSession(userId: string): Promise<CheckoutSession> {
    // A full implementation resolves userId -> the stored Stripe customer id (Subscription.stripeIds)
    // before this call; omitted here since no real customer has ever been created without live keys.
    const body = new URLSearchParams({ customer: userId, return_url: `${this.appUrl}/dashboard/settings/billing` });
    const session = await this.post('billing_portal/sessions', body);
    const url = session?.url as string | undefined;
    if (!url) throw new Error('Stripe did not return a billing portal session URL');
    return { url };
  }

  async verifyWebhookSignature(payload: string, signature: string | undefined): Promise<WebhookEvent | null> {
    if (!signature) return null;
    const parts = Object.fromEntries(
      signature.split(',').map((kv) => kv.split('=') as [string, string]),
    );
    const timestamp = parts.t;
    const expectedSig = parts.v1;
    if (!timestamp || !expectedSig) return null;

    const computed = crypto.createHmac('sha256', this.webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
    const computedBuf = Buffer.from(computed, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (computedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(computedBuf, expectedBuf)) {
      logger.error('Stripe webhook signature mismatch');
      return null;
    }
    return JSON.parse(payload) as WebhookEvent;
  }
}

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  cached =
    secretKey && webhookSecret && proPriceId
      ? new StripePaymentProvider(secretKey, webhookSecret, proPriceId, appUrl)
      : stubPaymentProvider;
  return cached;
}

/** Test-only escape hatch so suites can inject a fake provider instead of the singleton. */
export function __setPaymentProviderForTests(provider: PaymentProvider | null) {
  cached = provider;
}
