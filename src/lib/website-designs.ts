// The three example websites shown on the homepage and on /websites. Each one
// opens on our own address (/websites/<slug>, see ../routes/websites_.$slug.tsx),
// which shows the live sample inside an UpTrend Scaling frame, so visitors only
// ever see uptrendscaling.com. embedUrl is the sample's real address and is
// never shown as text or used as a link. A compressed screenshot for each is in
// public/websites/.
export type WebsiteDesign = {
  slug: string;
  trade: string;
  name: string;
  blurb: string;
  embedUrl: string;
  image: string;
};

export const WEBSITE_DESIGNS: ReadonlyArray<WebsiteDesign> = [
  {
    slug: "hvac",
    trade: "HVAC",
    name: "Desert Breeze HVAC",
    blurb:
      "Service grid, a simple three-step process, and a quote request form with tap-to-call.",
    embedUrl: "https://desert-breeze-hvac-sample.lovable.app",
    image: "/websites/desert-breeze-hvac.jpg",
  },
  {
    slug: "plumbing",
    trade: "Plumbing",
    name: "Copperline Plumbing",
    blurb:
      "High-contrast design with clear services, trust points, a service area and a request form.",
    embedUrl: "https://copperline-plumbing-sample.lovable.app",
    image: "/websites/copperline-plumbing.jpg",
  },
  {
    slug: "landscaping",
    trade: "Landscaping",
    name: "Greenway Landscaping",
    blurb:
      "Warm, desert-inspired look with services, a project process, credentials and an estimate form.",
    embedUrl: "https://greenway-landscaping-sample.lovable.app",
    image: "/websites/greenway-landscaping.jpg",
  },
];

export function websiteDesignBySlug(slug: string): WebsiteDesign | undefined {
  return WEBSITE_DESIGNS.find((design) => design.slug === slug);
}

// The address visitors open to look at a sample.
export function websiteDesignPath(design: WebsiteDesign): string {
  return `/websites/${design.slug}`;
}
