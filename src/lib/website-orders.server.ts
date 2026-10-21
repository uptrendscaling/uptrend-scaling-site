// Website orders (build / build + maintenance / maintenance only) and the
// bookkeeping that keeps a business's Stripe subscription in step with what our
// own database says it has.
//
// A business row now exists for EVERY paid website order, not just review plan
// signups, so that:
//   - the affiliate who sent them is credited (businesses.referredBy),
//   - the owner can see the order in the admin Websites view,
//   - the customer can sign in and see their website in their dashboard.
// The row is created by the Stripe webhook the moment checkout completes (no
// password yet; they pick one on the success page, see claimBusinessAccount).
//
// One Stripe subscription can carry two kinds of recurring line: the Google
// review plan and the website maintenance. They are told apart by the product
// name checkout gave them: maintenance contains WEBSITE_LINE_MARKER.

import { eq, or } from "drizzle-orm";
import type Stripe from "stripe";

import { getDb } from "./db/client";
import { businesses, type Business } from "./db/schema";
import { WEBSITE_LINE_MARKER, websiteOptionById } from "./pricing";

type Meta = Record<string, string | undefined | null>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ---- Fields a paid checkout puts on the business row ------------------------

export type WebsiteFields = Partial<typeof businesses.$inferInsert>;

// Pure. Turns the checkout metadata into the business columns it sets.
// `existing` keeps a build that is already underway from being reset to
// "ordered" if the same event arrives twice.
export function websiteFieldsFromMetadata(
  metadata: Meta,
  opts: { subscriptionId: string | null; existing?: Business | null },
): WebsiteFields {
  const option = websiteOptionById(metadata["website"] ?? undefined);
  if (!option) return {};
  const includesReviews = metadata["reviews"] !== "no";
  const fields: WebsiteFields = {
    websitePlan: option.id,
    websiteOrderedAt: opts.existing?.websiteOrderedAt ?? new Date(),
    // A site they already have is live from day one; a new build starts as
    // "ordered" and moves along in the admin Websites view.
    websiteStatus:
      opts.existing?.websiteStatus ??
      (option.id === "maintenance" ? "live" : "ordered"),
    maintenanceActive: option.monthlyCents > 0,
    maintenanceCanceledAt: null,
  };
  const url = str(metadata["websiteUrl"]);
  if (url) fields.websiteUrl = url;
  if (opts.subscriptionId) {
    if (includesReviews) fields.stripeSubscriptionId = opts.subscriptionId;
    else fields.websiteSubscriptionId = opts.subscriptionId;
  }
  return fields;
}

// ---- Create / update the business when a website checkout completes ---------

function subscriptionIdOf(session: Stripe.Checkout.Session): string | null {
  const sub = session.subscription;
  if (typeof sub === "string") return sub;
  if (sub && typeof sub === "object" && "id" in sub) return sub.id;
  return null;
}

// Called by the webhook on checkout.session.completed. Only does anything for
// website orders (metadata.website). Safe to run twice for the same session.
export async function recordWebsiteOrder(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const metadata = (session.metadata ?? {}) as Meta;
  const option = websiteOptionById(metadata["website"] ?? undefined);
  if (!option) return;
  // Card payments are already paid when checkout completes. Anything else
  // (delayed methods) waits for a later event, which we do not handle.
  if (session.payment_status === "unpaid") return;

  const email = str(session.customer_details?.email ?? session.customer_email);
  if (!email) return;

  const db = getDb();
  const [existing] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.email, email))
    .limit(1);

  const includesReviews = metadata["reviews"] !== "no";
  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const referredBy = str(metadata["affiliate"]);
  const fields = websiteFieldsFromMetadata(metadata, {
    subscriptionId: subscriptionIdOf(session),
    existing: existing ?? null,
  });

  if (existing) {
    await db
      .update(businesses)
      .set({
        ...fields,
        stripeCustomerId: existing.stripeCustomerId ?? customerId,
        referredBy: existing.referredBy ?? referredBy,
      })
      .where(eq(businesses.id, existing.id));
    await startSiteBuild(email, option.buildCents);
    return;
  }

  const locationsRaw = Number(metadata["locations"]);
  await db
    .insert(businesses)
    .values({
      businessName: str(metadata["businessName"]) ?? "New business",
      contactName: str(metadata["contactName"]) ?? "Owner",
      email,
      phone: str(metadata["phone"]) ?? "",
      locations:
        Number.isFinite(locationsRaw) && locationsRaw > 0
          ? Math.round(locationsRaw)
          : 1,
      stripeCustomerId: customerId,
      referredBy,
      plan:
        includesReviews && metadata["plan"] === "membership"
          ? "membership"
          : null,
      ...fields,
    })
    .onConflictDoNothing({ target: businesses.email });
  await startSiteBuild(email, option.buildCents);
}

