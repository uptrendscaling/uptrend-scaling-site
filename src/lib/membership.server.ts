// The Cancel membership button in the dashboard Settings.
//
// What happens when a client confirms:
//   1. The subscription is canceled in Stripe right away (no more charges, no
//      proration or final invoice). During a free trial nothing was charged, so
//      nothing ever will be.
//   2. Their dashboard access is turned off in our own database straight away,
//      so the page they land on already says their subscription has ended.
//      Stripe also sends customer.subscription.deleted to the webhook a moment
//      later, which does the same thing (harmlessly, it is the same switch) and
//      emails the owner (see ./owner-alerts.server.ts).
//
// The logic is in a plain function that takes a businessId so it can be tested
// against a test database; the server function at the bottom only reads the
// session first.

import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { getSessionBusinessId, isAuthConfigured } from "./auth.server";
import { getDb, isDbConfigured } from "./db/client";
import { businesses } from "./db/schema";
import { DASHBOARD_CANCEL_COMMENT } from "./owner-alerts.server";

export type CancelMembershipResult =
  { ok: true } | { ok: false; message: string };

const ASK_US =
  "Please email hello@uptrendscaling.com and we will cancel it for you right away.";

// Cancels the subscription in Stripe. Canceling twice is not an error for the
// client: if Stripe refuses because the subscription is already canceled (a
// double click, or a cancel made in Stripe a moment ago), that counts as done.
async function cancelSubscriptionInStripe(
  stripe: Stripe,
  subscriptionId: string,
): Promise<void> {
  try {
    await stripe.subscriptions.cancel(subscriptionId, {
      cancellation_details: { comment: DASHBOARD_CANCEL_COMMENT },
      invoice_now: false,
      prorate: false,
    });
  } catch (cancelError) {
    let alreadyCanceled = false;
    try {
      const current = await stripe.subscriptions.retrieve(subscriptionId);
      alreadyCanceled = current.status === "canceled";
    } catch {
      // Could not check either; report the original problem below.
    }
    if (!alreadyCanceled) throw cancelError;
  }
}

export async function cancelMembershipForBusiness(
  businessId: string,
): Promise<CancelMembershipResult> {
  const db = getDb();
  const [business] = await db
    .select({
      accessRevoked: businesses.accessRevoked,
      stripeSubscriptionId: businesses.stripeSubscriptionId,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    return {
      ok: false,
      message: "We could not find your account. Please sign in again.",
    };
  }
  // Already ended (for example canceled a moment ago): nothing left to do.
  if (business.accessRevoked) return { ok: true };

  const secretKey = process.env["STRIPE_SECRET_KEY"];
  if (!business.stripeSubscriptionId || !secretKey) {
    return {
      ok: false,
      message: `We could not find an active subscription on your account. ${ASK_US}`,
    };
  }

  try {
    const { default: StripeSdk } = await import("stripe");
    await cancelSubscriptionInStripe(
      new StripeSdk(secretKey),
      business.stripeSubscriptionId,
    );
  } catch (error) {
    console.error("[membership] could not cancel the subscription", error);
    return {
      ok: false,
      message: `Something went wrong canceling your membership, and nothing was changed. ${ASK_US}`,
    };
  }

  // The subscription is canceled for good at this point. If this write fails
  // the webhook turns access off a moment later, so the client still sees it as
  // canceled; do not tell them it failed.
  try {
    await db
      .update(businesses)
      .set({ accessRevoked: true })
      .where(eq(businesses.id, businessId));
  } catch (error) {
    console.error(
      "[membership] canceled in Stripe but could not lock access yet",
      error,
    );
  }

  return { ok: true };
}

export const cancelMembership = createServerFn({ method: "POST" }).handler(
  async (): Promise<CancelMembershipResult> => {
    if (!isDbConfigured() || !isAuthConfigured()) {
      return {
        ok: false,
        message: `Canceling online is not available right now. ${ASK_US}`,
      };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) {
      return { ok: false, message: "Please sign in again to cancel." };
    }
    return cancelMembershipForBusiness(businessId);
  },
);
