// Everything that happens to a customer's website after they pay: the order
// form, writing the site, Colby's review, the customer's approval, going live,
// the 7-day free address, and the quote requests that come in through the
// finished site.
//
// Flow of `status` on website_sites:
//   awaiting_details -> (customer sends the form) -> generating -> review
//   review -> (Colby sends it on) -> customer_review -> (customer approves) -> live
//   Colby can also publish straight from review. A live site with no custom
//   domain and no active upkeep is paused 7 days after it goes live.

import { createServerFn } from "@tanstack/react-start";
import {
  getRequest,
  getRequestHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { getBackgroundScheduler } from "../crm/connections.server";
import { getSessionBusinessId } from "../auth.server";
import { getDb, isDbConfigured } from "../db/client";
import {
  businesses,
  websiteSiteAssets,
  websiteSiteLeads,
  websiteSites,
  type Business,
  type WebsiteSite,
} from "../db/schema";
import {
  button,
  card,
  emailShell,
  escapeHtml,
  mutedPara,
  para,
  signoff,
} from "../email-layout";
import { UPTREND_SUPPORT_EMAIL, sendEmail } from "../messaging.server";
import { requireAdminBusiness } from "../reviews.server";
import { CANONICAL_SITE_URL } from "../site";
import {
  buildFallbackContent,
  cleanText,
  isAiConfigured,
  writeContentWithAi,
} from "./content.server";
import { fetchPhoto, scanSitePhotos } from "./photo-import.server";
import { renderNotFoundPage, renderPausedPage, renderSite } from "./render";
import {
  DOMAIN_FREE_DAYS,
  MAX_SITE_PHOTOS,
  briefSchema,
  cleanDomain,
  contentSchema,
  slugify,
  type SiteBrief,
  type SiteContent,
} from "./types";

// ---- Addresses and secrets -----------------------------------------------------

function tokenSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET is not set.");
  return secret;
}

// A link that lets a customer fill in their site form without logging in (the
// account password is created on a page they may have closed).
export function intakeToken(businessId: string): string {
  return createHmac("sha256", tokenSecret())
    .update(`site-intake:${businessId}`)
    .digest("hex")
    .slice(0, 32);
}

