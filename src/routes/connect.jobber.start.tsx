import { createFileRoute, redirect } from "@tanstack/react-router";

import { getJobberAuthorizeUrl } from "../lib/crm/jobber.server";

// Business clicks "Connect" on /app -> lands here -> bounced straight to
// Jobber's own login/consent page. Never rendered.
export const Route = createFileRoute("/connect/jobber/start")({
  loader: async () => {
    const result = await getJobberAuthorizeUrl();
    if (!result.ok) {
      throw redirect({ to: "/app", search: { crmError: "jobber" } });
    }
    throw redirect({ href: result.url });
  },
  component: () => null,
});
