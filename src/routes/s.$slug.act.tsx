import { createFileRoute } from "@tanstack/react-router";

import { handleSiteAction } from "../lib/site-gen/sites.server";

// "Approve and launch" and "Request changes" on the private preview of a site.
// The preview link's secret token is the proof of who is asking.
export const Route = createFileRoute("/s/$slug/act")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown = null;
        try {
          body = await request.json();
        } catch {
          body = null;
        }
        const result = await handleSiteAction(params.slug, body);
        return new Response(JSON.stringify(result.json), {
          status: result.status,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
