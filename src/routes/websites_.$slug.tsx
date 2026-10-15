import { createFileRoute, notFound } from "@tanstack/react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { CANONICAL_SITE_URL } from "../lib/site";
import { websiteDesignBySlug } from "../lib/website-designs";

// One sample website, opened on our own address. The sample itself is shown in
// a full-page frame under a slim UpTrend Scaling bar, so the address in the
// browser stays uptrendscaling.com/websites/<slug> and the sample's real
// address is never shown or linked.
export const Route = createFileRoute("/websites_/$slug")({
  loader: ({ params }) => {
    const design = websiteDesignBySlug(params.slug);
    if (!design) throw notFound();
    return { design };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.design.name ?? "Sample website"} | UpTrend Scaling` },
      { name: "robots", content: "noindex" },
      { property: "og:url", content: `${CANONICAL_SITE_URL}/websites` },
    ],
  }),
  component: SampleWebsitePage,
});

function SampleWebsitePage() {
  const { design } = Route.useLoaderData();
  return (
    <div className="demo-page">
      <header className="demo-bar">
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
        <p className="demo-note">
          Sample website: <strong>{design.name}</strong>
        </p>
        <div className="demo-actions">
          <a className="button button-ghost nav-cta" href="/websites">
            All samples
          </a>
          <a className="button button-primary nav-cta" href="/start?website=build">
            Get one like this
          </a>
          <ThemeToggle />
        </div>
      </header>
      <iframe
        className="demo-frame"
        title={`${design.name} sample website`}
        src={design.embedUrl}
        loading="eager"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
