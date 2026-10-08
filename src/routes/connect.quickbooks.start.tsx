import { createFileRoute, redirect } from "@tanstack/react-router";

import { getQuickBooksAuthorizeUrl } from "../lib/crm/quickbooks.server";

// Business clicks "Connect" (or "Reconnect") -> lands here -> bounced straight
// to Intuit's own sign-in and consent page. Never rendered. This is also the
// Connect/Reconnect URL registered in the Intuit developer portal.
export const Route = createFileRoute("/connect/quickbooks/start")({
  loader: async () => {
    const result = await getQuickBooksAuthorizeUrl();
    if (!result.ok) {
      throw redirect({ to: "/app", search: { crmError: "quickbooks" } });
    }
    throw redirect({ href: result.url });
  },
  component: () => null,
});