// A paid website build gets its site record and an email with the link to the
// details form. Never lets a problem here undo the order itself.
async function startSiteBuild(
  email: string,
  buildCents: number,
): Promise<void> {
  if (buildCents <= 0) return;
  try {
    const { startSiteForOrder } = await import("./site-gen/sites.server");
    await startSiteForOrder(email);
  } catch (error) {
    console.error("[website-orders] could not start the site build", error);
  }
}

// ---- What a subscription carries -----------------------------------------------

export type SubscriptionItemKind = "reviews" | "maintenance";
export type ClassifiedItem = { id: string; kind: SubscriptionItemKind };

// Sorts a subscription's items into review plan and website maintenance by
// product name. Needs a Stripe call (the product is not on the event).
export async function classifySubscriptionItems(
  stripe: Stripe,
  subscriptionId: string,
): Promise<{ status: Stripe.Subscription.Status; items: ClassifiedItem[] }> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
  const items: ClassifiedItem[] = subscription.items.data.map((item) => {
    const product = item.price.product;
    const name =
      typeof product === "object" && product && "name" in product
        ? String(product.name)
        : "";
    return {
      id: item.id,
      kind: name.includes(WEBSITE_LINE_MARKER) ? "maintenance" : "reviews",
    };
  });
  return { status: subscription.status, items };
}

// ---- Keep the database in step with a subscription ---------------------------

// Statuses that bring review access back (same as before website orders).
const RESTORING_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
]);
// Statuses that mean the subscription is over for good.
const DEAD_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

export type SubscriptionSync = {
  // Undefined means "leave it alone".
  accessRevoked?: boolean;
  reviewsCanceledAt?: Date | null;
  maintenanceActive?: boolean;
  maintenanceCanceledAt?: Date | null;
};

// Pure. Given what the business row says and what the subscription now holds,
// says what to change. `carries` is what is on the subscription right now
// (nothing, when it was deleted).
export function planSubscriptionSync(
  business: Pick<
    Business,
    | "plan"
    | "accessRevoked"
    | "maintenanceActive"
    | "stripeSubscriptionId"
    | "websiteSubscriptionId"
  >,
  subscriptionId: string,
  status: Stripe.Subscription.Status | "deleted",
  carries: { reviews: boolean; maintenance: boolean },
  now: Date = new Date(),
): SubscriptionSync {
  const dead = status === "deleted" || DEAD_STATUSES.has(status);
  const restoring = status !== "deleted" && RESTORING_STATUSES.has(status);
  const isReviewSub = business.stripeSubscriptionId === subscriptionId;
  const isWebsiteSub = business.websiteSubscriptionId === subscriptionId;
  const change: SubscriptionSync = {};

  // Review access follows the review subscription. A website-only account has
  // no review plan, so it is never locked out of its dashboard.
  if (isReviewSub && business.plan) {
    const stillHasReviews = carries.reviews && !dead;
    if (!stillHasReviews && !business.accessRevoked) {
      change.accessRevoked = true;
      change.reviewsCanceledAt = now;
    } else if (stillHasReviews && restoring && business.accessRevoked) {
      change.accessRevoked = false;
      change.reviewsCanceledAt = null;
    }
  }

  // Maintenance follows whichever subscription carries it: the separate
  // website subscription when there is one, otherwise the review one.
  const carriesMaintenanceHere =
    isWebsiteSub || (isReviewSub && !business.websiteSubscriptionId);
  if (carriesMaintenanceHere) {
    const maintenanceOn = carries.maintenance && !dead;
    if (maintenanceOn && !business.maintenanceActive) {
      change.maintenanceActive = true;
      change.maintenanceCanceledAt = null;
    } else if (!maintenanceOn && business.maintenanceActive) {
      change.maintenanceActive = false;
      change.maintenanceCanceledAt = now;
    }
  }
  return change;
}

export async function syncBusinessWithSubscription(
  stripe: Stripe,
  subscriptionId: string,
  eventStatus: Stripe.Subscription.Status | "deleted",
): Promise<void> {
  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(
      or(
        eq(businesses.stripeSubscriptionId, subscriptionId),
        eq(businesses.websiteSubscriptionId, subscriptionId),
      ),
    )
    .limit(1);
  // Checkout was started but never recorded: nothing to sync.
  if (!business) return;

  let carries = { reviews: false, maintenance: false };
  if (eventStatus !== "deleted") {
    const { items } = await classifySubscriptionItems(stripe, subscriptionId);
    carries = {
      reviews: items.some((i) => i.kind === "reviews"),
      maintenance: items.some((i) => i.kind === "maintenance"),
    };
  }
  const change = planSubscriptionSync(
    business,
    subscriptionId,
    eventStatus,
    carries,
  );
  if (Object.keys(change).length === 0) return;
  await db.update(businesses).set(change).where(eq(businesses.id, business.id));
}
