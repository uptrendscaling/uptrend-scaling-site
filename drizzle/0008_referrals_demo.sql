-- Customer referral links and partner demo accounts. Additive only and safe to run twice.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'application' NOT NULL;
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "business_id" uuid REFERENCES "businesses"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_business_id_unique" ON "affiliates" USING btree ("business_id") WHERE "business_id" IS NOT NULL;
