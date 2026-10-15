import { createFileRoute } from "@tanstack/react-router";

import { runTrybeSyncCron } from "../lib/trybe-sync.server";

// Hit a few times a day by Vercel Cron (see vercel.json). Not a page anyone
// is meant to visit. Vercel signs the request with CRON_SECRET as a Bearer
// token, which runTrybeSyncCron() checks before doing anything.
export const Route = createFileRoute("/cron/trybe-sync")({
  loader: async () => runTrybeSyncCron(),
  component: CronStatus,
});

function CronStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
