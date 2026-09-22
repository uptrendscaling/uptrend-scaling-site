CREATE TABLE "crm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text,
	"last_error_message" text,
	"last_error_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"business_id" uuid,
	"topic" text NOT NULL,
	"result_customer_id" uuid,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_events" ADD CONSTRAINT "crm_webhook_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_events" ADD CONSTRAINT "crm_webhook_events_result_customer_id_customers_id_fk" FOREIGN KEY ("result_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_connections_business_id_idx" ON "crm_connections" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_connections_business_provider_unique" ON "crm_connections" USING btree ("business_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_connections_provider_external_account_unique" ON "crm_connections" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_webhook_events_provider_dedupe_key_unique" ON "crm_webhook_events" USING btree ("provider","dedupe_key");--> statement-breakpoint
CREATE INDEX "crm_webhook_events_business_id_idx" ON "crm_webhook_events" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_business_source_external_unique" ON "customers" USING btree ("business_id","source","external_id") WHERE "customers"."external_id" is not null;