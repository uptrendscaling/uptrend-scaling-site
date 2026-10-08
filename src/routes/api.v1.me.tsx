import { createFileRoute } from "@tanstack/react-router";

import { handleApiMeRequest } from "../lib/crm/zapier.server";

// Called by our Zapier app (and any other tool using a business's API key)
// to check the key works. Raw server route so callers get real HTTP statuses.
export const Route = createFileRoute("/api/v1/me")({
  server: {
    handlers: {
      GET: async ({ request }) => handleApiMeRequest(request),
    },
  },
});
