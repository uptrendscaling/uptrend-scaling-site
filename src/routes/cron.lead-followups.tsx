import { createFileRoute } from "@tanstack/react-router";

import { runLeadFollowUpCron } from "../lib/leads.server";

// Hit on a schedule by Vercel Cron (see vercel.json). Not a page anyone is
// meant to visit -- Vercel signs the request with CRON_SECRET as a Bearer
// token, which runLeadFollowUpCron() checks before doing anything.
export const Route = createFileRoute("/cron/lead-followups")({
  loader: async () => runLeadFollowUpCron(),
  component: CronStatus,
});

function CronStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
