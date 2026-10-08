import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import {
  MONTHLY_PRICE_CENTS,
  SETUP_FEE_CENTS,
  TRIAL_DAYS,
  formatUsd,
} from "../lib/pricing";
import { CANONICAL_SITE_URL } from "../lib/site";
import { ThemeToggle } from "../components/theme-toggle";

const START_TRIAL = "/start?plan=trial";
const START_MEMBERSHIP = "/start?plan=membership";

// Absolute URL required: social platforms (Facebook, iMessage, Slack, etc.)
// won't resolve a relative path when unfurling a shared link.
const OG_IMAGE_URL = `${CANONICAL_SITE_URL}/og-image.png`;

// Single source of truth for the FAQ, used to render the visible accordion
// AND the FAQPage structured data below, so the two can never drift apart
// (mismatched visible/schema content is against AI/search structured-data
// guidelines and can get the markup ignored or penalized).
const FAQ_ITEMS = [
  {
    question: "What does UpTrend Scaling do?",
    answer:
      "UpTrend Scaling automates asking your customers for a Google review. The moment a job is marked complete, it sends a short SMS or email with a direct link to your Google review page, follows up once if there's no response, and offers printable QR codes for in-person requests.",
  },
  {
    question: "How much does UpTrend Scaling cost?",
    answer: `UpTrend Scaling is ${formatUsd(MONTHLY_PRICE_CENTS)} per month per location, plus a one-time ${formatUsd(SETUP_FEE_CENTS)} setup fee. It's month-to-month with no long-term contract, and you can cancel anytime.`,
  },
  {
    question: "Is there a free trial?",
    answer: `Yes. There's a ${TRIAL_DAYS}-day free trial, and nothing is charged until it ends.`,
  },
  {
    question: "Do my customers need to download an app?",
    answer:
      "No. Review requests go out over regular SMS and email, and customers tap straight through to your Google review page. No app, sign-in, or account is required on their end.",
  },
  {
    question: "How fast do review requests go out after a job is finished?",
    answer:
      "Within minutes of a job being marked complete, while the experience is still fresh for the customer. Texts only go out between 10am and 7pm your local time, so a job closed out late at night gets its text the next morning.",
  },
  {
    question: "Does it work with the software I already use?",
    answer:
      "Yes. QuickBooks, Square and Jobber connect directly, so a review request goes out on its own the moment an invoice is paid. Use something else, like Housecall Pro or Workiz? Connect it through Zapier, which works with thousands of business apps. You can also add customers by hand in a few seconds.",
  },
  {
    question: "What happens if a customer doesn't respond?",
    answer:
      "UpTrend Scaling sends one polite reminder after 48 hours if there's been no response. There's no repeated nagging beyond that.",
  },
  {
    question: "What kinds of businesses use UpTrend Scaling?",
    answer:
      "Local, customer-facing businesses that depend on their online reputation: home services, auto sales and service, restaurants and cafés, salons and spas, medical and dental practices, and retail or specialty shops.",
  },
  {
    question: "Can I use UpTrend Scaling for more than one location?",
    answer:
      "Yes. Pricing is per location, so multi-location businesses can add each location and manage review requests for all of them.",
  },
  {
    question: "Does UpTrend Scaling ever buy or fake reviews?",
    answer:
      "No. UpTrend Scaling only makes it easier for real customers to leave a review after real work is done. No review is ever purchased, incentivized in exchange for a rating, or fabricated.",
  },
];

// Structured data (schema.org JSON-LD) so search and AI answer engines can
// extract who this company is, what it sells, and the FAQ content directly,
// instead of inferring it from prose. Added 2026-09-28 as part of an
// AI-answer-engine visibility pass; see also public/llms.txt and
// public/sitemap.xml.
const ORGANIZATION_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "UpTrend Scaling",
  legalName: "UpTrend Scaling LLC",
  url: CANONICAL_SITE_URL,
  logo: OG_IMAGE_URL,
  email: "hello@uptrendscaling.com",
  foundingDate: "2026-09-18",
  sameAs: [
    "https://www.facebook.com/profile.php?id=61594598074617",
    "https://www.instagram.com/uptrendscaling/",
  ],
};

const SOFTWARE_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "UpTrend Scaling",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: CANONICAL_SITE_URL,
  description:
    "Google review automation for local businesses: automatic SMS and email review requests, a follow-up reminder, and QR codes for in-person requests.",
  offers: {
    "@type": "Offer",
    price: (MONTHLY_PRICE_CENTS / 100).toFixed(2),
    priceCurrency: "USD",
    url: `${CANONICAL_SITE_URL}${START_TRIAL}`,
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: (MONTHLY_PRICE_CENTS / 100).toFixed(2),
      priceCurrency: "USD",
      unitText: "MONTH",
    },
  },
};

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "UpTrend Scaling | Google Review Automation" },
      {
        name: "description",
        content:
          "Turn finished jobs into genuine Google reviews with automated SMS and email requests, reminders, QR codes, and simple reporting.",
      },
      {
        property: "og:title",
        content: "UpTrend Scaling | Put your reputation on an uptrend",
      },
      {
        property: "og:description",
        content:
          "Google review automation built for local businesses and owner-operators.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: CANONICAL_SITE_URL },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE_URL },
    ],
    links: [{ rel: "canonical", href: CANONICAL_SITE_URL }],
  }),
  component: Index,
});

