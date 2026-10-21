import { createFileRoute } from "@tanstack/react-router";

import { serveAsset } from "../lib/site-gen/sites.server";

// A logo or photo a customer uploaded for their website.
export const Route = createFileRoute("/site-assets/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => serveAsset(params.id),
    },
  },
});
