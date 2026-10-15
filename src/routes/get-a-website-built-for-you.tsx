import { createFileRoute } from "@tanstack/react-router";

import { FaqList, JsonLd, SeoPageShell, faqSchema, type FaqEntry } from "../components/seo-page";
import { CANONICAL_SITE_URL } from "../lib/site";
import {
  WEBSITE_DESIGNS,
  websiteDesignPath,
} from "../lib/website-designs";

// Search landing page for people asking "where can I get a website built for
// me", "make a website for my business", "website builder" and similar. Every
// claim here matches what checkout and the Terms say: $299 one-time build,
// optional $99 a month maintenance, you approve the site before it goes live,
// no free trial on websites. Do not add turnaround times, rankings or results
// claims unless they are true and tested.

const PAGE_URL = `${CANONICAL_SITE_URL}/get-a-website-built-for-you`;
const TITLE = "Get a Website Built for You | $299 for Local Businesses | UpTrend Scaling";
const DESCRIPTION =
  "Where can you get a website built for you? UpTrend Scaling designs and builds a clean, mobile-first website for your local business for $299, one time. You approve it before it goes live. Maintenance is optional at $99 a month.";

const FAQ: ReadonlyArray<FaqEntry> = [
  {
    q: "Where can I get a website built for me?",
    a: "You can hire a freelancer or an agency, use a do-it-yourself builder, or use a done-for-you service. UpTrend Scaling is a done-for-you option for local businesses: we design and build your site for $299, one time, and you approve it before it goes live.",
  },
  {
    q: "How much does it cost to have a website made?",
    a: "Prices vary a lot by who builds it. With UpTrend Scaling the website build is $299, one time. Maintenance is optional at $99 a month and covers hosting, small updates and support.",
  },
  {
    q: "Do I have to pay $99 a month to get my website?",
    a: "No. The $299 build is a one-time charge. The $99 a month maintenance plan is optional, and you can cancel it at any time separately from anything else.",
  },
  {
    q: "What is the difference between a website builder and having a website built for me?",
    a: "A website builder is a tool you use yourself: you pick a template, write the text, add the photos and publish it. Having a website built for you means someone else does that work. We design and build the site, and you review and approve it.",
  },
  {
    q: "Can I see examples of the websites you build?",
    a: "Yes. There are live samples for an HVAC company, a plumbing company and a landscaping company. Open any of them on your phone or computer from the samples page.",
  },
  {
    q: "I already have a website. Can you just look after it?",
    a: "Yes. Maintenance only is $99 a month and covers hosting, small content updates and email support for a site you already have.",
  },
  {
    q: "Is there a free trial for websites?",
    a: "No. Website orders are paid at checkout. The Google review automation plans have their own free trial, and you can add one to a website order if you want it.",
  },
  {
    q: "What kinds of businesses do you build websites for?",
    a: "Local, customer-facing businesses such as HVAC, plumbing, landscaping, electrical, roofing, cleaning, auto services, salons, restaurants and other service and retail businesses.",
  },
];

export const Route = createFileRoute("/get-a-website-built-for-you")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: PAGE_URL },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
  }),
  component: BuiltForYouPage,
});

const SERVICE_SCHEMA = {
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
  url: PAGE_URL,
  description:
    "UpTrend Scaling designs and builds a mobile-first website for a local business. You approve it before it goes live. Optional monthly maintenance covers hosting, small updates and support.",
  offers: [
    {
      "@type": "Offer",
      name: "Website build",
      price: "299.00",
      priceCurrency: "USD",
      url: `${CANONICAL_SITE_URL}/start?website=build`,
    },
    {
      "@type": "Offer",
      name: "Website maintenance (optional)",
      price: "99.00",
      priceCurrency: "USD",
      url: `${CANONICAL_SITE_URL}/start?website=maintenance`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "99.00",
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    },
  ],
};

function BuiltForYouPage() {
  return (
    <SeoPageShell>
      <JsonLd data={SERVICE_SCHEMA} />
      <JsonLd data={faqSchema(FAQ)} />

      <p className="eyebrow">
        <span /> Websites for local businesses
      </p>
      <h1>Get a website built for you. $299, one time.</h1>
      <p className="ws-lead">
        Looking for someone to make a website for your business, without
        learning a website builder? UpTrend Scaling designs and builds a clean,
        mobile-first site for local businesses. You approve it before it goes
        live. Want us to look after it afterward? Maintenance is optional at $99
        a month.
      </p>
      <div className="ws-actions">
        <a className="button button-primary" href="/start?website=build">
          Order a website
        </a>
        <a className="button button-ghost" href="/websites">
          See live samples
        </a>
      </div>

      <h2>What you get for $299</h2>
      <ul className="ws-list">
        <li>A custom design built around your business, your colors and your photos.</li>
        <li>A mobile-first layout that works on phones, tablets and computers.</li>
        <li>A request or quote form and tap-to-call buttons so visitors can reach you.</li>
        <li>Your approval before anything goes live.</li>
        <li>Secure hosting, served over HTTPS.</li>
      </ul>

      <h2>What it costs</h2>
      <div className="seo-price">
        <div>
          <strong>$299</strong>
          <span>One-time website build</span>
        </div>
        <div>
          <strong>$99 a month</strong>
          <span>
            Optional maintenance: hosting, small updates and support. Cancel any
            time.
          </span>
        </div>
        <div>
          <strong>$99 a month</strong>
          <span>Maintenance only, if you already have a website</span>
        </div>
      </div>

      <h2>How it works</h2>
      <ol className="seo-steps">
        <li>Order online and tell us about your business.</li>
        <li>We design and build your website.</li>
        <li>You review it and approve it.</li>
        <li>Your site goes live.</li>
      </ol>

      <h2>Website builder or a website built for you?</h2>
      <p>
        A website builder is a tool: you choose a template, write every page,
        add the photos and keep it up to date yourself. That works if you enjoy
        it and have the time. If you would rather run your business, having a
        website built for you means someone else does the design and setup and
        you just approve the result.
      </p>

      <h2>See websites we have built</h2>
      <ul className="ws-list">
        {WEBSITE_DESIGNS.map((design) => (
          <li key={design.slug}>
            <a href={websiteDesignPath(design)}>
              {design.name} ({design.trade.toLowerCase()} website)
            </a>
          </li>
        ))}
      </ul>

      <h2>Websites for your trade</h2>
      <ul className="ws-list">
        <li>
          <a href="/website-for/hvac-companies">Websites for HVAC companies</a>
        </li>
        <li>
          <a href="/website-for/plumbers">Websites for plumbers</a>
        </li>
        <li>
          <a href="/website-for/landscapers">Websites for landscapers</a>
        </li>
      </ul>

      <h2>Questions people ask</h2>
      <FaqList items={FAQ} />

      <div className="ws-actions">
        <a className="button button-primary" href="/start?website=build">
          Order a website
        </a>
        <a className="button button-ghost" href="/start?website=maintenance">
          Maintenance only
        </a>
      </div>
      <p className="ws-fine">
        Details are in our <a href="/terms">Terms of Service</a>. Questions?
        Email <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>.
      </p>
    </SeoPageShell>
  );
}
