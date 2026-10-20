import { createFileRoute, notFound } from "@tanstack/react-router";

import { SiteNav } from "../components/site-nav";
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
      { title: `${loaderData?.design.name ?? "Website design"} | UpTrend Scaling` },
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
      <SiteNav />
      <header className="demo-bar">
        <p className="demo-note">
          Live design: <strong>{design.name}</strong>
        </p>
        <div className="demo-actions">
          <a className="button button-ghost nav-cta" href="/websites">
            All designs
          </a>
          <a className="button button-primary nav-cta" href="/start?website=build">
            Get one like this
          </a>
        </div>
      </header>
      <iframe
        className="demo-frame"
        title={`${design.name} website design`}
        src={design.embedUrl}
        loading="eager"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