// Homepage, redesigned 2026-10-08 to match the client dashboard (/app): same
// graphite palette, Inter type, 12px panels, stat cards and chips. Every class
// here is prefixed "lp-" and styled in the "Landing page" block at the end of
// styles.css, so the shared site classes used by /start, /login, /terms and
// /privacy are untouched. Colby asked (2026-10-08) for no "example" or
// "sample" wording anywhere in the previews.

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const PREVIEW_BARS = [3, 5, 4, 6, 7, 6, 9, 10, 11, 14, 16, 19];

const INDUSTRIES = [
  "Plumbing",
  "HVAC",
  "Electrical",
  "Roofing",
  "Landscaping",
  "Cleaning",
  "Auto repair & detailing",
  "Restaurants & cafés",
  "Salons & spas",
  "Medical & dental",
  "Retail & specialty shops",
];

function Index() {
  return (
    <div className="lp-root">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(ORGANIZATION_SCHEMA),
        }}
      />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_SCHEMA) }}
      />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />

      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <a className="lp-brand" href="#top" aria-label="UpTrend Scaling home">
            <BrandMark />
            <span>
              UpTrend <em>Scaling</em>
            </span>
          </a>
          <nav className="lp-nav-links" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggle />
            <a className="lp-btn lp-btn-quiet lp-nav-login" href="/login">
              Log in
            </a>
            <a className="lp-btn lp-btn-primary lp-btn-sm" href={START_TRIAL}>
              Start free trial
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* ---- Hero ------------------------------------------------------ */}
        <section id="top" className="lp-hero">
          <div className="lp-container">
            <div className="lp-hero-copy">
              <p className="lp-pill">
                <span className="lp-pill-dot" aria-hidden="true" />
                Google review automation for local businesses
              </p>
              <h1>
                Get more Google reviews, <br />
                <span>on autopilot.</span>
              </h1>
              <p className="lp-hero-lead">
                Every finished job gets a friendly text and email with a one-tap
                link to your Google review page. One reminder if they forget, QR
                codes for in person, and a dashboard that shows it working.
              </p>
              <div className="lp-hero-actions">
                <a
                  className="lp-btn lp-btn-primary lp-btn-lg"
                  href={START_TRIAL}
                >
                  Start {TRIAL_DAYS}-day free trial <ArrowIcon />
                </a>
                <a
                  className="lp-btn lp-btn-ghost lp-btn-lg"
                  href="#how-it-works"
                >
                  See how it works
                </a>
              </div>
              <ul className="lp-hero-facts">
                <li>
                  <CheckIcon /> Nothing charged for {TRIAL_DAYS} days
                </li>
                <li>
                  <CheckIcon /> Set up in minutes, no sales call
                </li>
                <li>
                  <CheckIcon /> Cancel anytime
                </li>
              </ul>
              <p className="lp-hero-fine">
                Card required to start the trial.{" "}
                <a href={START_MEMBERSHIP}>
                  Prefer to skip the trial and subscribe today?
                </a>
              </p>
            </div>

            <DashboardPreview />
          </div>
        </section>

        {/* ---- Works with ------------------------------------------------ */}
        <section className="lp-works" aria-label="Works with">
          <div className="lp-container lp-works-inner">
            <span className="lp-label">Works with</span>
            <div className="lp-chips">
              {[
                "QuickBooks",
                "Square",
                "Jobber",
                "Zapier",
                "Google Business Profile",
                "Text messages",
                "Email",
                "QR codes",
              ].map((item) => (
                <span key={item} className="lp-chip">
                  <span className="lp-chip-dot" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Stats ----------------------------------------------------- */}
        <section className="lp-section" aria-labelledby="stats-heading">
          <div className="lp-container">
            <div className="lp-heading">
              <p className="lp-label">Why this works</p>
              <h2 id="stats-heading">
                Customers will leave a review. Most just need to be asked.
              </h2>
            </div>
            <div className="lp-stats">
              <StatCard value="97" unit="%" label="Read reviews">
                of consumers read reviews for local businesses before deciding
              </StatCard>
              <StatCard value="83" unit="%" label="Leave one when asked">
                of customers asked to leave a review actually leave one
              </StatCard>
              <StatCard value="92" unit="%" label="Ratings decide">
                say star ratings influence which business they choose
              </StatCard>
              <StatCard value="80" unit="%" label="Responses matter">
                are more likely to use a business that responds to its reviews
              </StatCard>
            </div>
            <p className="lp-source">
              Source: BrightLocal, 2026 Local Consumer Review Survey
            </p>
          </div>
        </section>

        {/* ---- How it works ---------------------------------------------- */}
        <section id="how-it-works" className="lp-section">
          <div className="lp-container">
            <div className="lp-heading">
              <p className="lp-label">How it works</p>
              <h2>Three steps. Then it runs on its own.</h2>
              <p>
                From finished job to a new Google review, every step happens
                while you get back to work.
              </p>
            </div>
            <div className="lp-steps">
              <StepCard step="1" title="The job is done" icon={<InvoiceIcon />}>
                An invoice gets paid in QuickBooks, Square or Jobber, or you
                add the customer in a few seconds. That's the only trigger.
              </StepCard>
              <StepCard
                step="2"
                title="We ask for the review"
                icon={<ChatIcon />}
              >
                Your customer gets a short text and email from your business
                name with a one-tap link. No app, no sign-in.
              </StepCard>
              <StepCard
                step="3"
                title="One friendly reminder"
                icon={<RefreshIcon />}
              >
                No review after 48 hours? One polite reminder goes out. Never
                more than that, so nobody feels nagged.
              </StepCard>
            </div>
          </div>
        </section>

        {/* ---- Features -------------------------------------------------- */}
        <section id="features" className="lp-section">
          <div className="lp-container">
            <div className="lp-heading">
              <p className="lp-label">Features</p>
              <h2>Everything you need to keep reviews coming in.</h2>
            </div>
            <div className="lp-bento">
              <article className="lp-panel lp-bento-text">
                <div className="lp-panel-copy">
                  <h3>A text customers actually open</h3>
                  <p>
                    Short, friendly, and sent from your business name. One tap
                    takes them straight to your Google review page.
                  </p>
                </div>
                <div
                  className="lp-messages"
                  aria-label="Review request text message"
                >
                  <div className="lp-msg-head">
                    <span className="lp-avatar">AP</span>
                    <div>
                      <strong>Ace Plumbing</strong>
                      <small>Text message</small>
                    </div>
                  </div>
                  <p className="lp-bubble lp-bubble-in">
                    Hi Maria, thanks for choosing Ace Plumbing today! Got 20
                    seconds to leave us a quick Google review?{" "}
                    <span className="lp-bubble-link">
                      uptrendscaling.com/r/…
                    </span>
                  </p>
                  <p className="lp-bubble lp-bubble-out">
                    On it. You guys were great.
                  </p>
                  <div className="lp-review-row">
                    <Stars />
                    <span>New Google review</span>
                  </div>
                </div>
              </article>

              <article className="lp-panel lp-bento-auto">
                <div className="lp-panel-copy">
                  <h3>Automatic with QuickBooks, Square and Jobber</h3>
                  <p>
                    Connect once. When an invoice is paid, the review request
                    goes out by itself. Use something else? Connect it through
                    Zapier.
                  </p>
                </div>
                <ol className="lp-flow" aria-label="What happens automatically">
                  <li>
                    <InvoiceIcon /> Invoice paid
                  </li>
                  <li>
                    <ChatIcon /> Text and email sent
                  </li>
                  <li>
                    <StarIcon /> Review on Google
                  </li>
                </ol>
              </article>

              <article className="lp-panel lp-bento-qr">
                <div className="lp-panel-copy">
                  <h3>QR codes for in person</h3>
                  <p>
                    Print-ready codes for the counter, the truck, or the
                    invoice. Scan and review on the spot.
                  </p>
                </div>
                <div className="lp-qr">
                  <DecorativeQR />
                  <span>Scan to leave a review</span>
                </div>
              </article>

              <article className="lp-panel lp-bento-report">
                <div className="lp-panel-copy">
                  <h3>See it working, every week</h3>
                  <p>
                    Requests sent, reviews earned, and your rating over time. A
                    summary lands in your inbox every Monday.
                  </p>
                </div>
                <MiniBars values={[4, 6, 5, 8, 9, 12, 14]} />
              </article>

              <article className="lp-panel lp-bento-timing">
                <div className="lp-panel-copy">
                  <h3>Polite timing, built in</h3>
                  <p>
                    Texts only go out between 10am and 7pm your local time.
                    Customers can opt out with one reply.
                  </p>
                </div>
                <div className="lp-clock" aria-hidden="true">
                  <span>10am</span>
                  <i />
                  <span>7pm</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ---- Industries ------------------------------------------------ */}
        <section className="lp-section lp-section-tight">
          <div className="lp-container">
            <div className="lp-panel lp-industries">
              <div>
                <p className="lp-label">Built for</p>
                <h2>Local businesses that live on their reviews.</h2>
                <p>
                  If customers Google you before they call you, UpTrend Scaling
                  fits your business.
                </p>
              </div>
              <div className="lp-chips lp-chips-wrap">
                {INDUSTRIES.map((item) => (
                  <span key={item} className="lp-chip lp-chip-lg">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---- Why us ---------------------------------------------------- */}
        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-heading">
              <p className="lp-label">Why UpTrend Scaling</p>
              <h2>Simple software that earns its keep.</h2>
            </div>
            <div className="lp-why">
              <article className="lp-panel">
                <span className="lp-icon-tile">
                  <BoltIcon />
                </span>
                <h3>Minutes to set up</h3>
                <p>
                  Add your Google review link, connect QuickBooks, Square or
                  Jobber if you use them, and the first requests go out the
                  same day.
                </p>
              </article>
              <article className="lp-panel">
                <span className="lp-icon-tile">
                  <CalendarIcon />
                </span>
                <h3>No long contracts</h3>
                <p>
                  Month-to-month. If it isn't earning its keep, cancel from your
                  dashboard anytime.
                </p>
              </article>
              <article className="lp-panel">
                <span className="lp-icon-tile">
                  <ShieldIcon />
                </span>
                <h3>Only real reviews</h3>
                <p>
                  We never buy, fake, or filter reviews. We just make it easy
                  for real customers to speak up.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ---- Pricing --------------------------------------------------- */}
        <section id="pricing" className="lp-section">
          <div className="lp-container">
            <div className="lp-heading lp-heading-center">
              <p className="lp-label">Pricing</p>
              <h2>One plan. Everything included.</h2>
            </div>
            <div className="lp-pricing">
              <div className="lp-price-side">
                <span className="lp-pill lp-pill-sm">
                  {TRIAL_DAYS}-day free trial
                </span>
                <div className="lp-price">
                  <strong>{formatUsd(MONTHLY_PRICE_CENTS)}</strong>
                  <span>/month per location</span>
                </div>
                <p className="lp-price-setup">
                  + {formatUsd(SETUP_FEE_CENTS)} one-time setup fee
                </p>
                <a
                  className="lp-btn lp-btn-primary lp-btn-lg lp-btn-block"
                  href={START_TRIAL}
                >
                  Start free trial <ArrowIcon />
                </a>
                <p className="lp-price-fine">
                  Card required, nothing charged for {TRIAL_DAYS} days.
                  <br />
                  <a href={START_MEMBERSHIP}>Or subscribe today</a>
                </p>
              </div>
              <ul className="lp-price-list">
                {[
                  "Automatic text and email review requests",
                  "One polite reminder after 48 hours",
                  "QuickBooks, Square and Jobber auto-send on paid invoices",
                  "Thousands of other apps through Zapier",
                  "Print-ready QR codes",
                  "Dashboard with your rating, requests and reviews",
                  "Weekly summary email",
                  "Month-to-month, cancel anytime",
                ].map((item) => (
                  <li key={item}>
                    <CheckIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---- FAQ ------------------------------------------------------- */}
        <section id="faq" className="lp-section">
          <div className="lp-container lp-faq-grid">
            <div className="lp-heading">
              <p className="lp-label">Questions</p>
              <h2>Straight answers.</h2>
              <p>
                Still wondering about something?{" "}
                <a href="mailto:hello@uptrendscaling.com?subject=Question%20about%20UpTrend%20Scaling">
                  hello@uptrendscaling.com
                </a>
              </p>
            </div>
            <div className="lp-faq">
              {FAQ_ITEMS.map((item) => (
                <details key={item.question} className="lp-faq-item">
                  <summary>
                    <span>{item.question}</span>
                    <span className="lp-faq-toggle" aria-hidden="true">
                      <PlusIcon />
                    </span>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Closing CTA ----------------------------------------------- */}
        <section className="lp-section lp-section-tight">
          <div className="lp-container">
            <div className="lp-cta">
              <h2>Stop hoping customers remember to leave a review.</h2>
              <p>
                Start your free trial in about two minutes. No demo, no sales
                call.
              </p>
              <div className="lp-hero-actions lp-cta-actions">
                <a
                  className="lp-btn lp-btn-primary lp-btn-lg"
                  href={START_TRIAL}
                >
                  Start {TRIAL_DAYS}-day free trial <ArrowIcon />
                </a>
                <a
                  className="lp-btn lp-btn-ghost lp-btn-lg"
                  href="mailto:hello@uptrendscaling.com?subject=Question%20about%20UpTrend%20Scaling"
                >
                  <MailIcon /> Email us a question
                </a>
              </div>
              <p className="lp-hero-fine">
                Card required, nothing charged for {TRIAL_DAYS} days. Cancel
                anytime.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <a className="lp-brand" href="#top">
              <BrandMark />
              <span>
                UpTrend <em>Scaling</em>
              </span>
            </a>
            <p>Google review automation for local businesses.</p>
          </div>
          <nav className="lp-footer-links" aria-label="Footer">
            <a href="mailto:hello@uptrendscaling.com">
              hello@uptrendscaling.com
            </a>
            <a href="/login">Log in</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a
              href="https://www.facebook.com/profile.php?id=61594598074617"
              target="_blank"
              rel="noopener noreferrer"
            >
              Facebook
            </a>
            <a
              href="https://www.instagram.com/uptrendscaling/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram
            </a>
          </nav>
          <p className="lp-copyright">
            © 2026 UpTrend Scaling, LLC. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

// A clickable copy of the client dashboard (/app). The tabs switch between
// small versions of the real Overview, Customers, Requests, QR codes and
// Reports screens so visitors can see what they get after signing up. The
// three QR codes are real and open this homepage.
type PreviewTab = "overview" | "customers" | "requests" | "qr" | "reports";

const PREVIEW_TABS: { id: PreviewTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "Customers" },
  { id: "requests", label: "Requests" },
  { id: "qr", label: "QR codes" },
  { id: "reports", label: "Reports" },
];

function DashboardPreview() {
  const [tab, setTab] = useState<PreviewTab>("overview");
  return (
    <div
      className="lp-preview"
      role="region"
      aria-label="UpTrend Scaling dashboard preview"
    >
      <div className="lp-preview-bar">
        <span className="lp-preview-brand" aria-hidden="true">
          <BrandMark small /> UpTrend
        </span>
        <div
          className="lp-preview-tabs"
          role="tablist"
          aria-label="Dashboard pages"
        >
          {PREVIEW_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`lp-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="lp-preview-panel"
              className={tab === item.id ? "is-active" : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="lp-preview-body"
        id="lp-preview-panel"
        role="tabpanel"
        aria-labelledby={`lp-tab-${tab}`}
      >
        {tab === "overview" ? <PreviewOverview /> : null}
        {tab === "customers" ? <PreviewCustomers /> : null}
        {tab === "requests" ? <PreviewRequests /> : null}
        {tab === "qr" ? <PreviewQr /> : null}
        {tab === "reports" ? <PreviewReports /> : null}
      </div>
    </div>
  );
}

function PreviewHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="lp-preview-greet">
      <strong>{title}</strong>
      <span>{sub}</span>
    </div>
  );
}

function PreviewOverview() {
  const max = Math.max(...PREVIEW_BARS);
  return (
    <>
      <div className="lp-preview-greet">
        <strong>Good morning, Mike.</strong>
        <span>
          <b>3 new Google reviews</b> since yesterday. Everything else is
          running on its own.
        </span>
      </div>
      <div className="lp-preview-stats">
        <div className="lp-pstat lp-pstat-hero">
          <small>Google rating</small>
          <strong>
            4.9 <Stars small />
          </strong>
          <em>▲ 0.3 in 90 days</em>
        </div>
        <div className="lp-pstat">
          <small>Reviews this month</small>
          <strong>35</strong>
          <em>41 last month</em>
        </div>
        <div className="lp-pstat">
          <small>Requests sent</small>
          <strong>43</strong>
          <em>88% automatic</em>
        </div>
        <div className="lp-pstat lp-pstat-hide-sm">
          <small>Review rate</small>
          <strong>
            36<span>%</span>
          </strong>
          <em>of customers asked</em>
        </div>
      </div>
      <div className="lp-preview-main">
        <div className="lp-preview-chart">
          <div className="lp-preview-chart-head">
            <strong>Reviews earned per week</strong>
            <span>last 12 weeks</span>
          </div>
          <div className="lp-preview-bars">
            {PREVIEW_BARS.map((value, index) => (
              <i
                key={index}
                style={{ height: `${Math.round((value / max) * 100)}%` }}
              />
            ))}
          </div>
        </div>
        <div className="lp-preview-feed">
          <strong>Live activity</strong>
          {[
            {
              icon: <StarIcon />,
              title: "New 5-star Google review",
              sub: "Maria G. “Fixed our water heater same day.”",
              hot: true,
            },
            {
              icon: <ChatIcon />,
              title: "Review request texted",
              sub: "James R. paid an invoice in Square",
            },
            {
              icon: <RefreshIcon />,
              title: "Reminder sent",
              sub: "Dana K. after 2 days",
            },
          ].map((row) => (
            <div
              key={row.title}
              className={`lp-feed-row${row.hot ? " is-hot" : ""}`}
            >
              <span className="lp-feed-icon">{row.icon}</span>
              <span>
                <b>{row.title}</b>
                <small>{row.sub}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const PREVIEW_CUSTOMERS = [
  {
    name: "Maria Gomez",
    contact: "(602) ***-1142",
    added: "Today",
    sms: true,
    email: true,
    clicked: "Opened",
    reviewed: true,
  },
  {
    name: "James Rivera",
    contact: "(602) ***-1168",
    added: "Today",
    sms: true,
    email: false,
    clicked: "Not yet",
    reviewed: false,
  },
  {
    name: "Dana Kim",
    contact: "(480) ***-2290",
    added: "Oct 5",
    sms: true,
    email: true,
    clicked: "Opened",
    reviewed: false,
  },
  {
    name: "Marcus Delgado",
    contact: "m***@gmail.com",
    added: "Oct 5",
    sms: false,
    email: true,
    clicked: "Opened",
    reviewed: true,
  },
  {
    name: "Nora Foster",
    contact: "(623) ***-0417",
    added: "Oct 4",
    sms: true,
    email: false,
    clicked: "Not yet",
    reviewed: false,
  },
  {
    name: "Hank Patel",
    contact: "(602) ***-7731",
    added: "Oct 3",
    sms: true,
    email: true,
    clicked: "Opened",
    reviewed: true,
  },
];

function PreviewCustomers() {
  return (
    <>
      <PreviewHead
        title="Customers"
        sub="Everyone we have asked for a review, and what happened next."
      />
      <div className="lp-pv-panel">
        <div className="lp-pv-panel-head">
          <strong>Customers</strong>
          <span>176 total</span>
        </div>
        <div className="lp-pv-table lp-pv-customers" role="table">
          <div className="lp-pv-row lp-pv-th" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader" className="lp-pv-hide-sm">
              Added
            </span>
            <span role="columnheader">Sent</span>
            <span role="columnheader" className="lp-pv-hide-sm">
              Clicked
            </span>
            <span role="columnheader">Reviewed</span>
          </div>
          {PREVIEW_CUSTOMERS.map((row) => (
            <div className="lp-pv-row" role="row" key={row.name}>
              <span role="cell" className="lp-pv-name">
                <b>{row.name}</b>
                <small>{row.contact}</small>
              </span>
              <span role="cell" className="lp-pv-hide-sm">
                {row.added}
              </span>
              <span role="cell" className="lp-pv-chips">
                {row.sms ? <i className="lp-pv-chip">SMS ×1</i> : null}
                {row.email ? <i className="lp-pv-chip">Email ×1</i> : null}
              </span>
              <span role="cell" className="lp-pv-hide-sm">
                <i
                  className={`lp-pv-chip${row.clicked === "Opened" ? " is-on" : ""}`}
                >
                  {row.clicked}
                </i>
              </span>
              <span role="cell">
                {row.reviewed ? (
                  <i className="lp-pv-chip is-good">Reviewed</i>
                ) : (
                  <i className="lp-pv-chip is-quiet">Waiting</i>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const PREVIEW_REQUESTS = [
  {
    when: "9:16 AM",
    name: "Maria Gomez",
    channel: "Text",
    type: "Request",
    from: "Square",
  },
  {
    when: "9:16 AM",
    name: "Maria Gomez",
    channel: "Email",
    type: "Request",
    from: "Square",
  },
  {
    when: "8:30 AM",
    name: "Dana Kim",
    channel: "Text",
    type: "Reminder",
    from: "Jobber",
  },
  {
    when: "Yesterday",
    name: "James Rivera",
    channel: "Text",
    type: "Request",
    from: "Jobber",
  },
  {
    when: "Yesterday",
    name: "Marcus Delgado",
    channel: "Email",
    type: "Request",
    from: "Added by you",
  },
  {
    when: "Oct 4",
    name: "Nora Foster",
    channel: "Text",
    type: "Request",
    from: "Square",
  },
];

function PreviewRequests() {
  return (
    <>
      <PreviewHead
        title="Requests"
        sub="Every text and email we send for you, and whether it went through."
      />
      <div className="lp-pv-panel">
        <div className="lp-pv-panel-head">
          <strong>Message log</strong>
          <span>323 messages</span>
          <span className="lp-pv-filters lp-pv-hide-sm" aria-hidden="true">
            <i className="is-on">All</i>
            <i>Texts</i>
            <i>Emails</i>
          </span>
        </div>
        <div className="lp-pv-table lp-pv-requests" role="table">
          <div className="lp-pv-row lp-pv-th" role="row">
            <span role="columnheader">When</span>
            <span role="columnheader">Customer</span>
            <span role="columnheader">Channel</span>
            <span role="columnheader" className="lp-pv-hide-sm">
              Type
            </span>
            <span role="columnheader" className="lp-pv-hide-sm">
              From
            </span>
            <span role="columnheader">Result</span>
          </div>
          {PREVIEW_REQUESTS.map((row, index) => (
            <div className="lp-pv-row" role="row" key={index}>
              <span role="cell" className="lp-pv-dim">
                {row.when}
              </span>
              <span role="cell" className="lp-pv-name">
                <b>{row.name}</b>
              </span>
              <span role="cell" className="lp-pv-channel">
                {row.channel === "Text" ? <ChatIcon /> : <MailIcon />}
                {row.channel}
              </span>
              <span role="cell" className="lp-pv-hide-sm">
                {row.type}
              </span>
              <span role="cell" className="lp-pv-hide-sm lp-pv-dim">
                {row.from}
              </span>
              <span role="cell">
                <i className="lp-pv-chip is-good">Sent</i>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Real QR codes (version 3, low error correction) for
// https://www.uptrendscaling.com/?qr=counter, ?qr=truck and ?qr=van. Each
// string is the 29 rows of the code, every row a base-36 number whose bits
// are the dark squares. Made with the "qrcode" package so the page doesn't
// have to ship it.
const PREVIEW_QR_CODES = [
  {
    name: "Front counter stand",
    made: "Made Aug 27",
    total: 39,
    week: 12,
    last: "1h ago",
    rows: "8uaiyn.4jetz5.6h3y3h.6haf6l.6g9lct.4j2wxt.8tz2pr.d8u8.75aofj.1u2ozj.58owa9.2sqziz.72ac8y.31wixr.1mjjrx.65czwj.6h995u.69aigr.1mtdn9.1netf.7h9wjd.148wh.8tbmfx.4jaln6.6h4r95.6gg6n5.6gp9u7.4jcvkr.8tzjaq",
  },
  {
    name: "Truck door",
    made: "Made Sep 16",
    total: 14,
    week: 10,
    last: "Yesterday",
    rows: "8ti073.4ilhs1.6hdobh.6gsvh9.6gefkt.4io0n5.8tz2pr.1648w.8bapc4.1v1x6x.4nnmiv.7hsxzm.1h4hxn.1daw9.61vcdn.3vx18q.8q9l9n.2x49cd.5en7xf.2iaj62.6h2ar4.rg9j.8u1umz.4j642i.6h9r00.6gmyhj.6h71dl.4j118y.8u4jsr",
  },
  {
    name: "Service van 3",
    made: "Made Oct 4",
    total: 6,
    week: 6,
    last: "3h ago",
    rows: "8ub88v.4jfsqp.6h3uxp.6hac0t.6g98pp.4j27nl.8tz2pr.cw74.75bqcv.69w73z.6217ch.324t3v.6dc22q.7izbvj.8quhp.74n5xf.7l8oma.5m5wcb.1nrsk5.1y6coz.80sxrt.td01.8tax5p.4izpqq.6hadiy.6gfu01.6gjnkf.4jcvkr.8u55ki",
  },
];

// Turns one of the strings above into an SVG path (one 1x1 square per dark
// module), with a 2-module quiet zone around it.
function qrPath(rows: string): { d: string; size: number } {
  const lines = rows.split(".");
  const size = lines.length;
  let d = "";
  lines.forEach((line, y) => {
    let value = BigInt(0);
    for (const ch of line) {
      value = value * BigInt(36) + BigInt(parseInt(ch, 36));
    }
    const bits = value.toString(2).padStart(size, "0");
    for (let x = 0; x < size; x++) {
      if (bits[x] === "1") d += `M${x + 2} ${y + 2}h1v1h-1z`;
    }
  });
  return { d, size: size + 4 };
}

function PreviewQr() {
  return (
    <>
      <PreviewHead
        title="QR codes"
        sub="Print a code, put it where customers pay or wait. Every scan lands on your Google review page."
      />
      <div className="lp-pv-qr-grid">
        {PREVIEW_QR_CODES.map((code) => {
          const { d, size } = qrPath(code.rows);
          return (
            <div className="lp-pv-panel lp-pv-qr" key={code.name}>
              <div className="lp-pv-qr-img">
                <svg
                  viewBox={`0 0 ${size} ${size}`}
                  role="img"
                  aria-label={`QR code: ${code.name}`}
                  shapeRendering="crispEdges"
                >
                  <rect width={size} height={size} fill="#fff" />
                  <path d={d} fill="#111" />
                </svg>
              </div>
              <strong>{code.name}</strong>
              <small>{code.made}</small>
              <div className="lp-pv-qr-stats">
                <span>
                  <em>Total scans</em>
                  <b>{code.total}</b>
                </span>
                <span className="lp-pv-hide-sm">
                  <em>Last 7 days</em>
                  <b>{code.week}</b>
                </span>
                <span>
                  <em>Last scanned</em>
                  <b>{code.last}</b>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const REPORT_BARS = [6, 8, 9, 10, 12, 11, 14, 15, 17, 18, 25, 28];

function PreviewReports() {
  const max = 30;
  const points = REPORT_BARS.map((value, index) => {
    const avg =
      REPORT_BARS.slice(Math.max(0, index - 2), index + 1).reduce(
        (sum, n) => sum + n,
        0,
      ) / Math.min(index + 1, 3);
    const x = ((index + 0.5) / REPORT_BARS.length) * 100;
    const y = 100 - (avg / max) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <>
      <PreviewHead
        title="Reports"
        sub="Your results over time, in plain numbers."
      />
      <div className="lp-preview-stats lp-pv-report-stats">
        {[
          ["Requests sent", "43", "74 last month"],
          ["Reminders sent", "8", "22 last month"],
          ["Links opened", "10", "32 last month"],
          ["QR scans", "17", "32 last month"],
          ["Google reviews", "35", "41 last month"],
        ].map(([label, value, foot], index) => (
          <div
            className={`lp-pstat${index === 4 ? " lp-pstat-hero" : ""}${index === 1 || index === 2 ? " lp-pstat-hide-sm" : ""}`}
            key={label}
          >
            <small>{label}</small>
            <strong>{value}</strong>
            <em>{foot}</em>
          </div>
        ))}
      </div>
      <div className="lp-preview-chart">
        <div className="lp-preview-chart-head">
          <strong>Requests sent per week</strong>
          <span>last 12 weeks</span>
        </div>
        <div className="lp-pv-chart-wrap">
          <div className="lp-preview-bars">
            {REPORT_BARS.map((value, index) => (
              <i
                key={index}
                style={{ height: `${Math.round((value / max) * 100)}%` }}
              />
            ))}
          </div>
          <svg
            className="lp-pv-trend"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline className="lp-pv-trend-halo" points={points.join(" ")} />
            <polyline points={points.join(" ")} />
          </svg>
        </div>
      </div>
    </>
  );
}

function StatCard({
  value,
  unit,
  label,
  children,
}: {
  value: string;
  unit: string;
  label: string;
  children: string;
}) {
  return (
    <article className="lp-stat">
      <small>{label}</small>
      <strong>
        {value}
        <span>{unit}</span>
      </strong>
      <p>{children}</p>
    </article>
  );
}

function StepCard({
  step,
  title,
  icon,
  children,
}: {
  step: string;
  title: string;
  icon: ReactNode;
  children: string;
}) {
  return (
    <article className="lp-panel lp-step">
      <div className="lp-step-top">
        <span className="lp-icon-tile">{icon}</span>
        <span className="lp-step-num">Step {step}</span>
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values);
  return (
    <div className="lp-minibars" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={index}
          style={{ height: `${Math.round((value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Stars({ small = false }: { small?: boolean }) {
  return (
    <span className={`lp-stars${small ? " is-small" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <StarIcon key={index} />
      ))}
    </span>
  );
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`lp-brand-mark${small ? " is-small" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 28 28">
        <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
      </svg>
    </span>
  );
}

function DecorativeQR() {
  const squares = [
    [1, 1, 5, 5],
    [17, 1, 5, 5],
    [1, 17, 5, 5],
    [8, 2, 2, 2],
    [11, 1, 2, 4],
    [7, 6, 3, 2],
    [12, 6, 2, 3],
    [16, 7, 5, 2],
    [4, 9, 3, 3],
    [9, 10, 2, 4],
    [13, 11, 4, 2],
    [18, 11, 3, 3],
    [2, 13, 2, 2],
    [6, 14, 4, 2],
    [11, 15, 3, 3],
    [16, 15, 2, 2],
    [19, 17, 3, 5],
    [6, 18, 3, 3],
    [10, 20, 5, 2],
    [14, 18, 2, 2],
  ];
  return (
    <svg
      className="lp-qr-code"
      viewBox="0 0 23 23"
      role="img"
      aria-label="QR code"
    >
      {squares.map(([x, y, w, h], index) => (
        <rect key={index} x={x} y={y} width={w} height={h} rx=".4" />
      ))}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h12m-5-5 5 5-5 5" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg className="lp-icon lp-check" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10 4 4 8-9" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="m3 5.5 7 5.5 7-5.5" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5 16 5v4.5c0 3.8-2.5 6.4-6 8-3.5-1.6-6-4.2-6-8V5l6-2.5Z" />
      <path d="m7 10 2 2 4-4" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg className="lp-icon lp-star" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2.4 2.84 5.75 6.35.92-4.6 4.48 1.09 6.32L12 16.88l-5.68 2.99 1.09-6.32-4.6-4.48 6.35-.92L12 2.4Z" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3h0a2 2 0 0 1-2-2v-6Z" />
    </svg>
  );
}
function InvoiceIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.5h10v15l-2.5-1.5-2.5 1.5-2.5-1.5L5 17.5v-15Z" />
      <path d="M8 7h4M8 10h4" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.5h-3.5" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M11 2.5 4.5 11H10l-1 6.5 6.5-8.5H10l1-6.5Z" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg className="lp-icon" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12" rx="2" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4" />
    </svg>
  );
}
