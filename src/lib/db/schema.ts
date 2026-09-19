import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    linkClickedAt: timestamp("link_clicked_at", { withTimezone: true }),
    markedReviewedAt: timestamp("marked_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("customers_business_id_idx").on(table.businessId)],
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revoked: boolean("revoked").notNull().default(false),
});

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Session = typeof sessions.$inferSelect;
