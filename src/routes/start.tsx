import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { readRefCookie } from "../lib/affiliate-config";
import { lookupReferral } from "../lib/affiliates.server";
import { createCheckoutSession } from "../lib/checkout.server";
import { fireStartedSignupEvent } from "../lib/meta-pixel";
import {
  PLAN_TIERS,
  PLAN_TIER_IDS,
  SETUP_FEE_CENTS,
  TRIAL_DAYS,
  formatUsd,
  monthlyTotalCents,
  tierById,
  type PlanTierId,
} from "../lib/pricing";
import { ThemeToggle } from "../components/theme-toggle";

const searchSchema = z.object({
  plan: z.enum(["trial", "membership"]).catch("trial"),
  tier: z.enum(PLAN_TIER_IDS).optional().catch(undefined),
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
  const { plan: initialPlan, tier: initialTier } = Route.useSearch();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [tierId, setTierId] = useState<PlanTierId>(initialTier ?? "starter");
  const tier = tierById(tierId);
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [locations, setLocations] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Counts one "started signup" per visit, even if someone has to resubmit.
  const startedSignupFiredRef = useRef(false);
  // Affiliate referral remembered from a ?ref= link. Only shown (and the setup
  // fee only waived) once the server confirms the code is an approved partner.
  const [refCode, setRefCode] = useState<string | null>(null);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  useEffect(() => {
    const code = readRefCookie();
    if (!code) return;
    setRefCode(code);
    lookupReferral({ data: { code } })
      .then((result) => {
        if (result.ok) setReferrerName(result.name);
      })
      .catch(() => {
        // No banner if the lookup fails; checkout re-checks the code anyway.
      });
  }, []);
  const setupFeeCents = referrerName ? 0 : SETUP_FEE_CENTS;

  const monthlyTotal = monthlyTotalCents(locations, tierId);
  const dueToday = plan === "trial" ? 0 : monthlyTotal + setupFeeCents;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!businessName.trim() || !contactName.trim() || !email.trim() || !phone.trim()) {
      setError("Fill in every field so we know who to activate.");
      return;
    }

    if (!startedSignupFiredRef.current) {
      startedSignupFiredRef.current = true;
      fireStartedSignupEvent(plan);
    }

    setSubmitting(true);
    try {
      const result = await createCheckoutSession({
        data: {
          plan,
          tier: tierId,
          businessName,
          contactName,
          email,
          phone,
          locations,
          origin: window.location.origin,
          ref: refCode ?? undefined,
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
          <div className="site-nav-actions">
            <ThemeToggle />
            <a className="button button-ghost nav-cta" href="/">
              Back to site
            </a>
          </div>
        </div>
      </header>

      <main className="start-main">
        <div className="page-width start-grid">
          <div className="start-copy">
            {/* UPTREND50 promo banner. Hides itself automatically after the code
                expires at the end of Oct 15, 2026 (Arizona time). */}
            {Date.now() < Date.parse("2026-10-16T07:00:00Z") && (
              <div className="promo-banner" role="note">
                <strong>50% off your first month</strong>
                <span>
                  Use code <code>UPTREND50</code> on the payment page. Ends 10/15.
                </span>
              </div>
            )}
            {referrerName ? (
              <div className="promo-banner" role="note">
                <strong>Referred by {referrerName}</strong>
                <span>Your $20 setup fee is waived.</span>
              </div>
            ) : null}
            <p className="eyebrow">
              <span /> {plan === "trial" ? `${TRIAL_DAYS}-day free trial` : "Start your membership"}
            </p>
            <h1 className="start-heading">Get your first review request out today.</h1>
            <p className="start-lead">
              No demo, no sales call. Tell us about your business and you're set up to start
              collecting reviews right away. Our team follows up within one business day to finish
              activating your account.
            </p>

            <ul className="feature-list start-fine-print">
              <li>
                <CheckIcon />
                {tier.name} plan: {formatUsd(tier.priceCents)}/month per location
              </li>
              <li>
                <CheckIcon />
                {referrerName
                  ? "No setup fee (referral)"
                  : `${formatUsd(SETUP_FEE_CENTS)} one-time setup fee`}
              </li>
              <li>
                <CheckIcon />
                {plan === "trial"
                  ? `Card required to start, nothing charged for ${TRIAL_DAYS} days`
                  : "Billed today, cancel anytime"}
              </li>
              <li>
                <CheckIcon />
                Month-to-month, no long contracts
              </li>
            </ul>

            <p className="plan-alt-link">
              {plan === "trial" ? (
                <>
                  Prefer to skip the trial and subscribe today?{" "}
                  <button type="button" onClick={() => setPlan("membership")}>
                    Start membership now
                  </button>
                </>
              ) : (
                <>
                  Want the {TRIAL_DAYS}-day free trial instead?{" "}
                  <button type="button" onClick={() => setPlan("trial")}>
                    Switch to free trial
                  </button>
                </>
              )}
            </p>
          </div>

          <form className="start-form" onSubmit={handleSubmit}>
            <fieldset className="tier-picker">
              <legend>Choose your plan</legend>
              {PLAN_TIERS.map((option) => (
                <label
                  key={option.id}
                  className={option.id === tierId ? "tier-option is-selected" : "tier-option"}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={option.id}
                    checked={option.id === tierId}
                    onChange={() => setTierId(option.id)}
                  />
                  <span className="tier-name">{option.name}</span>
                  <span className="tier-price">
                    {formatUsd(option.priceCents)}
                    <small>/mo per location</small>
                  </span>
                  <span className="tier-limit">
                    Up to {option.monthlyRequests.toLocaleString("en-US")} review requests a month
                  </span>
                </label>
              ))}
            </fieldset>
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
                  {tier.name}: {locations} location{locations > 1 ? "s" : ""} × {formatUsd(tier.priceCents)}
                  /mo
                </span>
                <strong>{formatUsd(monthlyTotal)}/mo</strong>
              </div>
              <div>
                <span>One-time setup fee</span>
                <strong>{setupFeeCents === 0 ? "Waived" : formatUsd(SETUP_FEE_CENTS)}</strong>
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
              Secure checkout powered by Stripe.{" "}
              {plan === "trial" &&
                `Card required to start, nothing charged for ${TRIAL_DAYS} days. `}
              Cancel anytime, no long-term contract.
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
