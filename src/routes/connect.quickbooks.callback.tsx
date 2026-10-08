import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { completeQuickBooksConnection } from "../lib/crm/quickbooks.server";

const searchSchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  // The QuickBooks company id, sent alongside the code.
  realmId: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

// Intuit redirects here after the business approves (or denies) access.
export const Route = createFileRoute("/connect/quickbooks/callback")({
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  loader: async ({ location }) => {
    const { code, state, realmId, error } = location.search as z.infer<
      typeof searchSchema
    >;

    if (error || !code || !state || !realmId) {
      throw redirect({ to: "/app", search: { crmError: "quickbooks" } });
    }

    const result = await completeQuickBooksConnection({
      data: { code, state, realmId },
    });
    throw redirect({
      to: "/app",
      search: result.ok
        ? { tab: "settings" }
        : { crmError: "quickbooks" },
    });
  },
  component: () => null,
});