function verifyIntakeToken(businessId: string, token: string): boolean {
  try {
    const expected = Buffer.from(intakeToken(businessId));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

export function intakeLink(businessId: string): string {
  return `${CANONICAL_SITE_URL}/site-details?b=${businessId}&t=${intakeToken(businessId)}`;
}

export function freeSiteUrl(slug: string): string {
  return `${CANONICAL_SITE_URL}/s/${slug}`;
}

export function previewUrl(
  site: Pick<WebsiteSite, "slug" | "previewToken">,
): string {
  return `${freeSiteUrl(site.slug)}?p=${site.previewToken}`;
}

export function publicUrl(
  site: Pick<WebsiteSite, "slug" | "customDomain">,
): string {
  return site.customDomain
    ? `https://${site.customDomain}`
    : freeSiteUrl(site.slug);
}

// ---- Rows -----------------------------------------------------------------------

function parseContent(value: unknown): SiteContent | null {
  const parsed = contentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseBrief(value: unknown): SiteBrief | null {
  const parsed = briefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function uniqueSlug(name: string): Promise<string> {
  const db = getDb();
  const base = slugify(name);
  for (let i = 0; i < 6; i++) {
    const candidate =
      i === 0
        ? base
        : `${base}-${i === 1 ? randomBytes(2).toString("hex") : randomBytes(3).toString("hex")}`;
    const [taken] = await db
      .select({ id: websiteSites.id })
      .from(websiteSites)
      .where(eq(websiteSites.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

// The site row for a business, made on first need. Only website orders that
// include a build get one.
export async function ensureSite(
  business: Business,
): Promise<WebsiteSite | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(websiteSites)
    .where(eq(websiteSites.businessId, business.id))
    .limit(1);
  if (existing) return existing;
  if (
    business.websitePlan !== "build" &&
    business.websitePlan !== "build_maintenance"
  )
    return null;
  const slug = await uniqueSlug(business.businessName);
  const inserted = await db
    .insert(websiteSites)
    .values({
      businessId: business.id,
      slug,
      previewToken: randomBytes(18).toString("hex"),
    })
    .onConflictDoNothing({ target: websiteSites.businessId })
    .returning();
  if (inserted[0]) return inserted[0];
  const [again] = await db
    .select()
    .from(websiteSites)
    .where(eq(websiteSites.businessId, business.id))
    .limit(1);
  return again ?? null;
}

// Called by the Stripe webhook when a website order is paid: makes the site
// row and emails the customer the link to the details form (once).
export async function startSiteForOrder(email: string): Promise<void> {
  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.email, email))
    .limit(1);
  if (!business) return;
  if (
    business.websitePlan !== "build" &&
    business.websitePlan !== "build_maintenance"
  )
    return;
  const [existing] = await db
    .select({ id: websiteSites.id })
    .from(websiteSites)
    .where(eq(websiteSites.businessId, business.id))
    .limit(1);
  if (existing) return;
  const site = await ensureSite(business);
  if (site) await sendIntakeEmail(business);
}

async function siteById(id: string): Promise<WebsiteSite | null> {
  const [row] = await getDb()
    .select()
    .from(websiteSites)
    .where(eq(websiteSites.id, id))
    .limit(1);
  return row ?? null;
}

async function businessById(id: string): Promise<Business | null> {
  const [row] = await getDb()
    .select()
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1);
  return row ?? null;
}

async function touch(
  id: string,
  values: Partial<typeof websiteSites.$inferInsert>,
): Promise<void> {
  await getDb()
    .update(websiteSites)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(websiteSites.id, id));
}

// ---- Emails -----------------------------------------------------------------------

function footerLines(): string[] {
  return [
    "UpTrend Scaling, 3858 W Villa Linda Dr, Glendale, AZ 85310",
    "Questions? Reply to this email.",
  ];
}

async function mail(
  to: string,
  subject: string,
  preheader: string,
  tagline: string,
  sections: string[],
  replyTo?: string,
) {
  try {
    const html = emailShell({
      subject,
      preheader,
      tagline,
      sections: sections.map((s, i) => ({
        html: s,
        top: i === 0 ? 26 : 8,
        bottom: 10,
      })),
      footerLines: footerLines(),
    });
    const result = await sendEmail(
      to,
      subject,
      html,
      undefined,
      undefined,
      replyTo ? { replyTo } : undefined,
    );
    if (!result.ok)
      console.error("[site-gen] email not sent:", subject, result.error);
  } catch (error) {
    console.error("[site-gen] email failed:", subject, error);
  }
}

export async function sendIntakeEmail(business: Business): Promise<void> {
  const link = intakeLink(business.id);
  await mail(
    business.email,
    "Tell us about your business so we can build your website",
    "It takes about five minutes.",
    "Your website order",
    [
      para(`Hi ${business.contactName.split(" ")[0] || "there"},`),
      para(
        "Thanks for your order. The next step is a short form about your business: your services, your phone number, your colors, and a logo and photos if you have them. It takes about five minutes.",
      ),
      `<div style="margin:6px 0 10px">${button("Tell us about your business", link)}</div>`,
      mutedPara(
        "You approve the website before it goes live, and you can ask for changes until it feels right.",
      ),
      signoff("Colby", "UpTrend Scaling"),
    ],
  );
}

async function alertOwner(
  subject: string,
  lines: string[],
  link?: { label: string; url: string },
): Promise<void> {
  await mail(UPTREND_SUPPORT_EMAIL, subject, subject, "Website order", [
    ...lines.map((l) => para(l, 10)),
    ...(link
      ? [`<div style="margin:6px 0 10px">${button(link.label, link.url)}</div>`]
      : []),
  ]);
}

function adminLink(businessId: string): string {
  return `${CANONICAL_SITE_URL}/admin/site/${businessId}`;
}

// ---- Generating -------------------------------------------------------------------

// Writes (or rewrites) the site text from the customer's form. The plain
// version is saved first, so there is always something to review, then Claude
// polishes it when the key is set.
export async function generateSite(
  siteId: string,
  opts: { notes?: string | undefined; keepExtras?: boolean | undefined } = {},
): Promise<{ aiUsed: boolean; error: string | null }> {
  const site = await siteById(siteId);
  if (!site) return { aiUsed: false, error: "Site not found." };
  const brief = parseBrief(site.brief);
  if (!brief)
    return {
      aiUsed: false,
      error: "The business form has not been filled in.",
    };

  const existing = parseContent(site.content);
  const base = buildFallbackContent(brief);
  if (opts.keepExtras && existing) base.extras = existing.extras;

  await touch(siteId, {
    content: base,
    status: site.status === "live" ? "live" : "generating",
    lastError: null,
  });

  if (!isAiConfigured()) {
    if (site.status !== "live")
      await touch(siteId, { status: "review", aiUsed: false });
    return {
      aiUsed: false,
      error: "No AI key set, so the plain version of the text was used.",
    };
  }
  const result = await writeContentWithAi(brief, base, opts.notes);
  if (result.ok) {
    if (opts.keepExtras && existing) result.content.extras = existing.extras;
    await touch(siteId, {
      content: result.content,
      aiUsed: true,
      lastError: null,
      ...(site.status === "live" ? {} : { status: "review" as const }),
    });
    return { aiUsed: true, error: null };
  }
  await touch(siteId, {
    aiUsed: false,
    lastError: result.error.slice(0, 400),
    ...(site.status === "live" ? {} : { status: "review" as const }),
  });
  return { aiUsed: false, error: result.error };
}

async function finishBriefWork(siteId: string): Promise<void> {
  try {
    const site = await siteById(siteId);
    const business = site ? await businessById(site.businessId) : null;
    const outcome = await generateSite(siteId);
    const fresh = await siteById(siteId);
    if (!fresh || !business) return;
    await alertOwner(
      `Website ready to review: ${cleanText(business.businessName)}`,
      [
        `${business.businessName} filled out their website form and the site is built.`,
        outcome.aiUsed
          ? "The text was written with AI. Open the editor to look it over, add anything they asked for, preview it, then send it to them."
          : `The plain version of the text was used (${outcome.error ?? "AI was not used"}). You can edit anything in the editor before approving.`,
      ],
      { label: "Open the editor", url: adminLink(fresh.businessId) },
    );
  } catch (error) {
    console.error("[site-gen] finishing the site failed", error);
    await touch(siteId, {
      lastError: String(error).slice(0, 400),
      status: "review",
    }).catch(() => {});
  }
}

// ---- Who is asking ----------------------------------------------------------------

const authFields = {
  businessId: z.string().uuid().optional(),
  token: z.string().max(80).optional(),
};

type Who = { businessId?: string | undefined; token?: string | undefined };

async function resolveBusinessId(input: Who): Promise<string | null> {
  if (
    input.businessId &&
    input.token &&
    verifyIntakeToken(input.businessId, input.token)
  ) {
    return input.businessId;
  }
  return getSessionBusinessId();
}

async function resolveSite(
  input: Who,
): Promise<{ business: Business; site: WebsiteSite } | null> {
  if (!isDbConfigured()) return null;
  const id = await resolveBusinessId(input);
  if (!id) return null;
  const business = await businessById(id);
  if (!business) return null;
  const site = await ensureSite(business);
  return site ? { business, site } : null;
}

// ---- Customer: state, form, uploads, domain -------------------------------------------

export type MySiteState =
  | { ok: false; reason: "not_signed_in" | "no_site" | "not_configured" }
  | {
      ok: true;
      status: WebsiteSite["status"];
      slug: string;
      businessName: string;
      defaults: { businessName: string; phone: string; email: string };
      brief: SiteBrief | null;
      assets: Array<{ id: string; kind: "logo" | "photo" }>;
      liveUrl: string | null;
      customerPreviewUrl: string | null;
      customDomain: string | null;
      domainRequested: boolean;
      domainDeadlineAt: string | null;
      daysLeft: number | null;
      maintenanceActive: boolean;
      changeRequestCount: number;
    };

export const getMySiteState = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object(authFields).parse(input ?? {}))
  .handler(async ({ data }): Promise<MySiteState> => {
    if (!isDbConfigured()) return { ok: false, reason: "not_configured" };
    const id = await resolveBusinessId(data);
    if (!id) return { ok: false, reason: "not_signed_in" };
    const found = await resolveSite(data);
    if (!found) return { ok: false, reason: "no_site" };
    const { business, site } = found;
    const assets = await getDb()
      .select({ id: websiteSiteAssets.id, kind: websiteSiteAssets.kind })
      .from(websiteSiteAssets)
      .where(eq(websiteSiteAssets.siteId, site.id));
    const live = site.status === "live" || site.status === "paused";
    const daysLeft =
      site.domainDeadlineAt && !site.customDomain
        ? Math.max(
            0,
            Math.ceil(
              (site.domainDeadlineAt.getTime() - Date.now()) / 86_400_000,
            ),
          )
        : null;
    return {
      ok: true,
      status: site.status,
      slug: site.slug,
      businessName: business.businessName,
      defaults: {
        businessName: business.businessName,
        phone: business.phone,
        email: business.email,
      },
      brief: parseBrief(site.brief),
      assets,
      liveUrl: live ? publicUrl(site) : null,
      customerPreviewUrl:
        site.status === "customer_review" ? previewUrl(site) : null,
      customDomain: site.customDomain,
      domainRequested: Boolean(site.domainRequestedAt),
      domainDeadlineAt: site.domainDeadlineAt
        ? site.domainDeadlineAt.toISOString()
        : null,
      daysLeft,
      maintenanceActive: business.maintenanceActive,
      changeRequestCount: Array.isArray(site.changeRequests)
        ? site.changeRequests.length
        : 0,
    };
  });

const MAX_ASSET_CHARS = 1_050_000; // about 780 KB of picture after base64
const MAX_PHOTOS = 8;

export const uploadSiteAsset = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        ...authFields,
        kind: z.enum(["logo", "photo"]),
        mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data: z.string().min(100).max(MAX_ASSET_CHARS),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; id: string } | { ok: false; message: string }> => {
      const found = await resolveSite(data);
      if (!found) return { ok: false, message: "Please sign in again." };
      if (!/^[A-Za-z0-9+/=]+$/.test(data.data))
        return { ok: false, message: "That file could not be read." };
      const db = getDb();
      const existing = await db
        .select({ id: websiteSiteAssets.id, kind: websiteSiteAssets.kind })
        .from(websiteSiteAssets)
        .where(eq(websiteSiteAssets.siteId, found.site.id));
      if (
        data.kind === "photo" &&
        existing.filter((a) => a.kind === "photo").length >= MAX_PHOTOS
      ) {
        return {
          ok: false,
          message: `You can add up to ${MAX_PHOTOS} photos.`,
        };
      }
      if (data.kind === "logo") {
        // One logo: a new one replaces the old.
        for (const old of existing.filter((a) => a.kind === "logo")) {
          await db
            .delete(websiteSiteAssets)
            .where(eq(websiteSiteAssets.id, old.id));
        }
      }
      const [row] = await db
        .insert(websiteSiteAssets)
        .values({
          siteId: found.site.id,
          kind: data.kind,
          mime: data.mime,
          data: data.data,
          bytes: Math.round((data.data.length * 3) / 4),
        })
        .returning({ id: websiteSiteAssets.id });
      return row
        ? { ok: true, id: row.id }
        : { ok: false, message: "Could not save the picture." };
    },
  );

