// Shared shapes for the websites we build for customers. No server-only
// imports here, so the order form, the editor and the generator can all use it.

import { z } from "zod";

// The three looks a customer can pick from. They match the three live designs
// on the homepage: warm (Desert Breeze HVAC), copper (Copperline Plumbing) and
// green (Greenway Landscaping).
export const SITE_STYLES = ["warm", "copper", "green"] as const;
export type SiteStyle = (typeof SITE_STYLES)[number];

export const SITE_STYLE_INFO: Record<
  SiteStyle,
  { label: string; blurb: string; defaultAccent: string; example: string }
> = {
  warm: {
    label: "Warm and bold",
    blurb: "Sunset gradients, big serif headlines. Like Desert Breeze HVAC.",
    defaultAccent: "#e8872b",
    example: "/websites/desert-breeze-hvac.jpg",
  },
  copper: {
    label: "Dark and technical",
    blurb: "Dark panels, tall condensed headlines. Like Copperline Plumbing.",
    defaultAccent: "#d58f61",
    example: "/websites/copperline-plumbing.jpg",
  },
  green: {
    label: "Light and natural",
    blurb: "Warm cream, soft serif. Like Greenway Landscaping.",
    defaultAccent: "#b8532a",
    example: "/websites/greenway-landscaping.jpg",
  },
};

// The hands-on piece at the top of a site: a thermostat dial, a pressure gauge
// with a valve, a project planner, or none (just the quote form).
export const SITE_WIDGETS = ["dial", "gauge", "planner", "form"] as const;
export type SiteWidget = (typeof SITE_WIDGETS)[number];

export const TRADES = [
  "HVAC",
  "Plumbing",
  "Landscaping",
  "Electrical",
  "Roofing",
  "Cleaning",
  "Pest control",
  "Auto services",
  "Painting",
  "Handyman",
  "Salon or barber",
  "Photography",
  "Restaurant",
  "Other",
] as const;

// Statements a customer can tick. The site only says what they ticked, so we
// never claim a license, a warranty or 24/7 service they did not tell us about.
export const HIGHLIGHTS = [
  { id: "free_estimates", label: "Free estimates", badge: "Free estimates" },
  {
    id: "licensed",
    label: "Licensed and insured",
    badge: "Licensed and insured",
  },
  {
    id: "emergency",
    label: "Emergency or 24/7 service",
    badge: "Emergency service",
  },
  { id: "family", label: "Family owned", badge: "Family owned" },
  { id: "same_day", label: "Same-day service", badge: "Same-day service" },
  { id: "warranty", label: "Work is guaranteed", badge: "Work guaranteed" },
  { id: "upfront", label: "Upfront pricing", badge: "Upfront pricing" },
  { id: "veteran", label: "Veteran owned", badge: "Veteran owned" },
] as const;
export type HighlightId = (typeof HIGHLIGHTS)[number]["id"];

// Most pictures one site can hold.
export const MAX_SITE_PHOTOS = 24;

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #2457ff");

export const briefSchema = z.object({
  businessName: z.string().trim().min(1).max(80),
  trade: z.string().trim().min(1).max(60),
  city: z.string().trim().min(1).max(60),
  state: z.string().trim().max(30).default(""),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(120),
  services: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
  serviceArea: z.string().trim().max(240).default(""),
  yearsInBusiness: z.number().int().min(0).max(150).nullable().default(null),
  highlights: z.array(z.string().max(30)).max(10).default([]),
  about: z.string().trim().max(1200).default(""),
  specialRequests: z.string().trim().max(1200).default(""),
  hours: z.string().trim().max(120).default(""),
  style: z.enum(SITE_STYLES).default("warm"),
  accent: hex.default("#2457ff"),
  logoId: z.string().uuid().nullable().default(null),
  photoIds: z.array(z.string().uuid()).max(MAX_SITE_PHOTOS).default([]),
});
export type SiteBrief = z.infer<typeof briefSchema>;

const line = (max: number) => z.string().trim().max(max);
const titled = z.object({ title: line(90), text: line(420) });

// What the template draws. Everything on the page comes from here, so the
// editor only ever changes this object.
export const contentSchema = z.object({
  style: z.enum(SITE_STYLES),
  accent: hex,
  brand: z.object({
    name: line(80),
    phone: line(30),
    email: line(120),
    city: line(60),
    state: line(30),
    hours: line(120).default(""),
    tagline: line(120).default(""),
    logoId: z.string().uuid().nullable().default(null),
  }),
  hero: z.object({
    eyebrow: line(80),
    headline: line(110),
    // The last words of the headline, shown in the accent color.
    headlineAccent: line(70).default(""),
    sub: line(320),
    primaryCta: line(30),
    secondaryCta: line(30),
    imageId: z.string().uuid().nullable().default(null),
    widget: z.enum(SITE_WIDGETS).default("planner"),
  }),
  badges: z.array(line(40)).max(6).default([]),
  stats: z
    .array(z.object({ value: line(20), label: line(50) }))
    .max(4)
    .default([]),
  servicesTitle: line(90),
  servicesIntro: line(260).default(""),
  services: z.array(titled).min(1).max(10),
  processTitle: line(90),
  process: z.array(titled).min(2).max(5),
  whyTitle: line(90),
  why: z.array(titled).min(2).max(6),
  about: z.object({ title: line(90), body: line(1400) }),
  areasTitle: line(90),
  areas: z.array(line(60)).max(24).default([]),
  gallery: z.array(z.string().uuid()).max(MAX_SITE_PHOTOS).default([]),
  // "grid" is a plain set of thumbnails. "reel" is the photo showcase: a full
  // screen photo opening, then a strip of photos that slides sideways as the
  // visitor scrolls down. Made for photographers.
  galleryStyle: z.enum(["grid", "reel"]).default("grid"),
  galleryTitle: line(90).default(""),
  faqTitle: line(90),
  faq: z
    .array(z.object({ q: line(160), a: line(600) }))
    .max(8)
    .default([]),
  cta: z.object({ title: line(110), text: line(240), button: line(30) }),
  // Extra sections added in the editor. kind "text" is a heading and a
  // paragraph, "list" is a heading with a bullet list, "banner" is a colored
  // call-out with a button that calls.
  extras: z
    .array(
      z.object({
        id: z.string().max(40),
        kind: z.enum(["text", "list", "banner"]),
        title: line(110),
        body: line(1600).default(""),
        items: z.array(line(160)).max(14).default([]),
        // Where it sits: before this section id, or "end".
        placement: z
          .enum([
            "after_hero",
            "after_services",
            "after_why",
            "after_faq",
            "end",
          ])
          .default("after_services"),
      }),
    )
    .max(8)
    .default([]),
  seo: z.object({ title: line(80), description: line(170) }),
});
export type SiteContent = z.infer<typeof contentSchema>;

export const DOMAIN_FREE_DAYS = 7;

// "Sunrise Plumbing & Air" in "Phoenix" -> "sunrise-plumbing-air"
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return base || "site";
}

// Phone as shown and as a tel: link.
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

// Domains we accept for a customer's own address. Lowercase, no scheme, no path.
export function cleanDomain(input: string): string | null {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})*\.[a-z]{2,24}$/.test(
    value,
  )
    ? value
    : null;
}
