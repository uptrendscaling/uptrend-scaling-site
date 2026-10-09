import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { ThemeToggle } from "../components/theme-toggle";
import {
  AFFILIATE_COOKIE_DAYS,
  AFFILIATE_MIN_PAYOUT_DOLLARS,
  AFFILIATE_PAYABLE_AFTER_PAYMENTS,
} from "../lib/affiliate-config";
import { applyForAffiliate } from "../lib/affiliates.server";
import { CANONICAL_SITE_URL } from "../lib/site";

export const Route = createFileRoute("/affiliates")({
  head: () => ({
    meta: [
      { title: "Affiliate program | UpTrend Scaling" },
      {
        name: "description",
        content:
          "Earn 25% of every payment, for as long as they stay, when you refer local service businesses to UpTrend Scaling, Google review automation on autopilot.",
      },
      { property: "og:title", content: "UpTrend Scaling affiliate program" },
      { property: "og:url", content: `${CANONICAL_SITE_URL}/affiliates` },
    ],
  }),
  component: AffiliatesPage,
});

function AffiliatesPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [promotePlan, setPromotePlan] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!agreed) {
      setError("Please agree to the program terms.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await applyForAffiliate({
        data: {
          name,
          email,
          phone,
          paypalEmail,
          website,
          promotePlan,
          agreed: true,
        },
      });
      if (result.ok) {
        setDone(true);
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error(err);
      setError("Please check each field and try again.");
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
            <p className="eyebrow">
              <span /> Affiliate program
            </p>
            <h1 className="start-heading">
              Earn 25% of every payment, for as long as they stay.
            </h1>
            <p className="start-lead">
              Know contractors, cleaners, roofers or other local service
              businesses? Share your link. When they sign up, you earn 25% of
              every payment they make, for as long as they stay a customer, and
              they skip our $20 setup fee.
            </p>

            <div className="aff-example" aria-label="Earnings example">
              <div>
                <span>Refer 10 businesses on the $70 plan</span>
                <strong>$175/month</strong>
              </div>
              <div>
                <span>Every year they stay</span>
                <strong>$2,100</strong>
              </div>
            </div>

            <ol className="aff-steps">
              <li>
                <strong>Apply below.</strong> We review every application by
                hand, usually within a couple of business days.
              </li>
              <li>
                <strong>Get your link.</strong> Anyone who clicks it is credited
                to you for {AFFILIATE_COOKIE_DAYS} days.
              </li>
              <li>
                <strong>Share it your way.</strong> Our{" "}
                <a href="/affiliates/kit">partner kit</a> has ready-to-send
                emails, posts and talking points.
              </li>
              <li>
                <strong>Get paid monthly.</strong> By PayPal, once you've earned
                ${AFFILIATE_MIN_PAYOUT_DOLLARS}.
              </li>
            </ol>

            <section id="terms" className="aff-terms">
              <h2>Program terms</h2>
              <ul>
                <li>
                  You earn 25% of what each referred business pays us (after any
                  discounts and refunds) on every monthly payment, for as long
                  as they stay a customer. There is no end date.
                </li>
                <li>
                  Commission on a business becomes payable after their{" "}
                  {AFFILIATE_PAYABLE_AFTER_PAYMENTS}nd monthly payment. Payouts
                  go out monthly by PayPal once your balance reaches $
                  {AFFILIATE_MIN_PAYOUT_DOLLARS}.
                </li>
                <li>
                  A referral counts when the business signs up within{" "}
                  {AFFILIATE_COOKIE_DAYS} days of clicking your link. If they
                  click someone else's link later, the newest link gets the
                  credit.
                </li>
                <li>
                  Always say clearly that you earn a commission, right next to
                  your recommendation (for example, "I earn a commission if you
                  sign up through my link"). In videos, say it out loud in the
                  video. This is an FTC requirement.
                </li>
                <li>
                  Not allowed: spam, bidding on "UpTrend Scaling" in paid search
                  ads, referring your own business, misleading claims, or
                  promising results we don't promise (such as a guaranteed
                  number of reviews).
                </li>
                <li>
                  We may pause or end an affiliate account for breaking these
                  terms. Commission you have already earned under the terms is
                  still paid. We may update the program with notice by email.
                </li>
              </ul>
            </section>
          </div>

          {done ? (
            <div className="start-form aff-done" role="status">
              <h2>Application received.</h2>
              <p>
                Thanks, {name.trim().split(/\s+/)[0] || "partner"}. We'll email
                you at {email} within a couple of business days with your
                personal link.
              </p>
              <a className="button button-primary" href="/">
                Back to the site
              </a>
            </div>
          ) : (
            <form className="start-form" onSubmit={handleSubmit}>
              <label>
                <span>Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                <span>Phone (optional)</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </label>
              <label>
                <span>PayPal email (for payouts)</span>
                <input
                  type="email"
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                <span>Website or social profile (optional)</span>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="youtube.com/@yourchannel"
                />
              </label>
              <label>
                <span>How will you share UpTrend?</span>
                <textarea
                  value={promotePlan}
                  onChange={(e) => setPromotePlan(e.target.value)}
                  rows={4}
                  placeholder="For example: I coach HVAC owners and run a Facebook group of 3,000 contractors."
                  required
                />
              </label>
              <label className="aff-check">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  I agree to the <a href="#terms">program terms</a>, including
                  disclosing that I earn a commission.
                </span>
              </label>

              {error && <p className="form-alert form-alert-error">{error}</p>}

              <button
                className="button button-primary start-submit"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "Sending…" : "Apply to become an affiliate"}
              </button>
              <p className="start-disclaimer">
                Questions? Email hello@uptrendscaling.com.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
