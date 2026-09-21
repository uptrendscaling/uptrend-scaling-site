import { createFileRoute } from "@tanstack/react-router";

import { handleStripeWebhook } from "../lib/stripe-webhook.server";

// Hit directly by Stripe (see the endpoint configured in the Stripe
// Dashboard), never by a person -- same "loader is the actual endpoint"
// pattern this codebase already uses for /cron/reminders.
// handleStripeWebhook() verifies Stripe's signature before touching
// anything.
export const Route = createFileRoute("/stripe/webhook")({
  loader: async () => handleStripeWebhook(),
  component: WebhookStatus,
});

function WebhookStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
