import { createFileRoute } from "@tanstack/react-router";

import { runReminderCron } from "../lib/reviews.server";

// Hit twice a day by Vercel Cron (see vercel.json): about 10am and 3pm
// Arizona time. Each run first sends texts held for quiet hours, then the
// day's 48-hour reminders. Not a page anyone is
// meant to visit -- Vercel signs the request with CRON_SECRET as a Bearer
// token, which runReminderCron() checks before doing anything.
export const Route = createFileRoute("/cron/reminders")({
  loader: async () => runReminderCron(),
  component: CronStatus,
});

function CronStatus() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data)}</pre>;
}
