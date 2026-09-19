import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { resetPassword } from "../lib/reviews.server";

const searchSchema = z.object({
  token: z.string().trim().optional(),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  head: () => ({
    meta: [{ title: "Set a new password | UpTrend Scaling" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token. Request a new one from the sign-in page.");
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
      const result = await resetPassword({ data: { token, password } });
      if (result.ok) {
        setDone(true);
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
          <h1 className="start-heading">Choose a new password.</h1>
          <p className="start-lead" style={{ marginBottom: 28 }}>
            Pick something you haven't used before.
          </p>

          {!token && (
            <p className="form-alert form-alert-error" style={{ marginBottom: 16 }}>
              This link is missing its token. Request a new one from the{" "}
              <a href="/forgot-password">forgot password page</a>.
            </p>
          )}

          <form className="start-form" onSubmit={handleSubmit}>
            <label>
              <span>New password</span>
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
            {done && (
              <p className="form-alert form-alert-notice">Password updated — redirecting…</p>
            )}

            <button
              className="button button-primary start-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Set new password"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