export const deleteSiteAsset = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ ...authFields, assetId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const found = await resolveSite(data);
    if (!found) return { ok: false };
    await getDb()
      .delete(websiteSiteAssets)
      .where(
        and(
          eq(websiteSiteAssets.id, data.assetId),
          eq(websiteSiteAssets.siteId, found.site.id),
        ),
      );
    return { ok: true };
  });

export const submitSiteBrief = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ ...authFields, brief: briefSchema }).parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      const found = await resolveSite(data);
      if (!found) return { ok: false, message: "Please sign in again." };
      const { site, business } = found;
      if (site.status === "live" || site.status === "customer_review") {
        return {
          ok: false,
          message:
            "Your site is already built. Reply to our email to ask for changes.",
        };
      }

      // Only pictures that belong to this site.
      const owned = await getDb()
        .select({ id: websiteSiteAssets.id, kind: websiteSiteAssets.kind })
        .from(websiteSiteAssets)
        .where(eq(websiteSiteAssets.siteId, site.id));
      const ownedIds = new Set(owned.map((a) => a.id));
      const brief: SiteBrief = {
        ...data.brief,
        logoId:
          data.brief.logoId && ownedIds.has(data.brief.logoId)
            ? data.brief.logoId
            : null,
        photoIds: data.brief.photoIds.filter((id) => ownedIds.has(id)),
      };

      await touch(site.id, { brief, status: "generating", lastError: null });
      await getDb()
        .update(businesses)
        .set({ websiteStatus: "building" })
        .where(eq(businesses.id, business.id));

      const work = finishBriefWork(site.id);
      let scheduler: ReturnType<typeof getBackgroundScheduler> = null;
      try {
        scheduler = getBackgroundScheduler(getRequest());
      } catch {
        scheduler = null;
      }
      if (scheduler) {
        scheduler(work);
      } else {
        await work;
      }
      return { ok: true };
    },
  );

export const requestSiteDomain = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ ...authFields, domain: z.string().trim().max(200) })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; domain: string } | { ok: false; message: string }
    > => {
      const found = await resolveSite(data);
      if (!found) return { ok: false, message: "Please sign in again." };
      const domain = cleanDomain(data.domain);
      if (!domain)
        return {
          ok: false,
          message:
            "That does not look like a web address. Try something like mybusiness.com.",
        };
      await touch(found.site.id, { domainRequestedAt: new Date() });
      await getDb()
        .update(websiteSites)
        .set({
          brief: sql`coalesce(${websiteSites.brief}, '{}'::jsonb) || ${JSON.stringify({ requestedDomain: domain })}::jsonb`,
        })
        .where(eq(websiteSites.id, found.site.id));
      await alertOwner(
        `Domain to connect: ${cleanText(found.business.businessName)}`,
        [
          `${found.business.businessName} entered the address they want their website on: ${domain}`,
          "Connect it (add the domain in Vercel, then send them the DNS records), then enter it in the editor so their site starts loading there.",
        ],
        { label: "Open the editor", url: adminLink(found.site.businessId) },
      );
      return { ok: true, domain };
    },
  );

