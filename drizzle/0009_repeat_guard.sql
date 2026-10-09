-- Repeat-customer guard: ask the same person at most once every 90 days.
-- On by default; owners can switch it off in Settings.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "repeat_guard_enabled" boolean DEFAULT true NOT NULL;
