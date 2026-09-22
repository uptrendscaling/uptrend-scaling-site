import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { completeJobberConnection } from "../lib/crm/jobber.server";

const searchSchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

// Jobber redirects here after the business approves (or denies) access.
export const Route = createFileRoute("/connect/jobber/callback")({
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  loader: async ({ location }) => {
    const { code, state, error } = location.search as z.infer<
      typeof searchSchema
    >;

    if (error || !code || !state) {
      throw redirect({ to: "/app", search: { crmError: "jobber" } });
    }

    const result = await completeJobberConnection({ data: { code, state } });
    throw redirect({
      to: "/app",
      search: result.ok ? {} : { crmError: "jobber" },
    });
  },
  component: () => null,
});
