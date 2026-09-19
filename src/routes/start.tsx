import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { createCheckoutSession } from "../lib/checkout.server";
import {
  MONTHLY_PRICE_CENTS,
  SETUP_FEE_CENTS,
  TRIAL_DAYS,
  formatUsd,
  monthlyTotalCents,
} from "../lib/pricing";

const searchSchema = z.object({
  plan: z.enum(["trial", "membership"]).catch("trial"),
});

export const Route = createFileRoute("/start")({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Start your free trial | UpTrend Scaling" },
      {
        name: "description",
        content:
          "Start your 7-day free trial or activate your UpTrend Scaling membership in minutes. No demo, no sales call.",
      },
    ],
  }),
  component: StartPage,
});

type Plan = "trial" | "membership";

function StartPage() {
  const { plan: initialPlan } = Route.useSearch();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [locations, setLocations] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const monthlyTotal = monthlyTotalCents(locations);
  const dueToday = plan === "trial" ? 0 : monthlyTotal + SETUP_FEE_CENTS;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!businessName.trim() || !contactName.trim() || !email.trim() || !phone.trim()) {
      setError("Fill in every field so we know who to activate.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createCheckoutSession({
        data: {
          plan,
          businessName,
          contactName,
          email,
          phone,
          locations,
          origin: window.location.origin,
        },
      });

      if (result.ok) {
        window.location.href = result.url;
        return;
      }

      if (result.reason === "not_configured") {
        setNotice(result.message);
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again or email hello@uptrendscaling.com.");
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

      <main className="start-main">
        <div className="page-width start-grid">
          <div className="start-copy">
            <p className="eyebrow">
              <span /> {plan === "trial" ? `${TRIAL_DAYS}-day free trial` : "Start your membership"}
            </p>
            <h1 className="start-heading">Get your first review request out today.</h1>
            <p className="start-lead">
              No demo, no sales call. Tell us about your business and you're set up to start
              collecting reviews right away. Our team follows up within one business day to finish
              activating your account.
            </p>

            <div className="plan-toggle" role="tablist" aria-label="Choose a plan">
              <button
                type="button"
                role="tab"
                aria-selected={plan === "trial"}
                className={plan === "trial" ? "is-active" : ""}
                onClick={() => setPlan("trial")}
              >
                {TRIAL_DAYS}-day free trial
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={plan === "membership"}
                className={plan === "membership" ? "is-active" : ""}
                onClick={() => setPlan("membership")}
              >
                Start membership now
              </button>
            </div>

            <ul className="feature-list start-fine-print">
              <li>
                <CheckIcon />
                {formatUsd(MONTHLY_PRICE_CENTS)}/month per location
              </li>
              <li>
                <CheckIcon />
                {formatUsd(SETUP_FEE_CENTS)} one-time setup fee
              </li>
              <li>
                <CheckIcon />
                {plan === "trial"
                  ? `Nothing charged for ${TRIAL_DAYS} days, cancel anytime before then`
                  : "Billed today, cancel anytime"}
              </li>
              <li>
                <CheckIcon />
                Month-to-month, no long contracts
              </li>
            </ul>
          </div>

          <form className="start-form" onSubmit={handleSubmit}>
            <label>
              <span>Business name</span>
              <input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="Ace Plumbing"
                autoComplete="organization"
                required
              />
            </label>
            <label>
              <span>Your name</span>
              <input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Jamie Rivera"
                autoComplete="name"
                required
              />
            </label>
            <label>
              <span>Work email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jamie@aceplumbing.com"
                autoComplete="email"
                required
              />
            </label>
            <label>
              <span>Phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(555) 555-0123"
                autoComplete="tel"
                required
              />
            </label>
            <label>
              <span>Locations</span>
              <input
                type="number"
                min={1}
                max={50}
                value={locations}
                onChange={(event) =>
                  setLocations(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
                }
              />
            </label>

            <div className="start-summary">
              <div>
                <span>
                  {locations} location{locations > 1 ? "s" : ""} × {formatUsd(MONTHLY_PRICE_CENTS)}
                  /mo
                </span>
                <strong>{formatUsd(monthlyTotal)}/mo</strong>
              </div>
              <div>
                <span>One-time setup fee</span>
                <strong>{formatUsd(SETUP_FEE_CENTS)}</strong>
              </div>
              <div className="start-summary-total">
                <span>Due today</span>
                <strong>{dueToday === 0 ? "$0" : formatUsd(dueToday)}</strong>
              </div>
            </div>

            {error && <p className="form-alert form-alert-error">{error}</p>}
            {notice && (
              <p className="form-alert form-alert-notice">
                {notice} Email{" "}
                <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a> and we'll get
                you set up by hand in the meantime.
              </p>
            )}

            <button
              className="button button-primary start-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? "Starting checkout…"
                : plan === "trial"
                  ? "Start Free Trial"
                  : "Start Membership"}
              <ArrowIcon />
            </button>
            <p className="start-disclaimer">
              Secure checkout powered by Stripe. Cancel anytime, no long-term contract.
            </p>
          </form>
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

function CheckIcon() {
  return (
    <svg className="check-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10 4 4 8-9" />
    </svg>
  );
}
