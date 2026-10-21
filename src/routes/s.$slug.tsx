import { createFileRoute } from "@tanstack/react-router";

import { serveSite } from "../lib/site-gen/sites.server";

// A customer's finished website at its free address (/s/<slug>). Live sites are
// public. Unapproved ones only open with the private preview link (?p=...).
export const Route = createFileRoute("/s/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        return serveSite({
          slug: params.slug,
          previewToken: url.searchParams.get("p"),
        });
      },
    },
  },
});
