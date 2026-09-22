import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// One row per signed-up business (the tenant). Also doubles as the login
// account for that business's owner, since this product is single-user per
// business for now, not a multi-seat team tool.
export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  locations: integer("locations").notNull().default(1),
  passwordHash: text("password_hash"), // null until they set one on the success page
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan", { enum: ["trial", "membership"] }),
  // The business's own "leave a review" link (e.g. their Google Business
  // Profile short link). Customers get redirected here through our own
  // tracked /r/:token route. Null until they fill it in during setup.
  googleReviewUrl: text("google_review_url"),
  // Colby's own account only, for now. Gates the /admin dashboard that shows
  // every client's progress at once, not just this business's own.
  isAdmin: boolean("is_admin").notNull().default(false),
  // Set automatically by the Stripe webhook when this business's
  // subscription is canceled (or goes unpaid), and cleared again if it
  // becomes active again. Blocks /app dashboard access while true.
  accessRevoked: boolean("access_revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The business's own end customers, the people who actually get asked for a review.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    // Short, url-safe token used in the /r/:token tracking redirect link.
    reviewToken: text("review_token").notNull().unique(),
    // Where this customer came from. Manual entries (typed in on /app) default
    // to "manual"; customers pulled in automatically via a connected CRM
    // record which provider sent them.
    source: text("source", { enum: ["manual", "jobber", "square"] })
      .notNull()
      .default("manual"),
    // The provider's own id for this person (Jobber client id, Square
    // customer id). Null for manual entries. Combined with businessId+source,
    // this is how a CRM webhook finds "have we already seen this person"
    // without creating a duplicate customer row for a repeat job.
    externalId: text("external_id"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    linkClickedAt: timestamp("link_clicked_at", { withTimezone: true }),
    markedReviewedAt: timestamp("marked_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("customers_business_id_idx").on(table.businessId),
    // Partial: only enforced when externalId is set, so manual entries keep
    // today's exact behavior (adding the same person twice by hand still
    // creates two rows, unchanged). This only protects the CRM-sourced path.
    uniqueIndex("customers_business_source_external_unique")
      .on(table.businessId, table.source, table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

// One row per SMS or email actually sent (or attempted), for the message log.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["sms", "email"] }).notNull(),
    kind: text("kind", { enum: ["initial", "reminder", "manual"] }).notNull(),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_business_id_idx").on(table.businessId)],
);

// Signed session cookies reference this table so a session can be revoked
// (logout everywhere, or if a password is changed) without needing a JWT
// blocklist.
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revoked: boolean("revoked").notNull().default(false),
});

// Cold-outreach leads -- businesses we've emailed trying to sign them up,
// tracked separately from `businesses` (which is actual paying customers).
// Backs the outreach map on /admin: one pin per lead, filterable by
// industry, with contacted/responded/follow-up status.
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessName: text("business_name").notNull(),
    email: text("email").notNull().unique(),
    industry: text("industry", { enum: ["hvac", "plumbing", "both", "other"] })
      .notNull()
      .default("other"),
    // Street address as looked up; lat/lng geocoded from it for the map pin.
    // Both null until geocoding succeeds (e.g. address not found yet).
    address: text("address"),
    city: text("city"),
    state: text("state"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // Free-text label for which outreach batch/campaign this lead came from
    // (e.g. "2026-09 Phoenix HVAC/Plumbing — Group A").
    outreachGroup: text("outreach_group"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    // Set when a reply is detected (or manually marked). Non-null means the
    // 48-hour follow-up cron skips this lead.
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    followUpSentAt: timestamp("follow_up_sent_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("leads_industry_idx").on(table.industry)],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

// One row per business+provider OAuth connection to a CRM/invoicing tool
// (Jobber, Square, ...). A business can connect each provider once --
// reconnecting overwrites this row rather than creating a second one.
export const crmConnections = pgTable(
  "crm_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["jobber", "square"] }).notNull(),
    // The provider's own id for the connected account (Jobber accountId,
    // Square merchant_id). Inbound webhooks carry only this, never our own
    // businessId -- this is how a webhook gets routed back to a business.
    externalAccountId: text("external_account_id").notNull(),
    // AES-256-GCM ciphertext (lib/crypto.server.ts). Unlike stripeCustomerId
    // above, these tokens grant real access to a client's own CRM, so they're
    // never stored in plaintext.
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    // Set when a lazy token refresh fails (e.g. the business revoked access
    // on the provider's side) -- shown in the UI as "needs reconnect".
    lastErrorMessage: text("last_error_message"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("crm_connections_business_id_idx").on(table.businessId),
    uniqueIndex("crm_connections_business_provider_unique").on(
      table.businessId,
      table.provider,
    ),
    // Also guards against the same Jobber/Square account being connected to
    // two different UpTrend businesses, which would otherwise misroute
    // webhooks between them.
    uniqueIndex("crm_connections_provider_external_account_unique").on(
      table.provider,
      table.externalAccountId,
    ),
  ],
);

// One row per CRM webhook DELIVERY we've processed -- the retry-safety net a
// webhook handler needs but doesn't get for free (unlike the Stripe webhook,
// whose updates are idempotent-by-value, these handlers CREATE customer rows
// and send messages, so a provider retry without this would double-text a
// real person).
export const crmWebhookEvents = pgTable(
  "crm_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider", { enum: ["jobber", "square"] }).notNull(),
    // Square supplies a native event_id (a uuid), used as-is. Jobber's
    // payload has no native id, so we synthesize "topic:itemId:occurredAt"
    // per Jobber's own documented dedup recommendation.
    dedupeKey: text("dedupe_key").notNull(),
    businessId: uuid("business_id").references(() => businesses.id, {
      onDelete: "set null",
    }),
    topic: text("topic").notNull(),
    resultCustomerId: uuid("result_customer_id").references(
      () => customers.id,
      { onDelete: "set null" },
    ),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("crm_webhook_events_provider_dedupe_key_unique").on(
      table.provider,
      table.dedupeKey,
    ),
    index("crm_webhook_events_business_id_idx").on(table.businessId),
  ],
);

export type CrmConnection = typeof crmConnections.$inferSelect;
export type NewCrmConnection = typeof crmConnections.$inferInsert;
export type CrmWebhookEvent = typeof crmWebhookEvents.$inferSelect;
export type NewCrmWebhookEvent = typeof crmWebhookEvents.$inferInsert;

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Session = typeof sessions.$inferSelect;
