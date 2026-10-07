import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { completeGoogleConnection } from "../lib/google.server";

const searchSchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

// Google redirects here after the owner approves (or declines) access. On
// success the owner lands on the settings tab, where the dashboard either shows
// the connected location or asks them to pick one. On any failure they return
// to /app with crmError=google, exactly like the Square callback.
export const Route = createFileRoute("/connect/google/callback")({
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  loader: async ({ location }) => {
    const { code, state, error } = location.search as z.infer<
      typeof searchSchema
    >;

    // "access_denied" arrives as ?error= when the owner presses Cancel.
    if (error || !code || !state) {
      throw redirect({ href: "/app?crmError=google" });
    }

    // Whatever goes wrong, the owner lands back on the dashboard with the
    // error flag instead of on an error page.
    let destination = "/app?crmError=google";
    try {
      const result = await completeGoogleConnection({ data: { code, state } });
      destination = result.redirectTo;
    } catch (failure) {
      console.error("[google] callback failed", failure);
    }
    throw redirect({ href: destination });
  },
  component: () => null,
});
