import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { requestPasswordReset } from "../lib/reviews.server";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [{ title: "Reset your password | UpTrend Scaling" }],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestPasswordReset({ data: { email } });
      if (result.ok) {
        setSent(true);
      } else {
        setError(result.message);
      }
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
          <a className="button button-ghost nav-cta" href="/login">
            Back to sign in
          </a>
        </div>
      </header>

      <main className="start-main success-main">
        <div className="page-width" style={{ maxWidth: 440, marginInline: "auto" }}>
          <p className="eyebrow">
            <span /> Reset password
          </p>
          <h1 className="start-heading">Forgot your password?</h1>
          <p className="start-lead" style={{ marginBottom: 28 }}>
            Enter your work email and, if it matches an account, we'll send a link to reset it.
          </p>

          {sent ? (
            <p className="form-alert form-alert-notice">
              If that email matches an account, a reset link is on its way. Check your inbox.
            </p>
          ) : (
            <form className="start-form" onSubmit={handleSubmit}>
              <label>
                <span>Work email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              {error && <p className="form-alert form-alert-error">{error}</p>}

              <button
                className="button button-primary start-submit"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
