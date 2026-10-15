// The cancel buttons in the dashboard Settings.
//
// A client can cancel three ways:
//   - "reviews": just the Google review plan (website maintenance keeps going),
//   - "maintenance": just the website maintenance (the review plan keeps going),
//   - "both": everything.
//
// What happens when a client confirms:
//   1. Stripe is changed right away (no more charges, no proration or final
//      invoice). When the part being canceled is everything a subscription
//      carries, the whole subscription is canceled. When something else is on
//      it too (reviews + maintenance share one subscription), only that line
//      is removed and the rest keeps billing as before. During a free trial
//      nothing was charged, so nothing ever will be.
//   2. Our own database is updated straight away, so the page they land on
//      already shows the change. Stripe also sends a webhook a moment later
//      that makes the same change (harmlessly, it is the same switch; see
//      ./website-orders.server.ts).
//
// The logic is in a plain function that takes a businessId so it can be tested
// against a test database; the server function at the bottom only reads the
// session first.

import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { getSessionBusinessId, isAuthConfigured } from "./auth.server";
import { getDb, isDbConfigured } from "./db/client";
import { businesses } from "./db/schema";
import {
  DASHBOARD_CANCEL_COMMENT,
  sendPartialCancelAlert,
} from "./owner-alerts.server";
import {
  classifySubscriptionItems,
  type ClassifiedItem,
  type SubscriptionItemKind,
} from "./website-orders.server";

export type CancelPart = "reviews" | "maintenance" | "both";
export type CancelMembershipResult =
  { ok: true } | { ok: false; message: string };

const ASK_US =
  "Please email hello@uptrendscaling.com and we will cancel it for you right away.";

// Cancels a whole subscription in Stripe. Canceling twice is not an error for
// the client: if Stripe refuses because the subscription is already canceled
// (a double click, or a cancel made in Stripe a moment ago), that counts as done.
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

// Which kinds a cancel choice removes.
export function kindsToCancel(part: CancelPart): SubscriptionItemKind[] {
  if (part === "reviews") return ["reviews"];
  if (part === "maintenance") return ["maintenance"];
  return ["reviews", "maintenance"];
}

export type SubscriptionAction =
  | { type: "cancel_subscription" }
  | { type: "remove_items"; itemIds: string[] }
  | { type: "nothing" };

// Pure. For one subscription's items, says whether to cancel the whole thing,
// remove only some lines, or leave it alone.
export function actionForSubscription(
  items: ClassifiedItem[],
  part: CancelPart,
): SubscriptionAction {
  const targets = kindsToCancel(part);
  const doomed = items.filter((item) => targets.includes(item.kind));
  if (doomed.length === 0) return { type: "nothing" };
  // Stripe will not delete the last line of a subscription, and a subscription
  // with nothing left on it should not exist, so cancel it outright.
  if (doomed.length === items.length) return { type: "cancel_subscription" };
  return { type: "remove_items", itemIds: doomed.map((item) => item.id) };
}

export async function cancelPlanForBusiness(
  businessId: string,
  part: CancelPart,
): Promise<CancelMembershipResult> {
  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    return {
      ok: false,
      message: "We could not find your account. Please sign in again.",
    };
  }

  const wantsReviews = part === "reviews" || part === "both";
  const wantsMaintenance = part === "maintenance" || part === "both";
  const reviewsDone = business.accessRevoked || !business.plan;
  const maintenanceDone = !business.maintenanceActive;
  // Everything asked for is already ended (for example canceled a moment ago).
  if (
    (!wantsReviews || reviewsDone) &&
    (!wantsMaintenance || maintenanceDone)
  ) {
    return { ok: true };
  }

  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const subscriptionIds = [
    ...new Set(
      [business.stripeSubscriptionId, business.websiteSubscriptionId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  if (subscriptionIds.length === 0 || !secretKey) {
    return {
      ok: false,
      message: `We could not find an active subscription on your account. ${ASK_US}`,
    };
  }

  let removedLinesOnly = false;
  try {
    const { default: StripeSdk } = await import("stripe");
    const stripe = new StripeSdk(secretKey);
    for (const subscriptionId of subscriptionIds) {
      const { status, items } = await classifySubscriptionItems(
        stripe,
        subscriptionId,
      );
      if (status === "canceled") continue;
      const action = actionForSubscription(items, part);
      if (action.type === "cancel_subscription") {
        await cancelSubscriptionInStripe(stripe, subscriptionId);
      } else if (action.type === "remove_items") {
        for (const itemId of action.itemIds) {
          await stripe.subscriptionItems.del(itemId, {
            proration_behavior: "none",
          });
        }
        removedLinesOnly = true;
      }
    }
  } catch (error) {
    console.error("[membership] could not cancel with Stripe", error);
    return {
      ok: false,
      message: `Something went wrong canceling, and nothing was changed. ${ASK_US}`,
    };
  }

  // Stripe is changed for good at this point. If this write fails the webhook
  // makes the same change a moment later, so the client still sees it as
  // canceled; do not tell them it failed.
  const now = new Date();
  try {
    await db
      .update(businesses)
      .set({
        ...(wantsReviews && business.plan
          ? { accessRevoked: true, reviewsCanceledAt: now }
          : {}),
        ...(wantsMaintenance
          ? { maintenanceActive: false, maintenanceCanceledAt: now }
          : {}),
      })
      .where(eq(businesses.id, businessId));
  } catch (error) {
    console.error(
      "[membership] canceled in Stripe but could not update the account yet",
      error,
    );
  }

  // Canceling a whole subscription already emails you (the webhook's
  // "membership canceled" alert). Removing only one line leaves the
  // subscription alive, so no such event fires: send the heads-up here.
  if (removedLinesOnly) {
    await sendPartialCancelAlert({
      businessName: business.businessName,
      contactName: business.contactName,
      email: business.email,
      phone: business.phone,
      part,
    });
  }

  return { ok: true };
}

// Kept for older callers: cancels everything.
export async function cancelMembershipForBusiness(
  businessId: string,
): Promise<CancelMembershipResult> {
  return cancelPlanForBusiness(businessId, "both");
}

export const cancelMembership = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ part: z.enum(["reviews", "maintenance", "both"]).optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<CancelMembershipResult> => {
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
    return cancelPlanForBusiness(businessId, data.part ?? "both");
  });