// ---- Customer: approve or ask for changes -----------------------------------------------

async function publishLive(
  site: WebsiteSite,
  business: Business,
): Promise<void> {
  const now = new Date();
  await touch(site.id, {
    status: "live",
    liveAt: site.liveAt ?? now,
    domainDeadlineAt:
      site.domainDeadlineAt ??
      new Date(now.getTime() + DOMAIN_FREE_DAYS * 86_400_000),
  });
  const url = publicUrl(site);
  await getDb()
    .update(businesses)
    .set({ websiteStatus: "live", websiteUrl: url })
    .where(eq(businesses.id, business.id));
}

async function sendLiveEmail(
  site: WebsiteSite,
  business: Business,
): Promise<void> {
  const fresh = (await siteById(site.id)) ?? site;
  const url = publicUrl(fresh);
  const hasDomain = Boolean(fresh.customDomain);
  await mail(
    business.email,
    `Your website is live: ${business.businessName}`,
    "Here is your address, and one thing to do in the next 7 days.",
    "Your website is live",
    [
      para(`Great news, your website is live.`),
      `<div style="margin:6px 0 14px">${button("Open your website", url)}</div>`,
      ...(hasDomain || business.maintenanceActive
        ? []
        : [
            card(
              "Next step: your own web address",
              para(
                `Your site is live at ${url}. That free address stays up for ${DOMAIN_FREE_DAYS} days. Enter the web address you want (for example yourbusiness.com) in your dashboard and we will connect it for you. If you do not have one yet, you can buy one at any domain seller and then enter it.`,
                12,
              ) +
                `<div>${button("Enter my web address", `${CANONICAL_SITE_URL}/app`, "secondary")}</div>`,
            ),
          ]),
      mutedPara(
        "Need a change? Reply to this email and we will take care of it.",
      ),
      signoff("Colby", "UpTrend Scaling"),
    ],
  );
}

export async function handleSiteAction(
  slug: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const parsed = z
    .object({
      token: z.string().min(10).max(80),
      action: z.enum(["approve", "changes"]),
      text: z.string().trim().max(1500).optional(),
    })
    .safeParse(body);
  if (!parsed.success)
    return { status: 400, json: { ok: false, message: "Bad request." } };
  const [site] = await getDb()
    .select()
    .from(websiteSites)
    .where(eq(websiteSites.slug, slug))
    .limit(1);
  if (!site || site.previewToken !== parsed.data.token) {
    return {
      status: 403,
      json: { ok: false, message: "This link is not valid." },
    };
  }
  const business = await businessById(site.businessId);
  if (!business)
    return { status: 404, json: { ok: false, message: "Not found." } };
  if (site.status !== "customer_review") {
    return {
      status: 409,
      json: {
        ok: false,
        message: "This site is not waiting for approval right now.",
      },
    };
  }

  if (parsed.data.action === "approve") {
    await publishLive(site, business);
    await sendLiveEmail(site, business);
    await alertOwner(`Customer approved: ${cleanText(business.businessName)}`, [
      `${business.businessName} approved their website and it is now live at ${publicUrl(site)}.`,
      `Their 7-day free address clock started. They were asked to enter their own domain.`,
    ]);
    return {
      status: 200,
      json: { ok: true, live: true, url: publicUrl(site) },
    };
  }

  const text = (parsed.data.text ?? "").trim();
  if (text.length < 3)
    return {
      status: 400,
      json: { ok: false, message: "Tell us what you would like changed." },
    };
  const requests = Array.isArray(site.changeRequests)
    ? site.changeRequests
    : [];
  await touch(site.id, {
    status: "review",
    changeRequests: [...requests, { at: new Date().toISOString(), text }],
  });
  await alertOwner(
    `Changes requested: ${cleanText(business.businessName)}`,
    [
      `${business.businessName} asked for changes to their website:`,
      `"${text}"`,
    ],
    { label: "Open the editor", url: adminLink(site.businessId) },
  );
  return { status: 200, json: { ok: true, live: false } };
}

// ---- Admin -----------------------------------------------------------------------------

async function adminOnly(): Promise<void> {
  await requireAdminBusiness();
}

export type AdminSiteRow = {
  businessId: string;
  businessName: string;
  status: WebsiteSite["status"];
  slug: string;
  hasBrief: boolean;
  previewUrl: string;
  liveUrl: string;
  customDomain: string | null;
  requestedDomain: string | null;
  domainDeadlineAt: string | null;
  changeRequests: number;
  leads: number;
  aiUsed: boolean;
  lastError: string | null;
  updatedAt: string;
};

export const adminListSites = createServerFn({ method: "POST" }).handler(
  async (): Promise<
    { ok: true; sites: AdminSiteRow[] } | { ok: false; message: string }
  > => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await adminOnly();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    const db = getDb();
    const rows = await db
      .select({ site: websiteSites, name: businesses.businessName })
      .from(websiteSites)
      .innerJoin(businesses, eq(businesses.id, websiteSites.businessId))
      .orderBy(desc(websiteSites.createdAt));
    const leadCounts = await db
      .select({
        siteId: websiteSiteLeads.siteId,
        n: sql<number>`count(*)::int`,
      })
      .from(websiteSiteLeads)
      .groupBy(websiteSiteLeads.siteId);
    const counts = new Map(leadCounts.map((l) => [l.siteId, l.n]));
    return {
      ok: true,
      sites: rows.map(({ site, name }) => ({
        businessId: site.businessId,
        businessName: name,
        status: site.status,
        slug: site.slug,
        hasBrief: Boolean(site.brief && parseBrief(site.brief)),
        previewUrl: previewUrl(site),
        liveUrl: publicUrl(site),
        customDomain: site.customDomain,
        requestedDomain: requestedDomainOf(site),
        domainDeadlineAt: site.domainDeadlineAt
          ? site.domainDeadlineAt.toISOString()
          : null,
        changeRequests: Array.isArray(site.changeRequests)
          ? site.changeRequests.length
          : 0,
        leads: counts.get(site.id) ?? 0,
        aiUsed: site.aiUsed,
        lastError: site.lastError,
        updatedAt: site.updatedAt.toISOString(),
      })),
    };
  },
);

