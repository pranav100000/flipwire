CREATE TYPE "public"."availability_status" AS ENUM('active', 'inactive', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."ingestion_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payload_type" AS ENUM('api_response', 'html', 'json', 'screenshot', 'export');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('unmatched_event', 'ambiguous_event', 'artist_alias', 'venue_alias', 'invalid_date', 'listing_without_event');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('ticket_data', 'tickpick', 'b2b');--> statement-breakpoint
CREATE TABLE "artist_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" "source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_canonical_name_unique" UNIQUE("canonical_name")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"event_name" text,
	"starts_at" timestamp with time zone NOT NULL,
	"source_event_key" text,
	"canonical_event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_canonical_event_key_unique" UNIQUE("canonical_event_key")
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"status" "ingestion_job_status" DEFAULT 'pending' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(255),
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text DEFAULT '' NOT NULL,
	"ingestion_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ingestion_jobs_ingestion_run_id_unique" UNIQUE("ingestion_run_id")
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"status" "ingestion_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"records_found" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"source_listing_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"listing_url" text NOT NULL,
	"section" text,
	"row" text,
	"seat_details" text,
	"quantity" integer,
	"unit_price" numeric(12, 2) NOT NULL,
	"total_price" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"availability_status" "availability_status" DEFAULT 'unknown' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missed_runs" integer DEFAULT 0 NOT NULL,
	"raw_payload_id" uuid
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"source" "source" NOT NULL,
	"get_in_price" numeric(12, 2),
	"median_price" numeric(12, 2),
	"low_price" numeric(12, 2),
	"high_price" numeric(12, 2),
	"listing_count" integer,
	"inventory_count" integer,
	"forecast_value" numeric(12, 2),
	"forecast_text" text,
	"observed_at" timestamp with time zone NOT NULL,
	"raw_payload_id" uuid
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"source" "source" NOT NULL,
	"metric_name" text NOT NULL,
	"metric_value" numeric(12, 2) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"raw_payload_id" uuid
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"source_url" text,
	"payload_type" "payload_type" NOT NULL,
	"storage_path" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_kind" NOT NULL,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"source" "source" NOT NULL,
	"source_event_id" text DEFAULT '' NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"candidate_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_payload_id" uuid,
	"resolved_event_id" uuid,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fixture_mode" boolean DEFAULT true NOT NULL,
	"cadence_minutes" integer DEFAULT 120 NOT NULL,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"backoff_seconds" integer DEFAULT 2 NOT NULL,
	"rate_limit_seconds" numeric(7, 3) DEFAULT '0' NOT NULL,
	"stale_after_missed_runs" integer DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_configs_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE "source_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"source_event_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"raw_payload_id" uuid,
	"raw_artist_name" text DEFAULT '' NOT NULL,
	"raw_event_name" text DEFAULT '' NOT NULL,
	"raw_venue_name" text DEFAULT '' NOT NULL,
	"raw_city" text DEFAULT '' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"city" text NOT NULL,
	"source" "source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"display_name" text NOT NULL,
	"city" text NOT NULL,
	"state_region" text DEFAULT '' NOT NULL,
	"country" varchar(2) DEFAULT 'US' NOT NULL,
	"timezone" text NOT NULL,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_aliases" ADD CONSTRAINT "artist_aliases_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resolved_event_id_events_id_fk" FOREIGN KEY ("resolved_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_aliases" ADD CONSTRAINT "venue_aliases_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_artist_starts_at_index" ON "events" USING btree ("artist_id","starts_at");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_status_available_index" ON "ingestion_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_status_index" ON "ingestion_runs" USING btree ("source","status");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_id_unique" ON "listings" USING btree ("source","source_listing_id");--> statement-breakpoint
CREATE INDEX "listings_event_source_status_price_index" ON "listings" USING btree ("event_id","source","availability_status","unit_price");--> statement-breakpoint
CREATE UNIQUE INDEX "market_snapshots_observation_unique" ON "market_snapshots" USING btree ("event_id","source","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_point_unique" ON "price_history" USING btree ("event_id","source","metric_name","observed_at");--> statement-breakpoint
CREATE INDEX "raw_payloads_source_hash_index" ON "raw_payloads" USING btree ("source","content_hash");--> statement-breakpoint
CREATE INDEX "review_items_status_kind_source_index" ON "review_items" USING btree ("status","kind","source");--> statement-breakpoint
CREATE UNIQUE INDEX "source_events_source_id_unique" ON "source_events" USING btree ("source","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_aliases_alias_city_unique" ON "venue_aliases" USING btree ("alias","city");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_canonical_location_unique" ON "venues" USING btree ("canonical_name","city","state_region","country");