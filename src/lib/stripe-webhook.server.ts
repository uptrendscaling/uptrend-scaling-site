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

// Trial signups reach Stripe Checkout with the $20 setup fee left out of
// line_items entirely (see ../lib/checkout.server.ts) -- Checkout charges
// one-time line items immediately, even on a trialing subscription, so
// including it there would defeat "nothing charged for 7 days." Instead,
// once the subscription actually exists and is trialing, we queue the fee as
// a pending invoice item tied to that customer + subscription. Stripe
// automatically folds pending items into a subscription's next invoice, and
// for a fresh trialing subscription that's the invoice generated at trial
// end -- so the $20 lands on the same invoice as the first month's charge,
// exactly once, with nothing due today.
async function handleSubscriptionCreated(stripe: Stripe, subscription: Stripe.Subscription): Promise<void> {
  if (subscription.status !== "trialing") return;
  if (subscription.metadata?.["plan"] !== "trial") return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  await stripe.invoiceItems.create({
    customer: customerId,
    subscription: subscription.id,
    currency: "usd",
    amount: SETUP_FEE_CENTS,
    description: "One-time account setup fee",
  });
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
