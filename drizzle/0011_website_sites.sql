CREATE TABLE IF NOT EXISTS "website_sites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "status" text DEFAULT 'awaiting_details' NOT NULL,
  "brief" jsonb,
  "content" jsonb,
  "preview_token" text NOT NULL,
  "custom_domain" text,
  "domain_requested_at" timestamp with time zone,
  "live_at" timestamp with time zone,
  "domain_deadline_at" timestamp with time zone,
  "change_requests" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ai_used" boolean DEFAULT false NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "website_sites_business_idx" ON "website_sites" ("business_id");
CREATE UNIQUE INDEX IF NOT EXISTS "website_sites_slug_idx" ON "website_sites" ("slug");
CREATE INDEX IF NOT EXISTS "website_sites_domain_idx" ON "website_sites" ("custom_domain");
CREATE TABLE IF NOT EXISTS "website_site_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL REFERENCES "website_sites"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "mime" text NOT NULL,
  "data" text NOT NULL,
  "bytes" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "website_site_assets_site_idx" ON "website_site_assets" ("site_id");
CREATE TABLE IF NOT EXISTS "website_site_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL REFERENCES "website_sites"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "service" text,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "website_site_leads_site_idx" ON "website_site_leads" ("site_id","created_at");