function requestedDomainOf(site: WebsiteSite): string | null {
  const brief = site.brief as { requestedDomain?: unknown } | null;
  return brief && typeof brief.requestedDomain === "string"
    ? brief.requestedDomain
    : null;
}

export type AdminSiteDetail = {
  businessId: string;
  businessName: string;
  email: string;
  status: WebsiteSite["status"];
  slug: string;
  previewUrl: string;
  liveUrl: string;
  customDomain: string | null;
  requestedDomain: string | null;
  content: SiteContent | null;
  brief: SiteBrief | null;
  changeRequests: Array<{ at: string; text: string }>;
  assets: Array<{ id: string; kind: "logo" | "photo" }>;
  aiConfigured: boolean;
  lastError: string | null;
};

export const adminGetSite = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ businessId: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; site: AdminSiteDetail } | { ok: false; message: string }
    > => {
      if (!isDbConfigured())
        return { ok: false, message: "Not configured yet." };
      try {
        await adminOnly();
      } catch {
        return { ok: false, message: "Not authorized." };
      }
      const business = await businessById(data.businessId);
      if (!business) return { ok: false, message: "Business not found." };
      const site = await ensureSite(business);
      if (!site)
        return {
          ok: false,
          message: "This business has no website build order.",
        };
      const assets = await getDb()
        .select({ id: websiteSiteAssets.id, kind: websiteSiteAssets.kind })
        .from(websiteSiteAssets)
        .where(eq(websiteSiteAssets.siteId, site.id));
      const changes = (
        Array.isArray(site.changeRequests) ? site.changeRequests : []
      ) as Array<{ at: string; text: string }>;
      return {
        ok: true,
        site: {
          businessId: business.id,
          businessName: business.businessName,
          email: business.email,
          status: site.status,
          slug: site.slug,
          previewUrl: previewUrl(site),
          liveUrl: publicUrl(site),
          customDomain: site.customDomain,
          requestedDomain: requestedDomainOf(site),
          content: parseContent(site.content),
          brief: parseBrief(site.brief),
          changeRequests: changes,
          assets,
          aiConfigured: isAiConfigured(),
          lastError: site.lastError,
        },
      };
    },
  );

export const adminSaveContent = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ businessId: z.string().uuid(), content: contentSchema })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    try {
      await adminOnly();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    const business = await businessById(data.businessId);
    const site = business ? await ensureSite(business) : null;
    if (!site) return { ok: false, message: "Site not found." };
    await touch(site.id, { content: data.content });
    return { ok: true };
  });

export const adminRegenerate = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid(),
        notes: z.string().trim().max(1500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    try {
      await adminOnly();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    const business = await businessById(data.businessId);
    const site = business ? await ensureSite(business) : null;
    if (!site) return { ok: false, message: "Site not found." };
    const outcome = await generateSite(site.id, {
      notes: data.notes,
      keepExtras: true,
    });
    return {
      ok: true,
      message: outcome.aiUsed
        ? "Rewritten with AI."
        : `Rebuilt from the form. ${outcome.error ?? ""}`.trim(),
    };
  });

export const adminSiteAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid(),
        action: z.enum([
          "send_to_customer",
          "publish",
          "unpublish",
          "mark_review",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    try {
      await adminOnly();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    const business = await businessById(data.businessId);
    const site = business ? await ensureSite(business) : null;
    if (!business || !site) return { ok: false, message: "Site not found." };
    if (!parseContent(site.content))
      return {
        ok: false,
        message: "There is no site yet. The customer has not sent the form.",
      };

    if (data.action === "send_to_customer") {
      await touch(site.id, { status: "customer_review" });
      await mail(
        business.email,
        `Your website is ready to look at: ${business.businessName}`,
        "Take a look, then approve it or ask for changes.",
        "Your website preview",
        [
          para(`Hi ${business.contactName.split(" ")[0] || "there"},`),
          para(
            "Your website is built and ready for you to look at. Open the preview, click around on your phone and your computer, then either approve it or tell us what to change.",
          ),
          `<div style="margin:6px 0 10px">${button("Open my website preview", previewUrl(site))}</div>`,
          mutedPara(
            "Nothing goes live until you approve it. You can ask for as many changes as you need.",
          ),
          signoff("Colby", "UpTrend Scaling"),
        ],
      );
      await getDb()
        .update(businesses)
        .set({ websiteStatus: "building" })
        .where(eq(businesses.id, business.id));
      return { ok: true, message: "Preview sent to the customer." };
    }
    if (data.action === "publish") {
      await publishLive(site, business);
      await sendLiveEmail(site, business);
      return { ok: true, message: "Published, and the customer was emailed." };
    }
    if (data.action === "unpublish" || data.action === "mark_review") {
      await touch(site.id, { status: "review" });
      await getDb()
        .update(businesses)
        .set({ websiteStatus: "building" })
        .where(eq(businesses.id, business.id));
      return { ok: true, message: "Moved back to review." };
    }
    return { ok: false, message: "Unknown action." };
  });

export const adminSetDomain = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid(),
        domain: z.string().trim().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    try {
      await adminOnly();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    const business = await businessById(data.businessId);
    const site = business ? await ensureSite(business) : null;
    if (!business || !site) return { ok: false, message: "Site not found." };
    const domain = data.domain ? cleanDomain(data.domain) : null;
    if (data.domain && !domain)
      return { ok: false, message: "That is not a valid domain." };
    if (domain) {
      const [taken] = await getDb()
        .select({ id: websiteSites.id })
        .from(websiteSites)
        .where(eq(websiteSites.customDomain, domain))
        .limit(1);
      if (taken && taken.id !== site.id)
        return { ok: false, message: "Another site already uses that domain." };
    }
    await touch(site.id, {
      customDomain: domain,
      ...(domain && site.status === "paused"
        ? { status: "live" as const }
        : {}),
    });
    if (site.status === "live" || site.status === "paused") {
      await getDb()
        .update(businesses)
        .set({
          websiteUrl: domain ? `https://${domain}` : freeSiteUrl(site.slug),
        })
        .where(eq(businesses.id, business.id));
    }
    return {
      ok: true,
      message: domain
        ? "Domain saved. The site now loads there once DNS points to us."
        : "Domain removed.",
    };
  });

