import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { getCheckoutSession, type SessionSummary } from "../lib/checkout.server";
import { claimBusinessAccount } from "../lib/reviews.server";

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
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    getCheckoutSession({ data: { sessionId } })
      .then(setSummary)
      .catch(() => setSummary({ ok: false, reason: "not_found" }));
  }, [sessionId]);

  const email = summary && summary.ok ? summary.email : null;

  async function handleClaim(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!sessionId) {
      setError("Missing checkout session. Refresh this page from your confirmation email.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await claimBusinessAccount({ data: { sessionId, password } });
      if (result.ok) {
        setClaimed(true);
        void navigate({ to: "/app" });
        return;
      }
      setError(result.message);
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

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
            Thanks{email ? `, we'll be emailing ${email}` : ""}. Let's set up your dashboard.
          </h1>
          <p className="start-lead">
            Create a password to get into your CRM, where you'll add customers and watch review
            requests go out automatically.
          </p>

          <form className="start-form" style={{ textAlign: "left" }} onSubmit={handleClaim}>
            <label>
              <span>Create a password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            {error && <p className="form-alert form-alert-error">{error}</p>}
            {claimed && <p className="form-alert form-alert-notice">You're in — redirecting…</p>}

            <button
              className="button button-primary start-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Setting up…" : "Create my dashboard"}
              <ArrowIcon />
            </button>
          </form>

          <a className="button button-ghost" href="/" style={{ marginTop: 18 }}>
            I'll do this later
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
