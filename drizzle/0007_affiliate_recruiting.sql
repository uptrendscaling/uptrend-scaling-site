-- Affiliate recruiting. Additive only and safe to run twice: one new table for the people we invite
-- to become affiliates, and two nullable columns on affiliates for the onboarding check-in emails.
CREATE TABLE IF NOT EXISTS "affiliate_prospects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text DEFAULT 'agency' NOT NULL,
  "first_name" text DEFAULT 'there' NOT NULL,
  "full_name" text,
  "company" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "audience" text NOT NULL,
  "segment" text,
  "source_url" text,
  "priority" integer DEFAULT 100 NOT NULL,
  "contacted_at" timestamp with time zone,
  "follow_up_sent_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "affiliate_prospects_contacted_at_idx" ON "affiliate_prospects" USING btree ("contacted_at");

ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "checkin1_sent_at" timestamp with time zone;
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "checkin2_sent_at" timestamp with time zone;
