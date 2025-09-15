import { pgTable, bigserial, text, timestamp, index, foreignKey, bigint, uniqueIndex, check, jsonb, integer, numeric, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const transcodeStateType = pgEnum("transcode_state_type", ['created', 'transcoding', 'completed'])
export const uploadStateType = pgEnum("upload_state_type", ['created', 'partially_uploaded', 'completed'])
export const videoVisibilityState = pgEnum("video_visibility_state", ['public', 'shareable', 'users', 'friends', 'private'])


export const users = pgTable("users", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	name: text().notNull(),
	profileImagePath: text("profile_image_path"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const passwords = pgTable("passwords", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	password: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("passwords_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "passwords_user_id_fkey"
		}).onDelete("cascade"),
]);

export const videoTags = pgTable("video_tags", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	tag: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("video_tags_tag_lower_uidx").using("btree", sql`lower(tag)`),
]);

export const videos = pgTable("videos", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	publicId: text("public_id"),
	title: text(),
	description: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	likes: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dislikes: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	views: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	visibilityState: videoVisibilityState("visibility_state").default('private').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("videos_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("videos_fts_idx").using("gin", sql`to_tsvector('simple'::regconfig, ((COALESCE(title, ''::text) ||`),
	index("videos_public_id_idx").using("btree", table.publicId.asc().nullsLast().op("text_ops")),
	index("videos_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	index("videos_views_idx").using("btree", table.views.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "videos_user_id_fkey"
		}).onDelete("set null"),
	check("videos_likes_check", sql`likes >= 0`),
	check("videos_dislikes_check", sql`dislikes >= 0`),
	check("videos_views_check", sql`views >= 0`),
]);

export const uploads = pgTable("uploads", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	tusId: text("tus_id").notNull(),
	tusInfo: jsonb("tus_info").notNull(),
	state: uploadStateType().default('created').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_uploads_video_id").using("btree", table.videoId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videos.id],
			name: "uploads_video_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "uploads_user_id_fkey"
		}).onDelete("cascade"),
]);

export const transcodeJobs = pgTable("transcode_jobs", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }).notNull(),
	inputPath: text("input_path").notNull(),
	outputPath: text("output_path").notNull(),
	outputId: text("output_id").notNull(),
	transcodeResult: jsonb("transcode_result"),
	state: transcodeStateType().default('created').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videos.id],
			name: "transcode_jobs_video_id_fkey"
		}).onDelete("cascade"),
]);

export const transcodeInfo = pgTable("transcode_info", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }).notNull(),
	path: text().notNull(),
	duration: integer(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bitrateKbps: bigint("bitrate_kbps", { mode: "number" }),
	videoCodec: text("video_codec"),
	audioCodec: text("audio_codec"),
	pixelFormat: text("pixel_format"),
	width: integer(),
	height: integer(),
	fps: numeric({ precision: 6, scale:  3 }),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("video_info_fps_idx").using("btree", table.fps.asc().nullsLast().op("numeric_ops")),
	index("video_info_meta_gin_idx").using("gin", table.metadata.asc().nullsLast().op("jsonb_path_ops")),
	index("video_info_wh_idx").using("btree", table.width.asc().nullsLast().op("int4_ops"), table.height.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videos.id],
			name: "transcode_info_video_id_fkey"
		}).onDelete("cascade"),
	check("transcode_info_size_bytes_check", sql`size_bytes >= 0`),
	check("transcode_info_bitrate_kbps_check", sql`bitrate_kbps >= 0`),
	check("transcode_info_width_check", sql`width >= 0`),
	check("transcode_info_height_check", sql`height >= 0`),
	check("transcode_info_fps_check", sql`fps > (0)::numeric`),
]);

export const videoTagMap = pgTable("video_tag_map", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tagId: bigint("tag_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("video_tag_map_tag_id_idx").using("btree", table.tagId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videos.id],
			name: "video_tag_map_video_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [videoTags.id],
			name: "video_tag_map_tag_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.videoId, table.tagId], name: "video_tag_map_pkey"}),
]);
