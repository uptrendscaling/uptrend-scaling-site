import { createFileRoute } from "@tanstack/react-router";

import { runGoogleSyncCron } from "../lib/google.server";

// Hit once a day by Vercel Cron (see vercel.json). Not a page anyone is meant
// to visit. Vercel signs the request with CRON_SECRET as a Bearer token, which
// runGoogleSyncCron() checks before doing anything.
export const Route = createFileRoute("/cron/google-sync")({
  loader: async () => runGoogleSyncCron(),
  component: CronStatus,
});

function CronStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
