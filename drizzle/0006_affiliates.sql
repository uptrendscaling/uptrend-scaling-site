-- Affiliate program and membership levels. Additive only and safe to run twice: one new nullable
-- column on businesses and two new tables. Nothing existing is changed.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "referred_by" text;
-- Membership level (starter / growth / pro). Existing accounts become Starter.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "tier" text DEFAULT 'starter' NOT NULL;

CREATE TABLE IF NOT EXISTS "affiliates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "paypal_email" text,
  "website" text,
  "promote_plan" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "code" text UNIQUE,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "affiliates_email_idx" ON "affiliates" USING btree ("email");

CREATE TABLE IF NOT EXISTS "affiliate_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL REFERENCES "affiliates"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "note" text,
  "paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "affiliate_payouts_affiliate_id_idx" ON "affiliate_payouts" USING btree ("affiliate_id");
