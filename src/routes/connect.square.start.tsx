import { createFileRoute, redirect } from "@tanstack/react-router";

import { getSquareAuthorizeUrl } from "../lib/crm/square.server";

// Business clicks "Connect" on /app -> lands here -> bounced straight to
// Square's own login/consent page. Never rendered.
export const Route = createFileRoute("/connect/square/start")({
  loader: async () => {
    const result = await getSquareAuthorizeUrl();
    if (!result.ok) {
      throw redirect({ to: "/app", search: { crmError: "square" } });
    }
    throw redirect({ href: result.url });
  },
  component: () => null,
});
