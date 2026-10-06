// Automatically revokes a business's CRM dashboard access when their Stripe
// subscription actually ends (status becomes "canceled" or "unpaid"), and
// restores it if the subscription becomes active again. Also queues the
// one-time setup fee for trial signups (see handleSubscriptionCreated below).
// Dormant-safe like the rest of the integrations: with STRIPE_WEBHOOK_SECRET
// unset, every request is rejected before touching the database.
//
// This lives behind a real server route (see ../routes/stripe.webhook.tsx)
// that returns a raw Response, not a page-route loader. Stripe reads the
// HTTP status code to decide whether a delivery succeeded and should be
// retried on failure -- a page route's loader-set status doesn't reliably
// reach the client through Vercel's page-rendering pipeline, so this
// returns Response objects directly instead.

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { getDb, isDbConfigured } from "./db/client";
import { businesses } from "./db/schema";
import { SETUP_FEE_CENTS } from "./pricing";

export function isStripeWebhookConfigured(): boolean {
  return Boolean(
    process.env["STRIPE_SECRET_KEY"] && process.env["STRIPE_WEBHOOK_SECRET"] && isDbConfigured(),
  );
}

// Subscription statuses that mean "this business should lose access."
const REVOKED_STATUSES = new Set<Stripe.Subscription.Status>(["canceled", "unpaid"]);
// Statuses that mean "this business should have access" -- covers a
// subscription being reactivated (e.g. Colby un-cancels it in Stripe, or a
// failed payment gets retried successfully) after it was revoked.
const RESTORED_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing"]);

async function setAccessRevokedForSubscription(
  subscriptionId: string,
  revoked: boolean,
): Promise<void> {
  const db = getDb();
  const [business] = await db
    .select({ id: businesses.id, accessRevoked: businesses.accessRevoked })
    .from(businesses)
    .where(eq(businesses.stripeSubscriptionId, subscriptionId))
    .limit(1);

  // No matching business (e.g. checkout was started but never claimed) --
  // nothing to revoke or restore.
  if (!business || business.accessRevoked === revoked) return;

  await db.update(businesses).set({ accessRevoked: revoked }).where(eq(businesses.id, business.id));
}

// The one-time setup fee for FREE TRIAL signups. These reach Stripe Checkout
// with the $20 fee left out of line_items on purpose (see
// ../lib/checkout.server.ts): Checkout charges one-time line items
// immediately, even on a trialing subscription, which would defeat "nothing
// charged for 7 days." Instead, once the subscription exists and is trialing,
// we queue the fee as a pending invoice item tied to that customer and
// subscription. Stripe folds pending items into the subscription's next
// invoice, which for a fresh trial is the one generated when the trial ends,
// so the $20 lands on the same invoice as the first month, exactly once.
//
// This only runs for plan "trial". Plan "membership" (no trial) pays the fee
// as a Checkout line item today, so it must never get a second one here.
//
// Stripe can deliver the same event more than once (retries after a failed
// response, manual resends, rare duplicate deliveries). Two guards make sure
// the fee is queued only once per subscription:
// 1. Before creating anything, look at the customer's existing invoice items.
//    The item we create is tagged with the subscription id in its metadata, so
//    a later delivery sees the tag and skips. This check also skips customers
//    that already carry an untagged setup fee item created by the earlier
//    version of this handler.
// 2. The create call uses an idempotency key derived from the subscription id,
//    so two deliveries racing each other cannot both create an item.
const SETUP_FEE_DESCRIPTION = "One-time account setup fee";
const SETUP_FEE_SUBSCRIPTION_KEY = "setup_fee_for_subscription";

async function hasSetupFeeItem(
  stripe: Stripe,
  customerId: string,
  subscriptionId: string,
): Promise<boolean> {
  // Each checkout creates its own Stripe customer, so this list is tiny.
  for await (const item of stripe.invoiceItems.list({ customer: customerId, limit: 100 })) {
    if (item.metadata?.[SETUP_FEE_SUBSCRIPTION_KEY] === subscriptionId) return true;
    if (item.amount === SETUP_FEE_CENTS && item.description === SETUP_FEE_DESCRIPTION) return true;
  }
  return false;
}

async function handleSubscriptionCreated(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<void> {
  if (subscription.status !== "trialing") return;
  if (subscription.metadata?.["plan"] !== "trial") return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  if (await hasSetupFeeItem(stripe, customerId, subscription.id)) return;

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      subscription: subscription.id,
      currency: "usd",
      amount: SETUP_FEE_CENTS,
      description: SETUP_FEE_DESCRIPTION,
      metadata: { [SETUP_FEE_SUBSCRIPTION_KEY]: subscription.id },
    },
    { idempotencyKey: `setup-fee-${subscription.id}` },
  );
}

async function handleStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  if (event.type === "customer.subscription.created") {
    await handleSubscriptionCreated(stripe, event.data.object as Stripe.Subscription);
    return;
  }

  if (
    event.type !== "customer.subscription.deleted" &&
    event.type !== "customer.subscription.updated"
  ) {
    return;
  }

  const subscription = event.data.object as Stripe.Subscription;

  if (event.type === "customer.subscription.deleted" || REVOKED_STATUSES.has(subscription.status)) {
    await setAccessRevokedForSubscription(subscription.id, true);
  } else if (RESTORED_STATUSES.has(subscription.status)) {
    await setAccessRevokedForSubscription(subscription.id, false);
  }
}

function jsonResponse(status: number, ok: boolean): Response {
  return new Response(JSON.stringify({ ok }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Entry point for the /stripe/webhook server route's POST handler. Stripe
// signs every request with STRIPE_WEBHOOK_SECRET; we verify that signature
// against the raw request body before trusting anything in it, and only
// return 200 once the event has actually been handled (or intentionally
// ignored) -- any other status tells Stripe to retry the delivery.
export async function handleStripeWebhookRequest(request: Request): Promise<Response> {
  if (!isStripeWebhookConfigured()) {
    // Ack with 200 so Stripe doesn't flag this as a failing endpoint and
    // keep retrying -- there's just nothing wired up to do yet.
    return jsonResponse(200, false);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse(400, false);
  }

  try {
    const rawBody = await request.text();
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"] as string);
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env["STRIPE_WEBHOOK_SECRET"] as string,
    );

    await handleStripeEvent(stripe, event);

    return jsonResponse(200, true);
  } catch (error) {
    console.error("[stripe-webhook] failed to verify or process event", error);
    return jsonResponse(400, false);
  }
}
