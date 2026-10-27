// Turns what a customer typed into the text and settings a site is drawn from.
//
// Two layers, so a paid order can never get stuck:
//   1. buildFallbackContent: plain, honest copy built straight from their
//      answers. Needs nothing but the form.
//   2. writeContentWithAi: when ANTHROPIC_API_KEY is set, Claude rewrites the
//      words so the site reads like it was written for that business. If the
//      call fails or returns something unusable, layer 1 is kept.
//
// The AI is told never to invent numbers, reviews, awards, licenses or prices.
// Anything like that only appears when the customer ticked or typed it.

import {
  HIGHLIGHTS,
  MAX_SITE_PHOTOS,
  contentSchema,
  type SiteBrief,
  type SiteContent,
} from "./types";
import { widgetForTrade } from "./widgets";

// ---- Small helpers ----------------------------------------------------------

// Customers' sites should not read as machine-written, and Colby's rule is no
// em dashes anywhere, so strip them (and double hyphens) from every string.
export function cleanText(value: string): string {
  return value
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s*--+\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanDeep<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cleanDeep(v);
    }
    return out as T;
  }
  return value;
}

function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// How the trade reads in a sentence ("plumbing", "heating and cooling").
function tradeNoun(trade: string): string {
  const t = trade.trim().toLowerCase();
  if (t === "hvac") return "heating and cooling";
  if (t === "salon or barber") return "hair care";
  if (t === "auto services") return "auto service";
  if (t === "other") return "service";
  if (t === "photography") return "photography";
  return t;
}

// Trades whose work is best shown as a lot of photos.
export function isVisualTrade(trade: string): boolean {
  return /photograph|videograph|cinemat|film/i.test(trade);
}

function badgesFor(brief: SiteBrief): string[] {
  return HIGHLIGHTS.filter((h) => brief.highlights.includes(h.id)).map(
    (h) => h.badge,
  );
}

function areasFrom(brief: SiteBrief): string[] {
  const parsed = brief.serviceArea
    .split(/[,\n;]+|\s+and\s+|\s+&\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24);
  return parsed.length > 0 ? parsed : [brief.city];
}

// ---- Layer 1: copy straight from the form ------------------------------------

