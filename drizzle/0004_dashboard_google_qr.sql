-- Additive only. Every statement is safe to run twice. Nothing is dropped,
-- renamed, or rewritten, and every new column on an existing table is either
-- nullable or has a default, so existing rows and the running site are
-- unaffected while this is applied.

-- businesses: timezone + weekly summary bookkeeping
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'America/Phoenix' NOT NULL;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "weekly_summary_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "last_summary_sent_at" timestamp with time zone;

-- crm_connections: Google location + "last synced" time
ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "external_location_id" text;
ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "external_location_name" text;
ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "last_event_at" timestamp with time zone;

-- messages: index for the dashboard's time-window queries
CREATE INDEX IF NOT EXISTS "messages_business_sent_at_idx" ON "messages" USING btree ("business_id","sent_at");

-- Google rating snapshots
CREATE TABLE IF NOT EXISTS "google_rating_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL,
  "taken_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rating" double precision NOT NULL,
  "total_reviews" integer NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "google_rating_snapshots" ADD CONSTRAINT "google_rating_snapshots_business_id_businesses_id_fk"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "google_rating_snapshots_business_taken_idx" ON "google_rating_snapshots" USING btree ("business_id","taken_at");

-- Google reviews
CREATE TABLE IF NOT EXISTS "google_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL,
  "external_review_id" text NOT NULL,
  "reviewer_name" text,
  "star_rating" integer NOT NULL,
  "comment" text,
  "reviewed_at" timestamp with time zone NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "google_reviews" ADD CONSTRAINT "google_reviews_business_id_businesses_id_fk"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "google_reviews_business_external_unique" ON "google_reviews" USING btree ("business_id","external_review_id");
CREATE INDEX IF NOT EXISTS "google_reviews_business_reviewed_idx" ON "google_reviews" USING btree ("business_id","reviewed_at");

-- QR codes
CREATE TABLE IF NOT EXISTS "qr_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL,
  "token" text NOT NULL,
  "label" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "qr_codes_token_unique" UNIQUE("token")
);
DO $$ BEGIN
  ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_business_id_businesses_id_fk"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "qr_codes_business_id_idx" ON "qr_codes" USING btree ("business_id");

-- QR scans
CREATE TABLE IF NOT EXISTS "qr_scans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "qr_code_id" uuid NOT NULL,
  "business_id" uuid NOT NULL,
  "scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "city" text,
  "region" text
);
DO $$ BEGIN
  ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_qr_code_id_qr_codes_id_fk"
    FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_business_id_businesses_id_fk"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "qr_scans_business_scanned_idx" ON "qr_scans" USING btree ("business_id","scanned_at");
CREATE INDEX IF NOT EXISTS "qr_scans_qr_code_id_idx" ON "qr_scans" USING btree ("qr_code_id");
