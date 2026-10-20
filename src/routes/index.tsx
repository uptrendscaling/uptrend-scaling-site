import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  MONTHLY_PRICE_CENTS,
  PLAN_TIERS,
  SETUP_FEE_CENTS,
  TRIAL_DAYS,
  formatUsd,
} from "../lib/pricing";
import { CANONICAL_SITE_URL } from "../lib/site";
import { WEBSITE_DESIGNS } from "../lib/website-designs";
import homeCss from "../home.css?url";
import { buildHomeHtml } from "../lib/home-markup";
import { initHome } from "../lib/home-client";

const START_TRIAL = "/start?plan=trial";

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
    answer: `There are three plans, all priced per location per month: ${PLAN_TIERS.map((t) => `${t.name} ${formatUsd(t.priceCents)} (up to ${t.monthlyRequests.toLocaleString("en-US")} review requests a month)`).join(", ")}. Every plan includes every feature, plus a one-time ${formatUsd(SETUP_FEE_CENTS)} setup fee. It's month-to-month with no long-term contract, and you can cancel anytime.`,
  },
  {
    question: "Can you build a website for my business?",
    answer:
      "Yes. We design and build a clean, mobile-first website for local businesses for $299, one time, and you approve it before it goes live. You can open live designs for HVAC, plumbing and landscaping businesses on our websites page.",
  },
  {
    question: "Do I have to pay $99 a month to get a website?",
    answer:
      "No. The $299 website build is a one-time charge. Website maintenance is optional at $99 a month and covers hosting, small updates and email support. If you already have a site, you can order maintenance on its own.",
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
  description:
    "UpTrend Scaling builds websites for local businesses and automates Google review requests by SMS and email.",
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

const WEBSITE_SERVICE_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Done-for-you website design and build for local businesses",
  serviceType: "Web design",
  provider: {
    "@type": "Organization",
    name: "UpTrend Scaling",
    url: CANONICAL_SITE_URL,
  },
  areaServed: { "@type": "Country", name: "United States" },
  url: `${CANONICAL_SITE_URL}/get-a-website-built-for-you`,
  description:
    "We design and build a mobile-first website for a local business for a one-time $299. Optional maintenance is $99 a month.",
  offers: {
    "@type": "Offer",
    price: "299.00",
    priceCurrency: "USD",
    url: `${CANONICAL_SITE_URL}/start?website=build`,
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
      {
        title:
          "UpTrend Scaling | Websites Built for You and Google Review Automation",
      },
      {
        name: "description",
        content:
          "Need a website built for you? We design and build one for local businesses for $299, and also automate Google review requests by SMS and email, with reminders, QR codes and simple reporting.",
      },
      {
        property: "og:title",
        content:
          "UpTrend Scaling | Websites and Google reviews for local businesses",
      },
      {
        property: "og:description",
        content:
          "Websites built for you ($299) and Google review automation for local businesses and owner-operators.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: CANONICAL_SITE_URL },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE_URL },
    ],
    links: [
      { rel: "canonical", href: CANONICAL_SITE_URL },
      { rel: "stylesheet", href: homeCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap",
      },
    ],
  }),
  component: Index,
});

// Homepage, remodeled 2026-10-20: websites first (live site builder, the three
// designs, a price builder), then the Google review tool. The page itself is
// plain markup built in ../lib/home-markup.ts, styled by ../home.css (every
// rule scoped under .uh so no other page is affected) and brought to life by
// ../lib/home-client.ts. Search data (the JSON-LD below) and the FAQ text are
// unchanged and still come from the constants above. Colby asked for no
// "example", "sample" or "illustrative" wording anywhere in the previews.

const HOME_HTML = buildHomeHtml({
  trial: TRIAL_DAYS,
  setup: formatUsd(SETUP_FEE_CENTS),
  starter: formatUsd(MONTHLY_PRICE_CENTS),
  startTrial: START_TRIAL,
  faq: FAQ_ITEMS,
});

// Numbers the page script needs (plans, trial length, setup fee) so the price
// builder always matches checkout.
const HOME_CONFIG = JSON.stringify({
  trial: TRIAL_DAYS,
  setup: SETUP_FEE_CENTS / 100,
  tiers: PLAN_TIERS.map((tier) => ({
    id: tier.id,
    n: tier.name,
    p: tier.priceCents / 100,
    r: tier.monthlyRequests.toLocaleString("en-US"),
  })),
  designs: WEBSITE_DESIGNS.map((design) => ({
    slug: design.slug,
    name: design.name,
    trade: design.trade,
  })),
});

function Index() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".uh");
    if (!root) return;
    return initHome(root);
  }, []);

  return (
    <>
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
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(WEBSITE_SERVICE_SCHEMA),
        }}
      />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />
      <div
        id="top"
        className="uh"
        data-cfg={HOME_CONFIG}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: HOME_HTML }}
      />
    </>
  );
}
