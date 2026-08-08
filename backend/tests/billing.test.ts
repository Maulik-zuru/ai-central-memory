import request from 'supertest';
import { createApp } from '../src/app';
import { disconnect, registerAndGetToken, resetDb } from './testUtils';
import { prisma } from '../src/shared/prisma';
import { billingService } from '../src/modules/billing/billing.service';
import { trialExpiryService } from '../src/modules/billing/trial-expiry.service';
import { getPaymentProvider } from '../src/shared/providers/payment.provider';

const app = createApp();

async function seedAccount(email: string) {
  const token = await registerAndGetToken(app, email);
  const account = await request(app).get('/api/account/me').set('Authorization', `Bearer ${token}`);
  return { token, userId: account.body.account.id as string };
}

let eventCounter = 0;
function nextEventId() {
  eventCounter += 1;
  return `evt_test_${eventCounter}`;
}

function sendWebhook(body: object) {
  return request(app).post('/api/billing/webhook').set('stripe-signature', 'test-sig').send(body);
}

describe('Phase 10: Billing & Plans (US-BIL-01..04)', () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it('upgrades Subscription.plan on a confirmed-payment webhook, unlocking a requirePlan gate on the very next request', async () => {
    const { token, userId } = await seedAccount('bill-a@example.com');

    const before = await request(app).get('/api/intelligence/usage').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(403);

    const res = await sendWebhook({
      id: nextEventId(),
      type: 'checkout.session.completed',
      data: { userId, plan: 'pro', status: 'active' },
    });
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/intelligence/usage').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(200);
  });

  it('applies the same webhook event delivered twice only once', async () => {
    const { userId } = await seedAccount('bill-b@example.com');
    const eventId = nextEventId();
    const paymentEvent = {
      id: eventId,
      type: 'invoice.payment_succeeded',
      data: { userId, stripePaymentId: 'pi_dup_test', amountCents: 2900, currency: 'usd', paidAt: new Date().toISOString() },
    };

    const first = await sendWebhook(paymentEvent);
    expect(first.status).toBe(200);
    const second = await sendWebhook(paymentEvent);
    expect(second.status).toBe(200);

    const payments = await prisma.payment.findMany({ where: { userId } });
    expect(payments).toHaveLength(1);
    const processed = await prisma.processedWebhookEvent.findMany({ where: { stripeEventId: eventId } });
    expect(processed).toHaveLength(1);
  });

  it('returns a non-2xx response (so Stripe retries) when webhook processing throws mid-handling', async () => {
    const { userId } = await seedAccount('bill-c@example.com');

    const res = await sendWebhook({
      id: nextEventId(),
      type: 'invoice.payment_succeeded',
      // Missing stripePaymentId/amountCents/paidAt — applyEvent() throws.
      data: { userId },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    const processed = await prisma.processedWebhookEvent.count();
    expect(processed).toBe(0); // never marked processed, so a real Stripe retry would reprocess it
  });

  it('immediately 403s every retrofitted Pro endpoint the very next request after a downgrade webhook', async () => {
    const { token, userId } = await seedAccount('bill-d@example.com');
    await sendWebhook({
      id: nextEventId(),
      type: 'checkout.session.completed',
      data: { userId, plan: 'pro', status: 'active' },
    });

    const proOk = await request(app).get('/api/intelligence/graph').set('Authorization', `Bearer ${token}`);
    expect(proOk.status).toBe(200);

    await sendWebhook({
      id: nextEventId(),
      type: 'customer.subscription.deleted',
      data: { userId },
    });

    for (const path of ['/api/intelligence/graph', '/api/intelligence/usage', '/api/intelligence/insights', '/api/chat-history/insights']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRO_FEATURE');
    }
  });

  it('computes refund eligibility from the stored paidAt-derived window, not "now minus a window" at read time', async () => {
    const { userId } = await seedAccount('bill-e@example.com');
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const eligible = await prisma.payment.create({
      data: {
        userId,
        stripePaymentId: 'pi_13_days',
        amountCents: 2900,
        status: 'succeeded',
        paidAt: new Date(now - 13 * dayMs),
        refundEligibleUntil: new Date(now - 13 * dayMs + 14 * dayMs),
      },
    });
    const expired = await prisma.payment.create({
      data: {
        userId,
        stripePaymentId: 'pi_15_days',
        amountCents: 2900,
        status: 'succeeded',
        paidAt: new Date(now - 15 * dayMs),
        refundEligibleUntil: new Date(now - 15 * dayMs + 14 * dayMs),
      },
    });

    expect(billingService.isRefundEligible(eligible)).toBe(true);
    expect(billingService.isRefundEligible(expired)).toBe(false);
  });

  it('transitions a trialing subscription past trialEndsAt to expired, treated as Core-tier by requirePlan', async () => {
    const { token, userId } = await seedAccount('bill-f@example.com');
    await prisma.subscription.update({
      where: { userId },
      data: { trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    await trialExpiryService.runExpiry();

    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    expect(subscription?.status).toBe('expired');

    const res = await request(app).get('/api/intelligence/usage').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('exercises every PaymentProvider method via the stub without a real Stripe key configured', async () => {
    const provider = getPaymentProvider();
    const checkout = await provider.createCheckoutSession('user_x', 'pro');
    expect(checkout.url).toContain('userId=user_x');
    const portal = await provider.createBillingPortalSession('user_x');
    expect(portal.url).toContain('userId=user_x');
    const event = await provider.verifyWebhookSignature(JSON.stringify({ id: 'evt_1', type: 'noop', data: {} }), 'any-signature');
    expect(event?.id).toBe('evt_1');
    const rejected = await provider.verifyWebhookSignature('{}', undefined);
    expect(rejected).toBeNull();
  });

  it('exposes checkout, portal, and summary endpoints', async () => {
    const { token } = await seedAccount('bill-g@example.com');

    const checkout = await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toBeDefined();

    const portal = await request(app).post('/api/billing/portal').set('Authorization', `Bearer ${token}`);
    expect(portal.status).toBe(200);
    expect(portal.body.url).toBeDefined();

    const summary = await request(app).get('/api/billing/summary').set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);
    expect(summary.body.plan).toBe('core');
  });
});
