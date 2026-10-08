import { createFileRoute } from "@tanstack/react-router";

import { handleQuickBooksCallbackRequest } from "../lib/crm/quickbooks.server";

// Intuit redirects here after the business approves (or denies) access.
// A server route reading the raw request, not a page route: the page router
// would turn the long numeric realmId into a rounded number (see
// handleQuickBooksCallbackRequest).
export const Route = createFileRoute("/connect/quickbooks/callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleQuickBooksCallbackRequest(request),
    },
  },
});