export function buildFallbackContent(brief: SiteBrief): SiteContent {
  const noun = tradeNoun(brief.trade);
  const where = brief.state ? `${brief.city}, ${brief.state}` : brief.city;
  const badges = badgesFor(brief);
  const hasSameDay = brief.highlights.includes("same_day");
  const hasEmergency = brief.highlights.includes("emergency");
  const hasEstimates = brief.highlights.includes("free_estimates");

  const stats: SiteContent["stats"] = [];
  if (brief.yearsInBusiness && brief.yearsInBusiness > 0) {
    stats.push({
      value: `${brief.yearsInBusiness}+`,
      label: "Years in business",
    });
  }
  if (hasEmergency) stats.push({ value: "24/7", label: "Emergency service" });
  if (hasSameDay) stats.push({ value: "Same day", label: "Service available" });
  if (hasEstimates) stats.push({ value: "Free", label: "Estimates" });

  const why: SiteContent["why"] = [];
  if (brief.highlights.includes("licensed"))
    why.push({
      title: "Licensed and insured",
      text: "You can hire us with confidence, knowing the work is covered.",
    });
  if (brief.highlights.includes("upfront"))
    why.push({
      title: "Upfront pricing",
      text: "You know the price before the work starts, with no surprises on the bill.",
    });
  if (brief.highlights.includes("warranty"))
    why.push({
      title: "Work that is guaranteed",
      text: "If something is not right, we make it right.",
    });
  if (brief.highlights.includes("family"))
    why.push({
      title: "Family owned",
      text: `${brief.businessName} is a family business, and it shows in how we treat people.`,
    });
  if (brief.highlights.includes("veteran"))
    why.push({
      title: "Veteran owned",
      text: "Show up on time, do what you said, finish the job. That is how we work.",
    });
  if (hasSameDay)
    why.push({
      title: "Same-day service",
      text: "When it cannot wait, call us and we will do what we can to get out to you today.",
    });
  if (hasEmergency)
    why.push({
      title: "Emergency service",
      text: "Problems do not keep business hours, so we do not either.",
    });
  const fillers: SiteContent["why"] = [
    {
      title: `Local to ${brief.city}`,
      text: `We live and work here, so ${brief.city} customers get a neighbor, not a call center.`,
    },
    {
      title: "Clear communication",
      text: "We explain what we find, what it costs and what comes next, in plain words.",
    },
    {
      title: "Work you can see",
      text: "We treat your property with care and clean up when we are done.",
    },
  ];
  for (const filler of fillers) {
    if (why.length >= 4) break;
    why.push(filler);
  }

  const faq: SiteContent["faq"] = [
    {
      q: "How do I get a quote?",
      a: `Fill out the form on this page or call ${brief.phone}. Tell us a little about the job and we will get back to you with next steps.`,
    },
    {
      q: "What areas do you serve?",
      a: `We serve ${areasFrom(brief).join(", ")}. Not sure if you are in our area? Call ${brief.phone} and ask.`,
    },
    {
      q:
        hasSameDay || hasEmergency
          ? "Can you come out today?"
          : "How soon can you start?",
      a:
        hasSameDay || hasEmergency
          ? "We offer same-day and urgent service. Call us first so we can tell you how soon we can be there."
          : "Send a request or call and we will let you know our next opening. Earlier is better, so reach out as soon as you know you need us.",
    },
  ];
  if (hasEstimates) {
    faq.push({
      q: "Do you charge for estimates?",
      a: "No. Estimates are free.",
    });
  }

  const servicesList = brief.services.map((service) => ({
    title: cap(service),
    text: `Professional ${service.toLowerCase()} from a local ${noun === "service" ? "team" : `${noun} company`}. Call or send a request and we will take it from there.`,
  }));

  const content: SiteContent = {
    style: brief.style,
    accent: brief.accent,
    brand: {
      name: brief.businessName,
      phone: brief.phone,
      email: brief.email,
      city: brief.city,
      state: brief.state,
      hours: brief.hours,
      tagline: `${cap(noun)} in ${where}`,
      logoId: brief.logoId,
    },
    hero: {
      eyebrow: `${cap(noun)} in ${where}`,
      headline: `${cap(noun)} done right in`,
      headlineAccent: brief.city,
      sub: `${brief.businessName} helps ${brief.city} homes and businesses with ${brief.services
        .slice(0, 3)
        .map((s) => s.toLowerCase())
        .join(
          ", ",
        )}. Call or send a request and a real person will get back to you.`,
      primaryCta: hasEstimates ? "Get a free quote" : "Request a quote",
      secondaryCta: "Call now",
      imageId: brief.photoIds[0] ?? null,
      widget: widgetForTrade(brief.trade),
    },
    badges,
    stats: stats.slice(0, 4),
    servicesTitle: "What we do",
    servicesIntro: `Here is how ${brief.businessName} can help.`,
    services: servicesList,
    processTitle: "How it works",
    process: [
      {
        title: "Tell us what you need",
        text: "Fill out the form or give us a call. A few details is all we need.",
      },
      {
        title: "We get back to you",
        text: "We review the job and follow up with a clear quote and next steps.",
      },
      {
        title: "We get it done",
        text: "We do the work carefully and make sure you are happy before we leave.",
      },
    ],
    whyTitle: `Why ${brief.city} chooses ${brief.businessName}`,
    why: why.slice(0, 4),
    about: {
      title: `About ${brief.businessName}`,
      body:
        brief.about ||
        `${brief.businessName} is a local ${noun === "service" ? "business" : `${noun} company`} serving ${where}. We are here to do the job properly and treat every customer fairly.`,
    },
    areasTitle: "Where we work",
    areas: areasFrom(brief),
    // Photographers (and anyone with a good pile of photos) get the scroll
    // showcase, where the work is the page. Everyone else keeps a thumbnail grid.
    gallery:
      isVisualTrade(brief.trade) && brief.photoIds.length >= 4
        ? brief.photoIds.slice(1, MAX_SITE_PHOTOS)
        : brief.photoIds.slice(1, 7),
    galleryStyle:
      isVisualTrade(brief.trade) && brief.photoIds.length >= 4
        ? "reel"
        : "grid",
    galleryTitle: "",
    faqTitle: "Questions we hear a lot",
    faq,
    cta: {
      title: "Ready to get started?",
      text: `Call ${brief.phone} or send a request and ${brief.businessName} will get back to you.`,
      button: hasEstimates ? "Get a free quote" : "Request a quote",
    },
    extras: [],
    seo: {
      title: `${brief.businessName} | ${cap(noun)} in ${where}`,
      description: `${brief.businessName} provides ${brief.services
        .slice(0, 3)
        .map((s) => s.toLowerCase())
        .join(
          ", ",
        )} in ${where}. Call ${brief.phone} or request a quote online.`.slice(
        0,
        170,
      ),
    },
  };
  return cleanDeep(contentSchema.parse(cleanDeep(content)));
}

// ---- Layer 2: Claude rewrites the words ---------------------------------------

export function isAiConfigured(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]);
}

