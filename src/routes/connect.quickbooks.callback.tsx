import { createFileRoute, redirect } from "@tanstack/react-router";

import { completeQuickBooksConnection } from "../lib/crm/quickbooks.server";

// Read straight from the raw query string, never from the router's parsed
// search: the router turns number-looking values into numbers, and Intuit's
// realmId (e.g. 9341458448689811) is longer than a JavaScript number can hold
// exactly, so it would come out with the wrong digits.
function rawParam(searchStr: string, name: string): string | undefined {
  const value = new URLSearchParams(searchStr).get(name)?.trim();
  return value ? value : undefined;
}

// Intuit redirects here after the business approves (or denies) access, with
// ?code=...&state=...&realmId=... (or ?error=access_denied).
export const Route = createFileRoute("/connect/quickbooks/callback")({
  // Nothing from the parsed search is used (see rawParam).
  validateSearch: () => ({}),
  loader: async ({ location }) => {
    const searchStr = location.searchStr;
    const code = rawParam(searchStr, "code");
    const state = rawParam(searchStr, "state");
    const realmId = rawParam(searchStr, "realmId");

    if (rawParam(searchStr, "error") || !code || !state || !realmId) {
      throw redirect({ to: "/app", search: { crmError: "quickbooks" } });
    }

    const result = await completeQuickBooksConnection({
      data: { code, state, realmId },
    });
    throw redirect({
      to: "/app",
      search: result.ok ? { tab: "settings" } : { crmError: "quickbooks" },
    });
  },
  component: () => null,
});
