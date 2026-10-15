import { createFileRoute, notFound } from "@tanstack/react-router";

import { FaqList, JsonLd, SeoPageShell, faqSchema, type FaqEntry } from "../components/seo-page";
import { CANONICAL_SITE_URL } from "../lib/site";
import { websiteDesignBySlug, websiteDesignPath } from "../lib/website-designs";

// One search landing page per trade: /website-for/hvac-companies,
// /website-for/plumbers, /website-for/landscapers. Each has its own wording,
// questions and sample, so they are not copies of each other. Add a trade by
// adding an entry here and a line in public/sitemap.xml and the footer list in
// ../components/seo-page.tsx.

type Trade = {
  slug: string;
  who: string; // "HVAC companies"
  single: string; // "HVAC company"
  yourBusiness: string; // "your HVAC company"
  sampleSlug: string;
  intro: string;
  lookFor: string[];
  includes: string[];
  faq: FaqEntry[];
};

const TRADES: Record<string, Trade> = {
  "hvac-companies": {
    slug: "hvac-companies",
    who: "HVAC companies",
    single: "HVAC company",
    yourBusiness: "your HVAC company",
    sampleSlug: "hvac",
    intro:
      "When a unit quits in July, homeowners search on their phone and call the first company that looks real. A clean website with your services, your service area and a tap-to-call button is how you get that call. We design and build it for you for $299, one time.",
    lookFor: [
      "A big tap-to-call number, because most HVAC searches happen on a phone.",
      "Clear services: repair, installation, maintenance and emergency service.",
      "Your service area, so people know you cover their town.",
      "Trust points like licensed and insured, and upfront pricing.",
      "A quick quote request form for customers who would rather type.",
    ],
    includes: [
      "A service grid for repair, installation and maintenance",
      "A simple three-step process section",
      "A quote request form and tap-to-call buttons",
      "Your logo, colors and photos",
    ],
    faq: [
      {
        q: "How much is a website for an HVAC company?",
        a: "The website build is $299, one time. Maintenance is optional at $99 a month and covers hosting, small updates and support.",
      },
      {
        q: "Can I see an HVAC website you built?",
        a: "Yes. Open the Desert Breeze HVAC sample from this page to try it on your phone or computer.",
      },
      {
        q: "Do I have to sign up for monthly maintenance?",
        a: "No. The build is a one-time charge, and maintenance is an optional add-on you can cancel at any time.",
      },
    ],
  },
  plumbers: {
    slug: "plumbers",
    who: "plumbers",
    single: "plumber",
    yourBusiness: "your plumbing business",
    sampleSlug: "plumbing",
    intro:
      "A burst pipe does not wait. People search for a plumber in a hurry, on a phone, and pick the one that looks trustworthy and is easy to call. We design and build a website that does exactly that for $299, one time, and you approve it before it goes live.",
    lookFor: [
      "A call button that is always in reach on a phone.",
      "Clear services, from drain cleaning to water heaters to emergency repairs.",
      "Your service area and the hours you answer.",
      "Trust points like licensed, insured and upfront pricing.",
      "A simple request form for jobs that are not urgent.",
    ],
    includes: [
      "A high-contrast layout that is easy to read on a phone",
      "Service, trust and service area sections",
      "A service request form and tap-to-call buttons",
      "Your logo, colors and photos",
    ],
    faq: [
      {
        q: "How much does a plumber website cost?",
        a: "The website build is $299, one time. Maintenance is optional at $99 a month and covers hosting, small updates and support.",
      },
      {
        q: "Can I see a plumbing website you built?",
        a: "Yes. Open the Copperline Plumbing sample from this page to try it on your phone or computer.",
      },
      {
        q: "Can you build the site if I already have a logo and photos?",
        a: "Yes. Your site is built around your business, your colors and your photos.",
      },
    ],
  },
  landscapers: {
    slug: "landscapers",
    who: "landscapers",
    single: "landscaper",
    yourBusiness: "your landscaping business",
    sampleSlug: "landscaping",
    intro:
      "Landscaping is a visual business, and homeowners judge you by how your own site looks before they ever ask for an estimate. We design and build a clean, photo-friendly website for $299, one time, and you approve it before it goes live.",
    lookFor: [
      "Big, good-looking photos of your finished work.",
      "Clear services: design, installation, maintenance and more.",
      "A simple project process so customers know what to expect.",
      "Credentials and the areas you serve.",
      "An easy estimate request form.",
    ],
    includes: [
      "A warm, photo-forward design",
      "Service, process and credentials sections",
      "An estimate request form and tap-to-call buttons",
      "Your logo, colors and photos",
    ],
    faq: [
      {
        q: "How much does a landscaping website cost?",
        a: "The website build is $299, one time. Maintenance is optional at $99 a month and covers hosting, small updates and support.",
      },
      {
        q: "Can I see a landscaping website you built?",
        a: "Yes. Open the Greenway Landscaping sample from this page to try it on your phone or computer.",
      },
      {
        q: "Can I add new photos later?",
        a: "Small updates such as text and photos are covered by the optional $99 a month maintenance plan.",
      },
    ],
  },
};