// ---- Serving a site -----------------------------------------------------------------------

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function html(body: string, status: number, cache: string): Response {
  return new Response(body, {
    status,
    headers: { ...HTML_HEADERS, "cache-control": cache },
  });
}

function previewBarHtml(site: WebsiteSite, forCustomer: boolean): string {
  const slug = JSON.stringify(site.slug);
  const token = JSON.stringify(site.previewToken);
  const css = `<style>.pm{position:fixed;inset:0;z-index:90;background:#000a;display:none;align-items:center;justify-content:center;padding:18px}.pm.open{display:flex}.pm div{background:#fff;color:#111;border-radius:14px;padding:22px;max-width:480px;width:100%;font:15px/1.5 Inter,system-ui,sans-serif}.pm textarea{width:100%;min-height:120px;margin:10px 0;padding:12px;border:1px solid #ccc;border-radius:10px;font:inherit}.pm button{font:600 15px Inter,system-ui,sans-serif;border:0;border-radius:999px;padding:11px 20px;cursor:pointer;margin-right:8px}</style>`;
  if (!forCustomer) {
    return `${css}<div class="pbar"><span><b>Preview.</b> Not live yet. The customer has not seen this version.</span></div>`;
  }
  const script = `<script>(function(){var S=${slug},T=${token};function post(a,t){return fetch('/s/'+S+'/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:T,action:a,text:t})}).then(function(r){return r.json()})}
var pa=document.getElementById('pa'),pc=document.getElementById('pc'),m=document.getElementById('pm'),msg=document.getElementById('pmsg');
pc.onclick=function(){m.classList.add('open')};document.getElementById('pcx').onclick=function(){m.classList.remove('open')};
pa.onclick=function(){pa.disabled=true;pa.textContent='Launching...';post('approve').then(function(j){if(j.ok){document.querySelector('.pbar').innerHTML='<span><b>Your site is live!</b> Check your email for next steps.</span>'}else{pa.disabled=false;pa.textContent='Approve and launch';alert(j.message||'Something went wrong.')}})};
document.getElementById('pcs').onclick=function(){var t=document.getElementById('pct').value;post('changes',t).then(function(j){if(j.ok){m.classList.remove('open');document.querySelector('.pbar').innerHTML='<span><b>Thanks!</b> We got your changes and will update the site.</span>'}else{msg.textContent=j.message||'Something went wrong.'}})};})();</script>`;
  return `${css}<div class="pbar"><span><b>Preview.</b> This is how your site will look. Nothing is live yet.</span><button id="pa" type="button">Approve and launch</button><button id="pc" class="alt" type="button">Request changes</button></div><div class="pm" id="pm"><div><b>What would you like changed?</b><textarea id="pct" placeholder="Example: change the phone number, add roof repair to the services, use a bluer color"></textarea><p id="pmsg" style="color:#b42318"></p><button id="pcs" type="button" style="background:#111;color:#fff">Send</button><button id="pcx" type="button" style="background:#eee">Cancel</button></div></div>${script}`;
}

export type ServeInput = {
  slug?: string;
  host?: string;
  previewToken?: string | null;
};

