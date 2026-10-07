import { createFileRoute, redirect } from "@tanstack/react-router";

import { getGoogleAuthorizeUrl } from "../lib/google.server";

// Business clicks "Connect Google" on /app -> lands here -> bounced straight
// to Google's own consent page. Never rendered. If Google is not switched on
// yet (no OAuth client configured) or nobody is signed in, the owner goes back
// to the dashboard with the same error flag the other connections use. A plain
// href keeps this independent of how /app types its search params.
export const Route = createFileRoute("/connect/google/start")({
  loader: async () => {
    const result = await getGoogleAuthorizeUrl();
    if (!result.ok) {
      throw redirect({ href: "/app?crmError=google" });
    }
    throw redirect({ href: result.url });
  },
  component: () => null,
});
