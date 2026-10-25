CREATE TYPE "public"."mtproto_status" AS ENUM('disconnected', 'active', 'flood_wait', 'error');--> statement-breakpoint
ALTER TYPE "public"."metric_source" ADD VALUE 'mtproto';--> statement-breakpoint
CREATE TABLE "mtproto_account" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"api_id" integer,
	"api_hash_encrypted" text,
	"session_encrypted" text,
	"tg_user_id" bigint,
	"display_name" text,
	"phone_mask" text,
	"status" "mtproto_status" DEFAULT 'disconnected' NOT NULL,
	"flood_until" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_count" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mtproto_account_singleton" CHECK ("mtproto_account"."id" = 1)
);
