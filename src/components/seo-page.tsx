import type { ReactNode } from "react";

import { SiteNav } from "./site-nav";

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
      <SiteNav />
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
