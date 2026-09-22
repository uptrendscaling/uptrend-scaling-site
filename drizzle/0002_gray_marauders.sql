CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"email" text NOT NULL,
	"industry" text DEFAULT 'other' NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"lat" double precision,
	"lng" double precision,
	"outreach_group" text,
	"contacted_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"follow_up_sent_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "access_revoked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_industry_idx" ON "leads" USING btree ("industry");