// Returns the page for a site's free address (by slug) or a connected domain
// (by host). Unapproved sites are only shown to someone holding the preview
// link, and are never indexed.
export async function serveSite(input: ServeInput): Promise<Response> {
  if (!isDbConfigured()) return html(renderNotFoundPage(), 404, "no-store");
  const db = getDb();
  const [site] = input.slug
    ? await db
        .select()
        .from(websiteSites)
        .where(eq(websiteSites.slug, input.slug))
        .limit(1)
    : input.host
      ? await db
          .select()
          .from(websiteSites)
          .where(eq(websiteSites.customDomain, input.host))
          .limit(1)
      : [];
  if (!site) return html(renderNotFoundPage(), 404, "no-store");
  const content = parseContent(site.content);
  if (!content) return html(renderNotFoundPage(), 404, "no-store");

  const hasToken =
    Boolean(input.previewToken) && input.previewToken === site.previewToken;
  const isLive = site.status === "live" || site.status === "paused";
  const byHost = Boolean(input.host);

  const business = await businessById(site.businessId);
  const leadUrl = byHost ? "/__lead" : `/s/${site.slug}/lead`;
  const assetUrl = (id: string) => `/site-assets/${id}`;

  if (isLive) {
    // Free address after the 7 days, with no domain and no upkeep.
    const expired =
      !byHost &&
      !site.customDomain &&
      Boolean(site.domainDeadlineAt) &&
      Date.now() > (site.domainDeadlineAt as Date).getTime() &&
      !business?.maintenanceActive;
    if (expired && !hasToken) {
      return html(
        renderPausedPage(content.brand.name, content.brand.phone),
        200,
        "public, max-age=0, s-maxage=60",
      );
    }
    const canonicalUrl = site.customDomain
      ? `https://${site.customDomain}`
      : freeSiteUrl(site.slug);
    const page = renderSite(content, {
      leadUrl,
      assetUrl,
      canonicalUrl,
      preview: false,
    });
    return html(
      page,
      200,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
  }

  if (!hasToken) return html(renderNotFoundPage(), 404, "no-store");
  const forCustomer = site.status === "customer_review";
  const page = renderSite(content, {
    leadUrl,
    assetUrl,
    canonicalUrl: null,
    preview: true,
    previewBar: previewBarHtml(site, forCustomer),
  });
  return html(page, 200, "no-store");
}

export async function serveAsset(id: string): Promise<Response> {
  if (!isDbConfigured() || !/^[0-9a-f-]{36}$/i.test(id))
    return new Response("Not found", { status: 404 });
  const [asset] = await getDb()
    .select()
    .from(websiteSiteAssets)
    .where(eq(websiteSiteAssets.id, id))
    .limit(1);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(asset.data, "base64"), {
    status: 200,
    headers: {
      "content-type": asset.mime,
      "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

// A quote request typed into a finished site. Goes to the customer's inbox.
export async function handleLead(
  where: { slug?: string; host?: string },
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().min(7).max(30),
      service: z.string().trim().max(90).optional(),
      message: z.string().trim().max(1200).optional(),
      website: z.string().max(200).optional(),
    })
    .safeParse(body);
  if (!parsed.success)
    return {
      status: 400,
      json: { ok: false, message: "Please add your name and phone number." },
    };
  if (parsed.data.website) return { status: 200, json: { ok: true } }; // honeypot filled: a bot

  const db = getDb();
  const [site] = where.slug
    ? await db
        .select()
        .from(websiteSites)
        .where(eq(websiteSites.slug, where.slug))
        .limit(1)
    : where.host
      ? await db
          .select()
          .from(websiteSites)
          .where(eq(websiteSites.customDomain, where.host))
          .limit(1)
      : [];
  if (!site || (site.status !== "live" && site.status !== "paused")) {
    return { status: 404, json: { ok: false, message: "Not found." } };
  }
  const content = parseContent(site.content);
  const brief = parseBrief(site.brief);
  const business = await businessById(site.businessId);
  const to = brief?.email ?? business?.email;
  if (!content || !to)
    return { status: 404, json: { ok: false, message: "Not found." } };

  // At most 25 requests an hour per site, so one bot cannot flood an inbox.
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(websiteSiteLeads)
    .where(
      and(
        eq(websiteSiteLeads.siteId, site.id),
        gte(websiteSiteLeads.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  if ((recent?.n ?? 0) >= 25) {
    return {
      status: 429,
      json: {
        ok: false,
        message: "Too many requests right now. Please call us instead.",
      },
    };
  }

  await db.insert(websiteSiteLeads).values({
    siteId: site.id,
    name: parsed.data.name,
    phone: parsed.data.phone,
    service: parsed.data.service || null,
    message: parsed.data.message || null,
  });

  const rows = [
    ["Name", parsed.data.name],
    ["Phone", parsed.data.phone],
    ...(parsed.data.service ? [["Needs", parsed.data.service]] : []),
    ...(parsed.data.message ? [["Message", parsed.data.message]] : []),
  ];
  await mail(
    to,
    `New quote request from ${cleanText(parsed.data.name)}`,
    `${parsed.data.name} sent a request through your website.`,
    "New request from your website",
    [
      para(
        "Someone just sent a request through your website. Call or text them back as soon as you can.",
      ),
      rows
        .map(
          ([k, v]) =>
            `<p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#18181b"><strong>${escapeHtml(k as string)}:</strong> ${escapeHtml(v as string)}</p>`,
        )
        .join(""),
      mutedPara(`This request came from ${publicUrl(site)}.`),
    ],
  );
  return { status: 200, json: { ok: true } };
}

// ---- Daily reminders --------------------------------------------------------------------

// Runs once a day from Vercel Cron (see vercel.json). Sends each customer, at most
// once per kind: a nudge to finish the details form, a nudge to approve the
// preview, and the countdown for the free address (3 days left, 1 day left,
// paused). What was already sent is remembered inside the site's brief.
function cronAuthorized(): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  return getRequestHeader("authorization") === `Bearer ${expected}`;
}

function sentReminders(site: WebsiteSite): string[] {
  const brief = site.brief as { remindersSent?: unknown } | null;
  return brief && Array.isArray(brief.remindersSent)
    ? brief.remindersSent.filter((x): x is string => typeof x === "string")
    : [];
}

async function markReminder(site: WebsiteSite, kind: string): Promise<void> {
  const next = [...sentReminders(site), kind];
  await getDb()
    .update(websiteSites)
    .set({
      brief: sql`coalesce(${websiteSites.brief}, '{}'::jsonb) || ${JSON.stringify({ remindersSent: next })}::jsonb`,
    })
    .where(eq(websiteSites.id, site.id));
}

export type SiteReminderResult =
  | { ok: true; sent: number }
  | { ok: false; reason: "unauthorized" | "not_configured" };

export const runSiteReminders = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteReminderResult> => runSiteRemindersNow(),
);

async function runSiteRemindersNow(): Promise<SiteReminderResult> {
  if (!cronAuthorized()) {
    setResponseStatus(401);
    return { ok: false, reason: "unauthorized" };
  }
  if (!isDbConfigured()) return { ok: false, reason: "not_configured" };
  const db = getDb();
  const rows = await db
    .select({ site: websiteSites, business: businesses })
    .from(websiteSites)
    .innerJoin(businesses, eq(businesses.id, websiteSites.businessId));
  const now = Date.now();
  let sent = 0;
  for (const { site, business } of rows) {
    try {
      const done = sentReminders(site);
      const ageDays = (now - site.createdAt.getTime()) / 86_400_000;
      const name = cleanText(business.businessName);

      if (site.status === "awaiting_details") {
        const kind =
          ageDays >= 3 ? "details_3" : ageDays >= 1 ? "details_1" : null;
        if (kind && !done.includes(kind)) {
          await mail(
            business.email,
            `Finish your website details: ${name}`,
            "It takes about 3 minutes, and then we build your site.",
            "One quick step left",
            [
              para(
                "We are ready to build your website. We just need a few details about your business: services, phone number, and your logo and photos if you have them.",
              ),
              `<div style="margin:6px 0 14px">${button("Fill out the form", intakeLink(business.id))}</div>`,
              mutedPara(
                "Stuck, or would rather tell us by email? Just reply and we will take care of it.",
              ),
              signoff("Colby", "UpTrend Scaling"),
            ],
          );
          await markReminder(site, kind);
          sent++;
        }
        continue;
      }

      if (site.status === "customer_review") {
        const waitedDays = (now - site.updatedAt.getTime()) / 86_400_000;
        if (waitedDays >= 2 && !done.includes("approve_2")) {
          await mail(
            business.email,
            `Your website is waiting for your OK: ${name}`,
            "Take a look and approve it or tell us what to change.",
            "Your website is ready",
            [
              para(
                "Your website is ready for you to look over. Approve it, or tell us what you would like changed.",
              ),
              `<div style="margin:6px 0 14px">${button("Open my website", previewUrl(site))}</div>`,
              signoff("Colby", "UpTrend Scaling"),
            ],
          );
          await markReminder(site, "approve_2");
          sent++;
        }
        continue;
      }

      const freeClockRunning =
        (site.status === "live" || site.status === "paused") &&
        site.domainDeadlineAt &&
        !site.customDomain &&
        !business.maintenanceActive;
      if (!freeClockRunning || !site.domainDeadlineAt) continue;
      const daysLeft = (site.domainDeadlineAt.getTime() - now) / 86_400_000;
      const url = publicUrl(site);
      const enter = `<div style="margin:6px 0 14px">${button("Enter my web address", `${CANONICAL_SITE_URL}/app`)}</div>`;
      let kind: string | null = null;
      let subject = "";
      let lead = "";
      if (daysLeft <= 0) {
        kind = "paused";
        subject = `Your website is paused: ${name}`;
        lead = `Your free address (${url}) has reached its ${DOMAIN_FREE_DAYS} days, so your website is paused for now. Nothing is lost. Send us the web address you want and we will connect it and turn the site back on.`;
      } else if (daysLeft <= 1) {
        kind = "domain_1";
        subject = `Your website address expires tomorrow: ${name}`;
        lead = `Your free address (${url}) is about to expire. Enter the web address you want your site on and we will connect it so it stays online.`;
      } else if (daysLeft <= 3) {
        kind = "domain_3";
        subject = `3 days left on your free website address: ${name}`;
        lead = `Your free address (${url}) stays up for about 3 more days. Enter the web address you want (for example yourbusiness.com) and we will connect it. If you do not have one yet, you can buy one at any domain seller first.`;
      }
      if (kind && !done.includes(kind)) {
        await mail(
          business.email,
          subject,
          "One quick thing to keep your site online.",
          "Keep your website online",
          [
            para(lead),
            enter,
            mutedPara(
              "Questions, or need help picking a domain? Reply to this email.",
            ),
            signoff("Colby", "UpTrend Scaling"),
          ],
        );
        await markReminder(site, kind);
        sent++;
        if (kind === "paused") {
          await alertOwner(
            `Free address expired: ${name}`,
            [
              `${business.businessName}'s free ${DOMAIN_FREE_DAYS} days ended with no domain connected, so their site is paused. They were emailed.`,
            ],
            { label: "Open the editor", url: adminLink(business.id) },
          );
        }
      }
    } catch (error) {
      console.error("[site-gen] reminder failed", site.id, error);
    }
  }
  return { ok: true, sent };
}

// ---- Bringing in a business's real photos (admin only) ------------------------------

// Step 1: look through their existing website and list the pictures on it.
export const adminScanSitePhotos = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid(),
        url: z.string().trim().min(4).max(300),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; candidates: string[]; pages: number }
      | { ok: false; message: string }
    > => {
      try {
        await adminOnly();
      } catch {
        return { ok: false, message: "Not authorized." };
      }
      const found = await scanSitePhotos(data.url);
      if (found.error) return { ok: false, message: found.error };
      if (found.candidates.length === 0)
        return {
          ok: false,
          message:
            "Opened the website but found no photos in its pages. It may load pictures with a script. You can upload photos by hand.",
        };
      return { ok: true, candidates: found.candidates, pages: found.pages };
    },
  );

// Step 2: copy a few of those pictures into the site (the page calls this in
// small batches so each call stays quick).
export const adminImportSitePhotos = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid(),
        siteUrl: z.string().trim().min(4).max(300),
        urls: z.array(z.string().max(1200)).min(1).max(4),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<
      | {
          ok: true;
          ids: string[];
          skipped: number;
          total: number;
          reasons: string[];
        }
      | { ok: false; message: string }
    > => {
      try {
        await adminOnly();
      } catch {
        return { ok: false, message: "Not authorized." };
      }
      const business = await businessById(data.businessId);
      const site = business ? await ensureSite(business) : null;
      if (!site) return { ok: false, message: "Site not found." };
      const db = getDb();
      const existing = await db
        .select({ id: websiteSiteAssets.id, kind: websiteSiteAssets.kind })
        .from(websiteSiteAssets)
        .where(eq(websiteSiteAssets.siteId, site.id));
      let count = existing.filter((a) => a.kind === "photo").length;
      const results = await Promise.all(
        data.urls.map((u) => fetchPhoto(u, data.siteUrl).catch(() => null)),
      );
      const ids: string[] = [];
      let skipped = 0;
      const reasons: string[] = [];
      for (const [idx, r] of results.entries()) {
        if (!r || !r.ok || count >= MAX_SITE_PHOTOS) {
          skipped++;
          const file = (data.urls[idx] ?? "").split("?")[0]?.split("/").pop();
          reasons.push(`${file ?? "?"}: ${r && !r.ok ? r.reason : "failed"}`);
          continue;
        }
        const [row] = await db
          .insert(websiteSiteAssets)
          .values({
            siteId: site.id,
            kind: "photo",
            mime: r.mime,
            data: r.data,
            bytes: Math.round((r.data.length * 3) / 4),
          })
          .returning({ id: websiteSiteAssets.id });
        if (row) {
          ids.push(row.id);
          count++;
        } else skipped++;
      }
      if (ids.length > 0) {
        const brief = parseBrief(site.brief);
        if (brief) {
          await touch(site.id, {
            brief: {
              ...brief,
              photoIds: [...brief.photoIds, ...ids].slice(0, MAX_SITE_PHOTOS),
            },
          });
        }
      }
      return { ok: true, ids, skipped, total: count, reasons };
    },
  );

// Clears every photo (not the logo), so an import can be run again cleanly.
export const adminRemoveSitePhotos = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ businessId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    try {
      await adminOnly();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    const business = await businessById(data.businessId);
    const site = business ? await ensureSite(business) : null;
    if (!site) return { ok: false, message: "Site not found." };
    const db = getDb();
    await db
      .delete(websiteSiteAssets)
      .where(
        and(
          eq(websiteSiteAssets.siteId, site.id),
          eq(websiteSiteAssets.kind, "photo"),
        ),
      );
    const brief = parseBrief(site.brief);
    const content = parseContent(site.content);
    await touch(site.id, {
      ...(brief ? { brief: { ...brief, photoIds: [] } } : {}),
      ...(content
        ? {
            content: {
              ...content,
              gallery: [],
              galleryStyle: "grid" as const,
              hero: { ...content.hero, imageId: null },
            },
          }
        : {}),
    });
    return { ok: true };
  });
