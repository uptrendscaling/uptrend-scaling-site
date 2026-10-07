import { createFileRoute } from "@tanstack/react-router";

import { handleStripeWebhookRequest } from "../lib/stripe-webhook.server";

// Hit directly by Stripe (see the endpoint configured in the Stripe
// Dashboard), never by a person. This is a real server route -- a POST
// handler that returns a raw Response -- rather than the page-route
// loader pattern this codebase uses for /cron/reminders, because Stripe
// needs the actual HTTP status code to know whether a delivery succeeded
// and should be retried on failure, and that status doesn't reliably reach
// the client from a page route's loader.
// handleStripeWebhookRequest() verifies Stripe's signature before touching
// anything.
//
// The endpoint in the Stripe Dashboard must be subscribed to these events
// (anything else is acknowledged and ignored):
//   customer.subscription.created / .updated / .deleted  (setup fee, access)
//   checkout.session.completed                          (owner alert: new signup)
//   invoice.paid                                        (owner alert: trial client paid)
// Sending the owner alerts only needs Resend to be configured; with it unset
// they are skipped silently.
export const Route = createFileRoute("/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleStripeWebhookRequest(request),
    },
  },
});
