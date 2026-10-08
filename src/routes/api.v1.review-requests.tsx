import { createFileRoute } from "@tanstack/react-router";

import { handleApiReviewRequest } from "../lib/crm/zapier.server";

// "Send Review Request": called by our Zapier app (or any tool holding a
// business's API key) to create the customer and send their review request.
// Raw server route so callers get real HTTP statuses.
export const Route = createFileRoute("/api/v1/review-requests")({
  server: {
    handlers: {
      POST: async ({ request }) => handleApiReviewRequest(request),
    },
  },
});
