import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { unsubscribeLead } from "../lib/leads.server";

// The page behind the Unsubscribe button in every outreach email. The link in
// the email carries the lead's id (?l=...). Someone who lands here without one
// (or whose email client stripped it) can type their address instead.
// Unsubscribing takes one deliberate click on a button rather than happening
// on page load, so mail scanners that pre-open links can't unsubscribe people
// by accident.
// A lead id is always a UUID. Anything else (a mangled link) falls back to the
// type-your-email form instead of showing a button that can only fail.
const searchSchema = z.object({
  l: z.string().trim().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Unsubscribe | UpTrend Scaling" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { l: leadId } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(data: { leadId: string } | { email: string }) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await unsubscribeLead({ data });
      if (result.ok) {
        setDone(true);
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error(err);
      setError(
        "That didn't go through. Please try again, or just reply to the email and we'll remove you.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    void submit({ email });
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
        <div className="page-width" style={{ maxWidth: 440, marginInline: "auto" }}>
          <p className="eyebrow">
            <span /> Email preferences
          </p>

          {done ? (
            <>
              <h1 className="start-heading">You're unsubscribed.</h1>
              <p className="form-alert form-alert-notice">
                We won't email you again. Sorry for the interruption.
              </p>
            </>
          ) : leadId ? (
            <>
              <h1 className="start-heading">Unsubscribe from our emails?</h1>
              <p className="start-lead" style={{ marginBottom: 28 }}>
                Click the button below and we'll stop emailing you.
              </p>
              {error && <p className="form-alert form-alert-error">{error}</p>}
              <button
                className="button button-primary start-submit"
                type="button"
                disabled={submitting}
                onClick={() => void submit({ leadId })}
              >
                {submitting ? "Unsubscribing…" : "Yes, unsubscribe me"}
              </button>
            </>
          ) : (
            <>
              <h1 className="start-heading">Unsubscribe from our emails</h1>
              <p className="start-lead" style={{ marginBottom: 28 }}>
                Enter the email address you'd like us to stop emailing.
              </p>
              <form className="start-form" onSubmit={handleEmailSubmit}>
                <label>
                  <span>Email address</span>
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
                  {submitting ? "Unsubscribing…" : "Unsubscribe"}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
