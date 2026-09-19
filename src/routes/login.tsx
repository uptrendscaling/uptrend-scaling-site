import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { loginBusiness } from "../lib/reviews.server";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in | UpTrend Scaling" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await loginBusiness({ data: { email, password } });
      if (result.ok) {
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
          <a className="button button-ghost nav-cta" href="/">
            Back to site
          </a>
        </div>
      </header>

      <main className="start-main success-main">
        <div className="page-width" style={{ maxWidth: 440, marginInline: "auto" }}>
          <p className="eyebrow">
            <span /> CRM sign in
          </p>
          <h1 className="start-heading">Welcome back.</h1>
          <p className="start-lead" style={{ marginBottom: 28 }}>
            Sign in to see your review requests, track clicks, and manage customers.
          </p>

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
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error && <p className="form-alert form-alert-error">{error}</p>}

            <button
              className="button button-primary start-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
