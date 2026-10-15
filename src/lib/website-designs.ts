// The three example websites shown on the homepage and on /websites. Each one
// is a live page on Lovable's hosting (see ../routes/websites.tsx) with a
// compressed screenshot in public/websites/.
export type WebsiteDesign = {
  slug: string;
  trade: string;
  name: string;
  blurb: string;
  liveUrl: string;
  image: string;
};

export const WEBSITE_DESIGNS: ReadonlyArray<WebsiteDesign> = [
  {
    slug: "hvac",
    trade: "HVAC",
    name: "Desert Breeze HVAC",
    blurb:
      "Service grid, a simple three-step process, and a quote request form with tap-to-call.",
    liveUrl: "https://desert-breeze-hvac-sample.lovable.app",
    image: "/websites/desert-breeze-hvac.jpg",
  },
  {
    slug: "plumbing",
    trade: "Plumbing",
    name: "Copperline Plumbing",
    blurb:
      "High-contrast design with clear services, trust points, a service area and a request form.",
    liveUrl: "https://copperline-plumbing-sample.lovable.app",
    image: "/websites/copperline-plumbing.jpg",
  },
  {
    slug: "landscaping",
    trade: "Landscaping",
    name: "Greenway Landscaping",
    blurb:
      "Warm, desert-inspired look with services, a project process, credentials and an estimate form.",
    liveUrl: "https://greenway-landscaping-sample.lovable.app",
    image: "/websites/greenway-landscaping.jpg",
  },
];
