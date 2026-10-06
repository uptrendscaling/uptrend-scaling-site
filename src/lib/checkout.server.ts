import { createServerFn } from "@tanstack/react-start";
import type Stripe from "stripe";
import { z } from "zod";

import { MONTHLY_PRICE_CENTS, SETUP_FEE_CENTS, TRIAL_DAYS } from "./pricing";
import { resolveOrigin } from "./site";

const checkoutInputSchema = z.object({
  plan: z.enum(["trial", "membership"]),
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  contactName: z.string().trim().min(1, "Your name is required").max(200),
  email: z.string().trim().email("Enter a valid email"),
  phone: z.string().trim().min(7, "Enter a valid phone number").max(30),
  locations: z.coerce.number().int().min(1).max(50),
  origin: z.string().trim().optional(),
});

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_configured" | "stripe_error"; message: string };

// Builds the exact pricing model UpTrend Scaling has settled on ($70/mo per
// location + a one-time $20 setup fee, billed together with the first
// recurring invoice) without requiring any Products/Prices to be
// pre-configured in the Stripe dashboard — everything is defined inline via
// price_data. The moment STRIPE_SECRET_KEY is set in the deploy environment,
// this goes live with no further code changes.
//
// When the $20 setup fee is charged:
// - plan "membership" (subscribe today, no trial): the fee is a one-time line
//   item in Checkout, so the customer pays the $20 setup fee plus the first
//   $70 month today. Nothing else ever adds a setup fee for this plan.
// - plan "trial": Checkout charges one-time line items immediately, even when
//   the subscription has a trial (trial_period_days only defers the recurring
//   items). So for trial signups the fee is left out of line_items entirely and
//   nothing is due today, matching the "nothing charged for 7 days" copy on
//   /start. The fee is added later, exactly once, as a pending invoice item by
//   handleSubscriptionCreated in stripe-webhook.server.ts, which Stripe rolls
//   into the invoice generated when the trial ends, next to the first month.
export const createCheckoutSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => checkoutInputSchema.parse(input))
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const secretKey = process.env["STRIPE_SECRET_KEY"];
    if (!secretKey) {
      return {
        ok: false,
        reason: "not_configured",
        message:
          "Online sign-up switches on the moment our payment processor is connected — almost there.",
      };
    }

    const baseUrl = resolveOrigin(data.origin);

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(secretKey);

      const subscriptionMetadata = {
        businessName: data.businessName,
        contactName: data.contactName,
        phone: data.phone,
        locations: String(data.locations),
        plan: data.plan,
      };

      const setupFeeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
        data.plan === "trial"
          ? []
          : [
              {
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: "One-time account setup fee",
                    description: "Charged once today, not part of the monthly plan",
                  },
                  unit_amount: SETUP_FEE_CENTS,
                },
                quantity: 1,
              },
            ];

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: data.email,
        allow_promotion_codes: true,
        // Always collect a card, even when nothing is due today (the free
        // trial). Stripe's default already does this for subscriptions with a
        // trial, but pinning it keeps "card required to start" true if that
        // default ever changes, or if a coupon brought the due-today amount to $0.
        payment_method_collection: "always",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "UpTrend Scaling monthly plan",
                description: "Google review automation, billed per location",
              },
              unit_amount: MONTHLY_PRICE_CENTS,
              recurring: { interval: "month" },
            },
            quantity: data.locations,
          },
          // Only the no-trial plan pays the setup fee at checkout. Trial signups
          // get it later from the webhook (see the comment above
          // createCheckoutSession), so it must NOT be in this list for them.
          ...setupFeeLineItems,
        ],
        subscription_data:
          data.plan === "trial"
            ? { trial_period_days: TRIAL_DAYS, metadata: subscriptionMetadata }
            : { metadata: subscriptionMetadata },
        metadata: {
          businessName: data.businessName,
          contactName: data.contactName,
          phone: data.phone,
          locations: String(data.locations),
          plan: data.plan,
        },
        success_url: `${baseUrl}/start/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/start?plan=${data.plan}`,
      });

      if (!session.url) {
        return {
          ok: false,
          reason: "stripe_error",
          message: "Could not open checkout. Please try again.",
        };
      }

      return { ok: true, url: session.url };
    } catch (error) {
      console.error("[checkout] failed to create Stripe checkout session", error);
      return {
        ok: false,
        reason: "stripe_error",
        message: "Something went wrong starting checkout. Please try again or email us.",
      };
    }
  });

const sessionSummaryInputSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export type SessionSummary =
  | {
      ok: true;
      email: string | null;
      plan: string | null;
      locations: string | null;
      status: string | null;
    }
  | { ok: false; reason: "not_configured" | "not_found" };

export const getCheckoutSession = createServerFn({ method: "GET" })
  .validator((input: unknown) => sessionSummaryInputSchema.parse(input))
  .handler(async ({ data }): Promise<SessionSummary> => {
    const secretKey = process.env["STRIPE_SECRET_KEY"];
    if (!secretKey) {
      return { ok: false, reason: "not_configured" };
    }

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);
      const metadata = session.metadata;

      return {
        ok: true,
        email: session.customer_details?.email ?? session.customer_email ?? null,
        plan: typeof metadata?.["plan"] === "string" ? metadata["plan"] : null,
        locations: typeof metadata?.["locations"] === "string" ? metadata["locations"] : null,
        status: session.status ?? null,
      };
    } catch (error) {
      console.error("[checkout] failed to retrieve Stripe checkout session", error);
      return { ok: false, reason: "not_found" };
    }
  });