const SYSTEM_PROMPT = `You write the text for small local business websites (home services, auto, salons and similar). You will be given a business and what its owner told us. Return ONLY one JSON object, no markdown fences, no commentary.

Rules you must follow:
- Be warm, plain-spoken and specific to this business and its city. Short sentences. No hype, no buzzwords.
- NEVER invent facts. Do not make up years in business, review counts, star ratings, awards, certifications, license numbers, prices, response times, guarantees, team size, or brands. Only state what the owner told you. If a claim is not in the input, leave it out.
- Only mention a license, insurance, warranty, 24/7 or same-day service, free estimates, family or veteran ownership if it is in the owner's ticked highlights.
- Never use em dashes or en dashes. Use commas, periods or the word "and".
- Do not write customer testimonials.
- If the owner gave special requests, follow them where they are factual and about the website's wording.
- Keep every string within its limit.

Return this exact JSON shape:
{
 "hero": { "eyebrow": "<=60 chars", "headline": "<=80 chars, the first part of the headline", "headlineAccent": "<=40 chars, the last 2 to 5 words of the headline, shown in color", "sub": "<=240 chars", "primaryCta": "<=24 chars", "secondaryCta": "<=24 chars" },
 "servicesIntro": "<=200 chars",
 "services": [ { "title": "<=60 chars", "text": "<=220 chars" } ],
 "processTitle": "<=60 chars",
 "process": [ { "title": "<=50 chars", "text": "<=200 chars" } ],
 "whyTitle": "<=80 chars",
 "why": [ { "title": "<=50 chars", "text": "<=200 chars" } ],
 "about": { "title": "<=60 chars", "body": "<=700 chars" },
 "faq": [ { "q": "<=120 chars", "a": "<=400 chars" } ],
 "cta": { "title": "<=80 chars", "text": "<=200 chars", "button": "<=24 chars" },
 "seo": { "title": "<=65 chars", "description": "<=155 chars" }
}
Use exactly one service entry per service the owner listed, in the same order, keeping their names (you may tidy capitalization). Give 3 process steps, 3 or 4 why entries, and 4 to 6 FAQs.`;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON in the AI reply.");
  return JSON.parse(text.slice(start, end + 1));
}

type AiResult =
  { ok: true; content: SiteContent } | { ok: false; error: string };

// Merges the AI's words over the fallback, section by section, keeping the
// fallback for any section that does not pass validation.
function mergeAi(base: SiteContent, ai: Record<string, unknown>): SiteContent {
  const candidate = cleanDeep({
    ...base,
    hero: { ...base.hero, ...(isRecord(ai["hero"]) ? ai["hero"] : {}) },
    servicesIntro: str(ai["servicesIntro"]) ?? base.servicesIntro,
    services:
      Array.isArray(ai["services"]) && ai["services"].length > 0
        ? ai["services"]
        : base.services,
    processTitle: str(ai["processTitle"]) ?? base.processTitle,
    process:
      Array.isArray(ai["process"]) && ai["process"].length >= 2
        ? ai["process"]
        : base.process,
    whyTitle: str(ai["whyTitle"]) ?? base.whyTitle,
    why:
      Array.isArray(ai["why"]) && ai["why"].length >= 2 ? ai["why"] : base.why,
    about: isRecord(ai["about"])
      ? { ...base.about, ...ai["about"] }
      : base.about,
    faq:
      Array.isArray(ai["faq"]) && ai["faq"].length > 0 ? ai["faq"] : base.faq,
    cta: isRecord(ai["cta"]) ? { ...base.cta, ...ai["cta"] } : base.cta,
    seo: isRecord(ai["seo"]) ? { ...base.seo, ...ai["seo"] } : base.seo,
  });
  // Keep fields the AI must not touch.
  const hero = candidate.hero as Record<string, unknown>;
  hero["imageId"] = base.hero.imageId;
  const parsed = contentSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  // One bad section should not throw the rest away: try them one at a time.
  let merged = base;
  for (const key of [
    "hero",
    "servicesIntro",
    "services",
    "processTitle",
    "process",
    "whyTitle",
    "why",
    "about",
    "faq",
    "cta",
    "seo",
  ] as const) {
    const attempt = {
      ...merged,
      [key]: (candidate as Record<string, unknown>)[key],
    };
    const check = contentSchema.safeParse(attempt);
    if (check.success) merged = check.data;
  }
  return merged;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export async function writeContentWithAi(
  brief: SiteBrief,
  base: SiteContent,
  extraNotes?: string | undefined,
): Promise<AiResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };

  const input = {
    businessName: brief.businessName,
    trade: brief.trade,
    city: brief.city,
    state: brief.state,
    phone: brief.phone,
    services: brief.services,
    serviceArea: brief.serviceArea || brief.city,
    yearsInBusiness: brief.yearsInBusiness,
    tickedHighlights: HIGHLIGHTS.filter((h) =>
      brief.highlights.includes(h.id),
    ).map((h) => h.label),
    aboutTheBusiness: brief.about,
    specialRequests: [brief.specialRequests, extraNotes]
      .filter(Boolean)
      .join("\n"),
    visualStyle: brief.style,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    // Newest model first. If an address is not available to this account
    // (404), fall back to the next one so the AI writing keeps working.
    const models = [
      process.env["ANTHROPIC_MODEL"],
      "claude-sonnet-5-5",
      "claude-sonnet-4-5",
      "claude-haiku-5-5",
    ].filter((m): m is string => Boolean(m));
    let response: Response | null = null;
    for (const model of models) {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 3500,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
        }),
      });
      if (response.status !== 404) break;
    }
    if (!response) return { ok: false, error: "No AI model was reachable." };
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Anthropic ${response.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (json.content ?? [])
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");
    const parsed = extractJson(text);
    if (!isRecord(parsed))
      return { ok: false, error: "The AI reply was not an object." };
    return { ok: true, content: mergeAi(base, parsed) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
