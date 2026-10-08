-- Quiet hours for review texts. Additive only and safe to run twice: two new
-- nullable columns on customers, nothing dropped or rewritten, so existing
-- rows and the running site are unaffected while this is applied.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "held_sms_kind" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "held_sms_at" timestamp with time zone;

-- The scheduled run looks up waiting texts by this column; partial so it
-- stays tiny (only rows with a text waiting are in it).
CREATE INDEX IF NOT EXISTS "customers_held_sms_at_idx" ON "customers" USING btree ("held_sms_at") WHERE "held_sms_at" IS NOT NULL;
