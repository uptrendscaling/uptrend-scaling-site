// Automatically revokes a business's CRM dashboard access when their Stripe
// subscription actually ends (status becomes "canceled" or "unpaid"), and
// restores it if the subscription becomes active again. Dormant-safe like
// the rest of the integrations: with STRIPE_WEBHOOK_SECRET unset, every
// request is rejected before touching the database.

import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestHeader, setResponseStatus } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { getDb, isDbConfigured } from "./db/client";
import { businesses } from "./db/schema";

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

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
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

// Entry point for the /stripe/webhook route's loader (see that route for why
// a loader, not a separate API route -- same pattern this codebase already
// uses for /cron/reminders). Stripe signs every request with
// STRIPE_WEBHOOK_SECRET; we verify that signature against the raw request
// body before trusting anything in it.
export const handleStripeWebhook = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean }> => {
    if (!isStripeWebhookConfigured()) {
      // Ack with 200 so Stripe doesn't flag this as a failing endpoint and
      // keep retrying -- there's just nothing wired up to do yet.
      setResponseStatus(200);
      return { ok: false };
    }

    const signature = getRequestHeader("stripe-signature");
    if (!signature) {
      setResponseStatus(400);
      return { ok: false };
    }

    try {
      const rawBody = await getRequest().text();
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"] as string);
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env["STRIPE_WEBHOOK_SECRET"] as string,
      );

      await handleStripeEvent(event);

      setResponseStatus(200);
      return { ok: true };
    } catch (error) {
      console.error("[stripe-webhook] failed to verify or process event", error);
      setResponseStatus(400);
      return { ok: false };
    }
  },
);