export const Route = createFileRoute("/website-for/$trade")({
  loader: ({ params }) => {
    const trade = TRADES[params.trade];
    if (!trade) throw notFound();
    return { trade };
  },
  head: ({ loaderData }) => {
    const trade = loaderData?.trade;
    if (!trade) return {};
    const url = `${CANONICAL_SITE_URL}/website-for/${trade.slug}`;
    const title = `Website for ${trade.who} | Built for You for $299 | UpTrend Scaling`;
    const description = `A website built for ${trade.who}. UpTrend Scaling designs and builds a mobile-first site for $299, one time. You approve it before it goes live. Optional maintenance is $99 a month.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: TradePage,
});

function TradePage() {
  const { trade } = Route.useLoaderData();
  const sample = websiteDesignBySlug(trade.sampleSlug);
  const url = `${CANONICAL_SITE_URL}/website-for/${trade.slug}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Website design and build for ${trade.who}`,
    serviceType: "Web design",
    provider: { "@type": "Organization", name: "UpTrend Scaling", url: CANONICAL_SITE_URL },
    areaServed: { "@type": "Country", name: "United States" },
    url,
    offers: {
      "@type": "Offer",
      price: "299.00",
      priceCurrency: "USD",
      url: `${CANONICAL_SITE_URL}/start?website=build`,
    },
  };

  return (
    <SeoPageShell>
      <JsonLd data={schema} />
      <JsonLd data={faqSchema(trade.faq)} />

      <p className="eyebrow">
        <span /> Websites for {trade.who}
      </p>
      <h1>A website for {trade.yourBusiness}, built for you.</h1>
      <p className="ws-lead">{trade.intro}</p>
      <div className="ws-actions">
        <a className="button button-primary" href="/start?website=build">
          Order a website, $299
        </a>
        {sample ? (
          <a className="button button-ghost" href={websiteDesignPath(sample)}>
            See a live sample
          </a>
        ) : null}
      </div>

      <h2>What customers look for on a {trade.single} website</h2>
      <ul className="ws-list">
        {trade.lookFor.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2>What your site includes</h2>
      <ul className="ws-list">
        {trade.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
        <li>Your approval before it goes live</li>
      </ul>

      <h2>What it costs</h2>
      <div className="seo-price">
        <div>
          <strong>$299</strong>
          <span>One-time website build</span>
        </div>
        <div>
          <strong>$99 a month</strong>
          <span>Optional maintenance: hosting, small updates and support</span>
        </div>
      </div>

      <h2>Questions</h2>
      <FaqList items={trade.faq} />

      <p className="ws-fine">
        More: <a href="/get-a-website-built-for-you">how getting a website built for you works</a>,{" "}
        <a href="/websites">all website samples</a>. Questions? Email{" "}
        <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>.
      </p>
    </SeoPageShell>
  );
}
