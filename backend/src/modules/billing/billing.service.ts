import { prisma } from '../../shared/prisma';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { getPaymentProvider, type WebhookEvent } from '../../shared/providers/payment.provider';
import { historyLimitService } from '../chat-history/history-limit.service';
import { analyticsService } from '../intelligence/analytics.service';

// US-BIL-03: a payment stays refund-eligible for 14 days, computed from the real paidAt timestamp
// at write time — not "now minus a window" evaluated at read time, which would drift.
const REFUND_WINDOW_DAYS = 14;

async function applyEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.updated': {
      const { userId, plan, status, stripeCustomerId, stripeSubscriptionId } = event.data;
      if (!userId) throw new Error(`Webhook event ${event.id} (${event.type}) is missing userId`);
      await prisma.subscription.update({
        where: { userId },
        data: {
          plan: plan ?? 'pro',
          status: status ?? 'active',
          stripeIds: { customerId: stripeCustomerId, subscriptionId: stripeSubscriptionId },
        },
      });
      return;
    }
    case 'customer.subscription.deleted': {
      const { userId } = event.data;
      if (!userId) throw new Error(`Webhook event ${event.id} (${event.type}) is missing userId`);
      // Upgrade takes effect on payment confirmation; downgrade takes effect on the cancellation
      // webhook — both immediately, never on a delay this codebase would have to poll for.
      await prisma.subscription.update({ where: { userId }, data: { plan: 'core', status: 'canceled' } });
      return;
    }
    case 'invoice.payment_succeeded': {
      const { userId, stripePaymentId, amountCents, currency, paidAt } = event.data;
      if (!userId || !stripePaymentId || amountCents == null || !paidAt) {
        throw new Error(`Webhook event ${event.id} (${event.type}) is missing required payment fields`);
      }
      const paidAtDate = new Date(paidAt);
      const refundEligibleUntil = new Date(paidAtDate.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      await prisma.payment.upsert({
        where: { stripePaymentId },
        update: {},
        create: {
          userId,
          stripePaymentId,
          amountCents,
          currency: currency ?? 'usd',
          status: 'succeeded',
          paidAt: paidAtDate,
          refundEligibleUntil,
        },
      });
      return;
    }
    default:
      logger.info({ type: event.type, id: event.id }, 'Unhandled Stripe webhook event type — no-op');
  }
}

export const billingService = {
  async createCheckoutSession(userId: string, plan: 'pro'): Promise<{ url: string }> {
    return getPaymentProvider().createCheckoutSession(userId, plan);
  },

  async createBillingPortalSession(userId: string): Promise<{ url: string }> {
    return getPaymentProvider().createBillingPortalSession(userId);
  },

  /** Verifies, dedupes, and applies a Stripe webhook. Rethrows on any processing failure — the
   * caller (the route) must let that propagate to a non-2xx response so Stripe retries; see
   * docs/Phase10_Implementation_Plan.md §5.2. */
  async handleWebhook(payload: string, signature: string | undefined): Promise<void> {
    const event = await getPaymentProvider().verifyWebhookSignature(payload, signature);
    if (!event) throw AppError.badRequest('Invalid webhook signature', 'INVALID_SIGNATURE');

    const alreadyProcessed = await prisma.processedWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (alreadyProcessed) return; // at-least-once delivery — this event's effect already landed

    try {
      await applyEvent(event);
    } catch (err) {
      logger.error({ err, eventId: event.id, type: event.type }, 'Stripe webhook processing failed');
      throw err; // uncaught here means the route returns non-2xx and Stripe retries
    }

    await prisma.processedWebhookEvent.create({ data: { stripeEventId: event.id } });
  },

  async getUsageAndBilling(userId: string) {
    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    const history = await historyLimitService.usage(userId);
    const proUsage = subscription?.plan === 'pro' ? await analyticsService.getUsage(userId) : null;

    return {
      plan: subscription?.plan ?? 'core',
      status: subscription?.status ?? 'trialing',
      trialEndsAt: subscription?.trialEndsAt ?? null,
      history,
      usage: proUsage,
    };
  },

  isRefundEligible(payment: { refundEligibleUntil: Date }): boolean {
    return payment.refundEligibleUntil.getTime() > Date.now();
  },
};
