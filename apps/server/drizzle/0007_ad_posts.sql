ALTER TABLE "posts" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "ad" jsonb;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "delete_after_hours" integer;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "delete_status" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "delete_error" text;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publications_delete_idx" ON "publications" USING btree ("delete_status","delete_at");