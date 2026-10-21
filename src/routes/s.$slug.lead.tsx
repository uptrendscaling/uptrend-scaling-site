import { createFileRoute } from "@tanstack/react-router";

import { handleLead } from "../lib/site-gen/sites.server";

// The quote form on a customer's finished website posts here.
export const Route = createFileRoute("/s/$slug/lead")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown = null;
        try {
          body = await request.json();
        } catch {
          body = null;
        }
        const result = await handleLead({ slug: params.slug }, body);
        return new Response(JSON.stringify(result.json), {
          status: result.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
