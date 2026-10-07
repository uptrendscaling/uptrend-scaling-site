import { createFileRoute } from "@tanstack/react-router";

import { runWeeklySummaryCron } from "../lib/weekly-summary.server";

// Hit once a week by Vercel Cron (see vercel.json, Mondays at 14:00 UTC, about
// 7 AM in Arizona). Not a page anyone is meant to visit. Vercel signs the
// request with CRON_SECRET as a Bearer token, which runWeeklySummaryCron()
// checks before doing anything. Opening it by hand later in the week is safe:
// a business that got its summary in the last 5 days is skipped.
export const Route = createFileRoute("/cron/weekly-summary")({
  loader: async () => runWeeklySummaryCron(),
  component: CronStatus,
});

function CronStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
