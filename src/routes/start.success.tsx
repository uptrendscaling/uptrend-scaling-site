import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { getCheckoutSession, type SessionSummary } from "../lib/checkout.server";

const searchSchema = z.object({
  session_id: z.string().trim().optional(),
});

export const Route = createFileRoute("/start/success")({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  head: () => ({
    meta: [{ title: "You're in | UpTrend Scaling" }],
  }),
  component: SuccessPage,
});

function SuccessPage() {
  const { session_id: sessionId } = Route.useSearch();
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    getCheckoutSession({ data: { sessionId } })
      .then(setSummary)
      .catch(() => setSummary({ ok: false, reason: "not_found" }));
  }, [sessionId]);

  const email = summary && summary.ok ? summary.email : null;

  return (
    <div className="site-shell start-shell">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="/" aria-label="UpTrend Scaling home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28">
                <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
              </svg>
            </span>
            <span>
              UpTrend <em>Scaling</em>
            </span>
          </a>
        </div>
      </header>

      <main className="start-main success-main">
        <div className="page-width success-inner">
          <p className="eyebrow">
            <span /> You're in
          </p>
          <h1 className="start-heading">
            Thanks{email ? `, we'll be emailing ${email}` : ""}. Your account is on its way.
          </h1>
          <p className="start-lead">
            We're activating things on our end now, usually within one business day. Keep an eye on
            your inbox for a receipt and a note from our team with next steps.
          </p>
          <a className="button button-primary" href="/">
            Back to home
            <ArrowIcon />
          </a>
        </div>
      </main>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h12m-5-5 5 5-5 5" />
    </svg>
  );
}
