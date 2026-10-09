-- One row per cold email sent from the Zoho cold-email mailboxes
-- (getuptrendscaling.com / tryuptrendscaling.com). Used to keep each
-- mailbox inside its daily warm-up limit and to report what went out.
CREATE TABLE IF NOT EXISTS "cold_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sender" text NOT NULL,
  "recipient" text NOT NULL,
  "kind" text NOT NULL,
  "ref_id" uuid,
  "message_id" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cold_sends_sender_sent_at_idx" ON "cold_sends" ("sender", "sent_at");
CREATE INDEX IF NOT EXISTS "cold_sends_recipient_idx" ON "cold_sends" ("recipient");
