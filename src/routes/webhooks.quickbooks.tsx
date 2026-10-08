import { createFileRoute } from "@tanstack/react-router";

import { handleQuickBooksWebhookRequest } from "../lib/crm/quickbooks.server";

// Hit directly by Intuit, never by a person. Real server route (raw POST
// handler returning a Response), not the page-route loader pattern, because
// Intuit needs the actual HTTP status to know whether to retry a delivery.
export const Route = createFileRoute("/webhooks/quickbooks")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuickBooksWebhookRequest(request),
    },
  },
});
