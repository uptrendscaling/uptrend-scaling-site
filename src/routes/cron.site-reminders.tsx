import { createFileRoute } from "@tanstack/react-router";

import { runSiteReminders } from "../lib/site-gen/sites.server";

// Hit once a day by Vercel Cron (see vercel.json). Vercel signs the request
// with CRON_SECRET, which runSiteReminders() checks before doing anything.
export const Route = createFileRoute("/cron/site-reminders")({
  loader: async () => runSiteReminders(),
  component: CronStatus,
});

function CronStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
