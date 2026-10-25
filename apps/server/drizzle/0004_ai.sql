CREATE TYPE "public"."ai_request_kind" AS ENUM('test', 'text', 'plan', 'analytics');--> statement-breakpoint
CREATE TYPE "public"."ai_status" AS ENUM('not_configured', 'unchecked', 'ok', 'error');--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"kind" "ai_request_kind" NOT NULL,
	"model" text NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" text DEFAULT 'https://api.deepseek.com' NOT NULL,
	"model" text DEFAULT 'deepseek-v4-flash' NOT NULL,
	"api_key_encrypted" text,
	"api_key_mask" text,
	"use_proxy" boolean DEFAULT false NOT NULL,
	"style_guide" text DEFAULT '' NOT NULL,
	"timeout_seconds" integer DEFAULT 60 NOT NULL,
	"max_output_tokens" integer DEFAULT 2000 NOT NULL,
	"daily_request_limit" integer DEFAULT 100 NOT NULL,
	"monthly_token_limit" integer,
	"price_input_per_million" integer,
	"price_output_per_million" integer,
	"status" "ai_status" DEFAULT 'not_configured' NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_singleton" CHECK ("ai_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_created_idx" ON "ai_requests" USING btree ("created_at");