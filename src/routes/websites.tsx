import { createFileRoute } from "@tanstack/react-router";

import { SiteNav } from "../components/site-nav";
import { WEBSITE_DESIGNS, websiteDesignPath } from "../lib/website-designs";
import { CANONICAL_SITE_URL } from "../lib/site";

const PHONE_PREVIEWS = [
  {
    slug: "hvac",
    trade: "HVAC",
    name: "Desert Breeze HVAC",
    image: "/websites/phone-hvac.jpg",
  },
  {
    slug: "plumbing",
    trade: "Plumbing",
    name: "Copperline Plumbing",
    image: "/websites/phone-plumbing.jpg",
  },
  {
    slug: "landscaping",
    trade: "Landscaping",
    name: "Greenway Landscaping",
    image: "/websites/phone-landscaping.jpg",
  },
] as const;

export const Route = createFileRoute("/websites")({
  head: () => ({
    meta: [
      { title: "Websites for local businesses | UpTrend Scaling" },
      {
        name: "description",
        content:
          "Websites for local service businesses: $299 one-time to build. Optional maintenance is $99 a month for hosting, small updates and support. See live designs.",
      },
      {
        property: "og:title",
        content: "Websites for local businesses | UpTrend Scaling",
      },
      { property: "og:url", content: `${CANONICAL_SITE_URL}/websites` },
    ],
    links: [{ rel: "canonical", href: `${CANONICAL_SITE_URL}/websites` }],
  }),
  component: WebsitesPage,
});

function WebsitesPage() {
  return (
    <div className="site-shell">
      <SiteNav />

      <main className="legal-main ws-main">
        <div className="page-width ws-page">
          <section className="ws-hero">
            <p className="eyebrow">
              <span /> Websites for local businesses
            </p>
            <h1>A website that gets your phone ringing.</h1>
            <p className="ws-lead">
              We design and build it for you. You approve it before it goes
              live. <strong>$299, one time.</strong>
            </p>
            <div className="ws-actions">
              <a
                className="button button-primary ws-order"
                href="/start?website=build"
              >
                Order my website
              </a>
              <a className="button button-ghost" href="#designs">
                See live designs
              </a>
            </div>
            <p className="ws-points">
              <span>Built around your business</span>
              <span>Quote form and tap to call</span>
              <span>Optional upkeep $99/mo</span>
            </p>
          </section>

          <div className="ws-phones" aria-label="Example websites">
            {PHONE_PREVIEWS.map((phone) => (
              <a
                key={phone.slug}
                className="ws-phone"
                href={`/websites/${phone.slug}`}
              >
                <span className="ws-phone-frame">
                  <img
                    src={phone.image}
                    alt={`${phone.name} website on a phone`}
                    width={360}
                    height={780}
                    loading={phone.slug === "hvac" ? "eager" : "lazy"}
                  />
                </span>
                <span className="ws-phone-label">
                  {phone.trade}: try it live
                </span>
              </a>
            ))}
          </div>

          <h2 className="ws-heading" id="designs">
            See live designs
          </h2>
          <p className="ws-sub">
            Open any of these to try it on your phone or computer. Yours is
            built around your business, your colors and your photos.
          </p>
          <div className="ws-grid">
            {WEBSITE_DESIGNS.map((design) => (
              <article key={design.slug} className="ws-card">
                <a
                  className="ws-shot"
                  href={websiteDesignPath(design)}
                  aria-label={`Open the ${design.name} website design`}
                >
                  <img
                    src={design.image}
                    alt={`${design.name} website design`}
                    width={1200}
                    height={675}
                    loading="lazy"
                  />
                </a>
                <div className="ws-card-body">
                  <span className="ws-trade">{design.trade}</span>
                  <h3>{design.name}</h3>
                  <p>{design.blurb}</p>
                  <div className="ws-card-actions">
                    <a
                      className="button button-primary"
                      href={websiteDesignPath(design)}
                    >
                      View live site
                    </a>
                    <a
                      className="button button-ghost"
                      href="/start?website=build"
                    >
                      Get one like this
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <h2 className="ws-heading">What you get</h2>
          <ul className="ws-list">
            <li>
              A mobile-first design built around your business, with a request
              or quote form and tap-to-call buttons.
            </li>
            <li>You approve the design before it goes live.</li>
            <li>Secure hosting, served over HTTPS.</li>
            <li>
              Optional maintenance at $99 a month: hosting, small updates and
              email support. Cancel it any time, separately from anything else.
            </li>
            <li>
              No free trial on websites. You pay at checkout, and can add Google
              review automation too if you want it.
            </li>
          </ul>
          <p className="ws-fine">
            Details are in our <a href="/terms">Terms of Service</a>. Questions?
            Email{" "}
            <a href="mailto:hello@uptrendscaling.com">
              hello@uptrendscaling.com
            </a>
            .
          </p>
        </div>
      </main>
      <div className="ws-sticky">
        <a className="button button-primary" href="/start?website=build">
          Order my website, $299
        </a>
      </div>
    </div>
  );
}
