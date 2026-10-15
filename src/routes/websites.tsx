import { createFileRoute } from "@tanstack/react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { WEBSITE_DESIGNS } from "../lib/website-designs";
import { CANONICAL_SITE_URL } from "../lib/site";

export const Route = createFileRoute("/websites")({
  head: () => ({
    meta: [
      { title: "Websites for local businesses | UpTrend Scaling" },
      {
        name: "description",
        content:
          "Websites for local service businesses: $299 one-time to build, $99 a month for hosting, small updates and support. See live designs.",
      },
      { property: "og:title", content: "Websites for local businesses | UpTrend Scaling" },
      { property: "og:url", content: `${CANONICAL_SITE_URL}/websites` },
    ],
    links: [{ rel: "canonical", href: `${CANONICAL_SITE_URL}/websites` }],
  }),
  component: WebsitesPage,
});

function WebsitesPage() {
  return (
    <div className="site-shell">
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

      <main className="legal-main">
        <div className="page-width ws-page">
          <p className="eyebrow">
            <span /> Websites
          </p>
          <h1>A website that makes your business look as good as your work.</h1>
          <p className="ws-lead">
            We design and build a clean, mobile-first website for your business.
            You approve it before it goes live. $299 one-time to build, and
            $99 a month if you want us to host it, make small updates and keep
            it running. Already have a site? Maintenance only is $99 a month.
          </p>
          <div className="ws-actions">
            <a className="button button-primary" href="/start?website=build">
              Order a website
            </a>
            <a className="button button-ghost" href="/start?website=maintenance">
              Maintenance only
            </a>
          </div>

          <h2 className="ws-heading">See live designs</h2>
          <p className="ws-sub">
            Open any of these to try it on your phone or computer. Yours is
            built around your business, your colors and your photos.
          </p>
          <div className="ws-grid">
            {WEBSITE_DESIGNS.map((design) => (
              <article key={design.slug} className="ws-card">
                <a
                  className="ws-shot"
                  href={design.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open the ${design.name} website in a new tab`}
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
                      href={design.liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View live site
                    </a>
                    <a className="button button-ghost" href="/start?website=build">
                      Get one like this
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <h2 className="ws-heading">What you get</h2>
          <ul className="ws-list">
            <li>A mobile-first design built around your business, with a request or quote form and tap-to-call buttons.</li>
            <li>You approve the design before it goes live.</li>
            <li>Secure hosting on Lovable's platform, served over HTTPS.</li>
            <li>Optional maintenance at $99 a month: hosting, small updates and email support. Cancel it any time, separately from anything else.</li>
            <li>No free trial on websites. You pay at checkout, and can add Google review automation too if you want it.</li>
          </ul>
          <p className="ws-fine">
            Details are in our <a href="/terms">Terms of Service</a>. Questions?
            Email <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
