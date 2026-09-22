import { createFileRoute } from "@tanstack/react-router";

import { handleJobberWebhookRequest } from "../lib/crm/jobber.server";

// Hit directly by Jobber, never by a person. Real server route (raw POST
// handler returning a Response), not the page-route loader pattern, for the
// same reason as /stripe/webhook: Jobber needs the actual HTTP status to
// know whether to retry a delivery.
export const Route = createFileRoute("/webhooks/jobber")({
  server: {
    handlers: {
      POST: async ({ request }) => handleJobberWebhookRequest(request),
    },
  },
});
