import { createFileRoute } from "@tanstack/react-router";

import { handleSquareWebhookRequest } from "../lib/crm/square.server";

// Hit directly by Square, never by a person. Real server route (raw POST
// handler returning a Response), not the page-route loader pattern, for the
// same reason as /stripe/webhook: Square needs the actual HTTP status to
// know whether to retry a delivery.
export const Route = createFileRoute("/webhooks/square")({
  server: {
    handlers: {
      POST: async ({ request }) => handleSquareWebhookRequest(request),
    },
  },
});
