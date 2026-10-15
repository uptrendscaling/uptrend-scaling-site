import type { ReactNode } from "react";

import { ThemeToggle } from "./theme-toggle";

// Shared frame for the plain search-landing pages (/get-a-website-built-for-you
// and /website-for/<trade>): the same slim header as /websites, a content
// column, and a footer with links to the other pages so search engines (and
// people) can walk from one to the next.

export type FaqEntry = { q: string; a: string };

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function faqSchema(items: ReadonlyArray<FaqEntry>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function SeoPageShell({ children }: { children: ReactNode }) {
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
            <a className="button button-primary nav-cta" href="/start?website=build">
              Order a website
            </a>
          </div>
        </div>
      </header>
      <main className="legal-main">
        <div className="page-width ws-page">{children}</div>
      </main>
      <footer className="seo-foot">
        <nav aria-label="More from UpTrend Scaling">
          <a href="/">Home</a>
          <a href="/websites">Website samples</a>
          <a href="/get-a-website-built-for-you">Get a website built for you</a>
          <a href="/website-for/hvac-companies">Websites for HVAC companies</a>
          <a href="/website-for/plumbers">Websites for plumbers</a>
          <a href="/website-for/landscapers">Websites for landscapers</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
        <p>© 2026 UpTrend Scaling, LLC. hello@uptrendscaling.com</p>
      </footer>
    </div>
  );
}

export function FaqList({ items }: { items: ReadonlyArray<FaqEntry> }) {
  return (
    <div className="seo-faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
