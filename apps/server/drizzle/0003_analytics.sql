CREATE TYPE "public"."member_event_kind" AS ENUM('join', 'leave');--> statement-breakpoint
CREATE TYPE "public"."metric_source" AS ENUM('telegram_api', 'manual');--> statement-breakpoint
CREATE TABLE "channel_member_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"kind" "member_event_kind" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"invite_link_name" text
);
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" integer NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"publication_id" uuid,
	"media_group_id" text,
	"summary" text NOT NULL,
	"has_media" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_metric_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" integer NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "metric_source" NOT NULL,
	"method_version" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_metric_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" integer NOT NULL,
	"metric" text NOT NULL,
	"value" integer NOT NULL,
	"details" jsonb,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "metric_source" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_member_events" ADD CONSTRAINT "channel_member_events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_metric_snapshots" ADD CONSTRAINT "channel_metric_snapshots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_metric_snapshots" ADD CONSTRAINT "message_metric_snapshots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_member_events_idx" ON "channel_member_events" USING btree ("channel_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_messages_unique_idx" ON "channel_messages" USING btree ("channel_id","message_id");--> statement-breakpoint
CREATE INDEX "channel_messages_posted_idx" ON "channel_messages" USING btree ("channel_id","posted_at");--> statement-breakpoint
CREATE INDEX "channel_metric_snapshots_idx" ON "channel_metric_snapshots" USING btree ("channel_id","metric","measured_at");--> statement-breakpoint
CREATE INDEX "message_metric_snapshots_idx" ON "message_metric_snapshots" USING btree ("channel_id","message_id","metric","measured_at");