-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."upload_state_type" AS ENUM('created', 'partially_uploaded', 'completed');--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"video_id" bigint,
	"user_id" bigint NOT NULL,
	"upload_name" text,
	"tus_id" text NOT NULL,
	"state" "upload_state_type" DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"profile_image_path" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "passwords" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"password" text NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"likes" bigint DEFAULT 0 NOT NULL,
	"dislikes" bigint DEFAULT 0 NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"user_id" bigint,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_likes_check" CHECK (likes >= 0),
	CONSTRAINT "videos_dislikes_check" CHECK (dislikes >= 0),
	CONSTRAINT "videos_views_check" CHECK (views >= 0)
);
--> statement-breakpoint
CREATE TABLE "video_info" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"video_id" bigint NOT NULL,
	"path" text NOT NULL,
	"duration" interval,
	"size_bytes" bigint,
	"bitrate_bps" bigint,
	"codec" text NOT NULL,
	"pixel_format" text NOT NULL,
	"width" integer,
	"height" integer,
	"fps" numeric(6, 3),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_info_video_id_key" UNIQUE("video_id"),
	CONSTRAINT "video_info_size_bytes_check" CHECK (size_bytes >= 0),
	CONSTRAINT "video_info_bitrate_bps_check" CHECK (bitrate_bps >= 0),
	CONSTRAINT "video_info_width_check" CHECK (width >= 0),
	CONSTRAINT "video_info_height_check" CHECK (height >= 0),
	CONSTRAINT "video_info_fps_check" CHECK (fps > (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "video_tags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_tag_map" (
	"video_id" bigint NOT NULL,
	"tag_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "video_tag_map_pkey" PRIMARY KEY("video_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passwords" ADD CONSTRAINT "passwords_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_info" ADD CONSTRAINT "video_info_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_tag_map" ADD CONSTRAINT "video_tag_map_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_tag_map" ADD CONSTRAINT "video_tag_map_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."video_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passwords_user_id_idx" ON "passwords" USING btree ("user_id" int8_ops);--> statement-breakpoint
CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "videos_fts_idx" ON "videos" USING gin (to_tsvector('simple'::regconfig, ((COALESCE(title, ''::text) || tsvector_ops);--> statement-breakpoint
CREATE INDEX "videos_not_hidden_recent_idx" ON "videos" USING btree ("created_at" timestamptz_ops) WHERE (hidden = false);--> statement-breakpoint
CREATE INDEX "videos_public_id_idx" ON "videos" USING btree ("public_id" text_ops);--> statement-breakpoint
CREATE INDEX "videos_user_id_idx" ON "videos" USING btree ("user_id" int8_ops);--> statement-breakpoint
CREATE INDEX "videos_views_idx" ON "videos" USING btree ("views" int8_ops);--> statement-breakpoint
CREATE INDEX "video_info_fps_idx" ON "video_info" USING btree ("fps" numeric_ops);--> statement-breakpoint
CREATE INDEX "video_info_meta_gin_idx" ON "video_info" USING gin ("metadata" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "video_info_video_id_idx" ON "video_info" USING btree ("video_id" int8_ops);--> statement-breakpoint
CREATE INDEX "video_info_wh_idx" ON "video_info" USING btree ("width" int4_ops,"height" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "video_tags_tag_lower_uidx" ON "video_tags" USING btree (lower(tag) text_ops);--> statement-breakpoint
CREATE INDEX "video_tag_map_tag_id_idx" ON "video_tag_map" USING btree ("tag_id" int8_ops);
*/