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
  WEBSITE_OPTIONS,
  WEBSITE_OPTION_IDS,
  formatUsd,
  monthlyTotalCents,
  tierById,
  websiteOptionById,
  type PlanTierId,
  type WebsiteOptionId,
} from "../lib/pricing";
import { ThemeToggle } from "../components/theme-toggle";

const searchSchema = z.object({
  plan: z.enum(["trial", "membership"]).catch("trial"),
  tier: z.enum(PLAN_TIER_IDS).optional().catch(undefined),
  // Deep link for website orders, e.g. /start?website=build_maintenance
  website: z.enum(WEBSITE_OPTION_IDS).optional().catch(undefined),
  // "no" means a website-only order (no Google review plan).
  reviews: z.enum(["yes", "no"]).optional().catch(undefined),
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
  const {
    plan: initialPlan,
    tier: initialTier,
    website: initialWebsite,
    reviews: initialReviews,
  } = Route.useSearch();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [tierId, setTierId] = useState<PlanTierId>(initialTier ?? "starter");
  const tier = tierById(tierId);
  // Website offers: none by default, so /start still opens as the review signup.
  const [websiteId, setWebsiteId] = useState<WebsiteOptionId | "none">(initialWebsite ?? "none");
  // The review plan is opt-in when a website is being ordered, so a website link
  // starts as website-only unless the link says reviews=yes.
  const [wantsReviews, setWantsReviews] = useState(
    initialWebsite ? initialReviews === "yes" : true,
  );
  const [websiteUrl, setWebsiteUrl] = useState("");
  const websiteOption = websiteOptionById(websiteId === "none" ? null : websiteId);
  const hasWebsite = websiteOption !== null;
  // Plain review signups always include the review plan; with a website the
  // review plan is optional.
  const includeReviews = hasWebsite ? wantsReviews : true;
  // Website orders are paid today, so they never get the free trial.
  const effectivePlan: Plan = hasWebsite ? "membership" : plan;
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
  const reviewMonthly = includeReviews ? monthlyTotal : 0;
  const websiteBuildCents = websiteOption?.buildCents ?? 0;
  const websiteMonthlyCents = websiteOption?.monthlyCents ?? 0;
  const setupFeeDueCents = includeReviews ? setupFeeCents : 0;
  const monthlyAfterCents = reviewMonthly + websiteMonthlyCents;
  const dueToday =
    effectivePlan === "trial"
      ? 0
      : reviewMonthly + websiteBuildCents + websiteMonthlyCents + setupFeeDueCents;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!businessName.trim() || !contactName.trim() || !email.trim() || !phone.trim()) {
      setError("Fill in every field so we know who to activate.");
      return;
    }

    if (websiteOption?.id === "maintenance" && !websiteUrl.trim()) {
      setError("Add the address of your current website so we know what to maintain.");
      return;
    }

    if (!startedSignupFiredRef.current) {
      startedSignupFiredRef.current = true;
      fireStartedSignupEvent(effectivePlan);
    }

    setSubmitting(true);
    try {
      const result = await createCheckoutSession({
        data: {
          plan: effectivePlan,
          tier: tierId,
          businessName,
          contactName,
          email,
          phone,
          locations: includeReviews ? locations : 1,
          origin: window.location.origin,
          ref: refCode ?? undefined,
          ...(websiteOption
            ? {
                website: websiteOption.id,
                reviews: includeReviews,
                websiteUrl: websiteUrl.trim() || undefined,
              }
            : {}),
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
            {referrerName && includeReviews ? (
              <div className="promo-banner" role="note">
                <strong>Referred by {referrerName}</strong>
                <span>Your $20 setup fee is waived.</span>
              </div>
            ) : null}
            <p className="eyebrow">
              <span />{" "}
              {hasWebsite
                ? "Your website"
                : plan === "trial"
                  ? `${TRIAL_DAYS}-day free trial`
                  : "Start your membership"}
            </p>
            <h1 className="start-heading">
              {hasWebsite
                ? "Get your website live."
                : "Get your first review request out today."}
            </h1>
            <p className="start-lead">
              {hasWebsite
                ? "Saw your free preview and ready to go, or want a site built from scratch? Pick what you need below. We build it, you approve it, and we handle the hosting and updates so you don't have to."
                : "No demo, no sales call. Tell us about your business and you're set up to start collecting reviews right away. Our team follows up within one business day to finish activating your account."}
            </p>

            <ul className="feature-list start-fine-print">
              {hasWebsite ? (
                <>
                  <li>
                    <CheckIcon />
                    {websiteOption.name}: {websiteOption.priceText}
                  </li>
                  <li>
                    <CheckIcon />
                    {includeReviews
                      ? `${tier.name} review plan: ${formatUsd(tier.priceCents)}/month per location`
                      : "No review plan added"}
                  </li>
                  <li>
                    <CheckIcon />
                    {monthlyAfterCents > 0
                      ? "Monthly services are month-to-month, no long contracts"
                      : "One payment, nothing recurring"}
                  </li>
                </>
              ) : (
                <>
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
                </>
              )}
            </ul>

            <p className="plan-alt-link" hidden={hasWebsite}>
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
              <legend>Need a website?</legend>
              <label className={websiteId === "none" ? "tier-option is-selected" : "tier-option"}>
                <input
                  type="radio"
                  name="website"
                  value="none"
                  checked={websiteId === "none"}
                  onChange={() => {
                    setWebsiteId("none");
                    setWantsReviews(true);
                  }}
                />
                <span className="tier-name">No website</span>
                <span className="tier-price">Reviews only</span>
                <span className="tier-limit">Just the Google review plan below</span>
              </label>
              {WEBSITE_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={option.id === websiteId ? "tier-option is-selected" : "tier-option"}
                >
                  <input
                    type="radio"
                    name="website"
                    value={option.id}
                    checked={option.id === websiteId}
                    onChange={() => {
                      // Picking a website from "No website" starts website-only.
                      if (websiteId === "none") setWantsReviews(false);
                      setWebsiteId(option.id);
                    }}
                  />
                  <span className="tier-name">{option.name}</span>
                  <span className="tier-price">{option.priceText}</span>
                  <span className="tier-limit">{option.detail}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="tier-picker">
              <legend>
                {hasWebsite ? "Add Google review automation (optional)" : "Choose your plan"}
              </legend>
              {hasWebsite ? (
                <label className={!wantsReviews ? "tier-option is-selected" : "tier-option"}>
                  <input
                    type="radio"
                    name="tier"
                    value="none"
                    checked={!wantsReviews}
                    onChange={() => setWantsReviews(false)}
                  />
                  <span className="tier-name">No thanks</span>
                  <span className="tier-price">Website only</span>
                  <span className="tier-limit">You can add review automation any time</span>
                </label>
              ) : null}
              {PLAN_TIERS.map((option) => (
                <label
                  key={option.id}
                  className={
                    includeReviews && option.id === tierId
                      ? "tier-option is-selected"
                      : "tier-option"
                  }
                >
                  <input
                    type="radio"
                    name="tier"
                    value={option.id}
                    checked={includeReviews && option.id === tierId}
                    onChange={() => {
                      setTierId(option.id);
                      setWantsReviews(true);
                    }}
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
            {includeReviews ? (
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
            ) : null}
            {hasWebsite ? (
              <label>
                <span>
                  {websiteOption.id === "maintenance"
                    ? "Your current website"
                    : "Your current website (if you have one)"}
                </span>
                <input
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                  placeholder="www.aceplumbing.com"
                  autoComplete="url"
                  required={websiteOption.id === "maintenance"}
                />
              </label>
            ) : null}

            <div className="start-summary">
              {websiteBuildCents > 0 ? (
                <div>
                  <span>Website build (one-time)</span>
                  <strong>{formatUsd(websiteBuildCents)}</strong>
                </div>
              ) : null}
              {websiteMonthlyCents > 0 ? (
                <div>
                  <span>Website maintenance</span>
                  <strong>{formatUsd(websiteMonthlyCents)}/mo</strong>
                </div>
              ) : null}
              {includeReviews ? (
                <>
                  <div>
                    <span>
                      {tier.name}: {locations} location{locations > 1 ? "s" : ""} ×{" "}
                      {formatUsd(tier.priceCents)}/mo
                    </span>
                    <strong>{formatUsd(monthlyTotal)}/mo</strong>
                  </div>
                  <div>
                    <span>One-time setup fee</span>
                    <strong>{setupFeeCents === 0 ? "Waived" : formatUsd(SETUP_FEE_CENTS)}</strong>
                  </div>
                </>
              ) : null}
              {hasWebsite && monthlyAfterCents > 0 ? (
                <div>
                  <span>Then every month</span>
                  <strong>{formatUsd(monthlyAfterCents)}/mo</strong>
                </div>
              ) : null}
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
                : hasWebsite
                  ? "Continue to payment"
                  : plan === "trial"
                    ? "Start Free Trial"
                    : "Start Membership"}
              <ArrowIcon />
            </button>
            <p className="start-disclaimer">
              Secure checkout powered by Stripe.{" "}
              {!hasWebsite &&
                plan === "trial" &&
                `Card required to start, nothing charged for ${TRIAL_DAYS} days. `}
              {!hasWebsite
                ? "Cancel anytime, no long-term contract."
                : monthlyAfterCents === 0
                  ? "One payment, nothing recurring."
                  : "Monthly services can be canceled anytime, no long-term contract."}
            </p>
            <p className="start-disclaimer start-callout">
              Questions before you pay? Call Colby at{" "}
              <a href="tel:+14805360301">(480) 536-0301</a>.
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
