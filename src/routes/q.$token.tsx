import { createFileRoute } from "@tanstack/react-router";

import { handleQrScanRequest } from "../lib/qr.server";

// The address printed on every QR code. A customer scans, this records the
// scan and bounces them straight to the business's Google review page.
//
// Unlike /r/$token (a page route that throws redirect() from a loader), this
// is a server route that returns a raw Response, the same pattern as
// /stripe/webhook. The reason: a page route's redirect always goes out as a
// 307 with whatever caching the framework picks, but here we need an exact
// 302 plus "Cache-Control: no-store" so that every single scan reaches the
// server and gets counted. HEAD gets the same answer (without being counted)
// so link checkers see the real destination.
// handleQrScanRequest() never throws and only ever redirects to the stored
// review link (or the home page), so this cannot be used as an open redirect.
export const Route = createFileRoute("/q/$token")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleQrScanRequest(request, params.token),
      HEAD: ({ request, params }) => handleQrScanRequest(request, params.token),
    },
  },
});
