import { createServerFn } from "@tanstack/react-start";
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
// Trial signups: Stripe Checkout charges one-time line items immediately at
// checkout, even when the subscription itself has a trial -- trial_period_days
// only defers *recurring* line items. So for plan === "trial" the $20 setup
// fee is left out of line_items entirely (nothing is due today, matching the
// "Nothing charged for 7 days" copy on /start), and is instead added as a
// pending invoice item once the subscription exists (see
// handleSubscriptionCreated in stripe-webhook.server.ts), which Stripe
// automatically rolls into that subscription's first invoice -- generated
// when the trial ends -- alongside the first month's charge.
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

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: data.email,
        allow_promotion_codes: true,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "UpTrend Scaling — monthly plan",
                description: "Google review automation, billed per location",
              },
              unit_amount: MONTHLY_PRICE_CENTS,
              recurring: { interval: "month" },
            },
            quantity: data.locations,
          },
          // Trial signups don't pay the setup fee at checkout -- see the
          // comment above createCheckoutSession. Non-trial ("membership")
          // signups have no trial to defer to, so the fee is charged now,
          // same as before.
          ...(data.plan === "trial"
            ? []
            : [
                {
                  price_data: {
                    currency: "usd" as const,
                    product_data: { name: "One-time account setup fee" },
                    unit_amount: SETUP_FEE_CENTS,
                  },
                  quantity: 1,
                },
              ]),
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
