import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { completeSquareConnection } from "../lib/crm/square.server";

const searchSchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

// Square redirects here after the business approves (or denies) access.
export const Route = createFileRoute("/connect/square/callback")({
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  loader: async ({ location }) => {
    const { code, state, error } = location.search as z.infer<
      typeof searchSchema
    >;

    if (error || !code || !state) {
      throw redirect({ to: "/app", search: { crmError: "square" } });
    }

    const result = await completeSquareConnection({ data: { code, state } });
    throw redirect({
      to: "/app",
      search: result.ok ? {} : { crmError: "square" },
    });
  },
  component: () => null,
});
