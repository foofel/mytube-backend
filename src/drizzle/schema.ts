import { pgTable, index, bigserial, text, timestamp, foreignKey, bigint, check, point, boolean, uniqueIndex, jsonb, integer, doublePrecision, unique, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const transcodeStateType = pgEnum("transcode_state_type", ['created', 'transcoding', 'completed'])
export const uploadStateType = pgEnum("upload_state_type", ['created', 'partially_uploaded', 'completed'])
export const videoVisibilityState = pgEnum("video_visibility_state", ['public', 'shareable', 'users', 'friends', 'private'])


export const users = pgTable("users", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	displayName: text("display_name").notNull(),
	profileImagePath: text("profile_image_path"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("users_display_name_lower_gin_trgm_idx").using("gin", sql`lower(display_name)`),
]);

export const passwords = pgTable("passwords", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	name: text().notNull(),
	password: text().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "passwords_user_id_fkey"
		}).onDelete("cascade"),
]);

export const videos = pgTable("videos", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	publicId: text("public_id").notNull(),
	title: text(),
	description: text(),
	posterImage: text("poster_image"),
	extRef: text("ext_ref"),
	gps: point(),
	ready: boolean().default(false).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	likes: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	dislikes: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	views: bigint({ mode: "number" }).default(0).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	visibilityState: videoVisibilityState("visibility_state").default('private').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_videos_desc_trgm_ci").using("gin", sql`norm_ci(description)`),
	index("idx_videos_title_trgm_ci").using("gin", sql`norm_ci(title)`),
	index().using("btree", table.publicId.asc().nullsLast().op("text_ops")),
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
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	tusId: text("tus_id").notNull(),
	tusInfo: jsonb("tus_info").notNull(),
	state: uploadStateType().default('created').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uploads_tus_id_uq").using("btree", table.tusId.asc().nullsLast().op("text_ops")),
	index("uploads_user_id_created_at_idx").using("btree", table.userId.asc().nullsLast().op("int8_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("uploads_video_id_idx").using("btree", table.videoId.asc().nullsLast().op("int8_ops")),
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
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	uploadId: bigint("upload_id", { mode: "number" }).notNull(),
	inputPath: text("input_path").notNull(),
	outputPath: text("output_path").notNull(),
	transcodeResult: jsonb("transcode_result"),
	state: transcodeStateType().default('created').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("transcode_jobs_state_created_at_idx").using("btree", table.state.asc().nullsLast().op("enum_ops")),
	index("transcode_jobs_upload_id_idx").using("btree", table.uploadId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.uploadId],
			foreignColumns: [uploads.id],
			name: "transcode_jobs_upload_id_fkey"
		}).onDelete("cascade"),
]);

export const transcodeInfo = pgTable("transcode_info", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }).notNull(),
	path: text().notNull(),
	duration: integer(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	bitrateKbps: bigint("bitrate_kbps", { mode: "number" }),
	videoCodec: text("video_codec"),
	audioCodec: text("audio_codec"),
	pixelFormat: text("pixel_format"),
	width: integer(),
	height: integer(),
	fps: doublePrecision(),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("transcode_info_video_id_idx").using("btree", table.videoId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videos.id],
			name: "transcode_info_video_id_fkey"
		}).onDelete("cascade"),
	check("transcode_info_size_bytes_check", sql`size_bytes >= 0`),
	check("transcode_info_bitrate_kbps_check", sql`bitrate_kbps >= 0`),
	check("transcode_info_width_check", sql`width >= 0`),
	check("transcode_info_height_check", sql`height >= 0`),
	check("transcode_info_fps_check", sql`fps >= (0)::double precision`),
]);

export const videoTagMap = pgTable("video_tag_map", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	tagId: bigint("tag_id", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("video_tag_map_tag_id_video_id_idx").using("btree", table.tagId.asc().nullsLast().op("int8_ops"), table.videoId.asc().nullsLast().op("int8_ops")),
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
	unique("video_tag_map_video_id_tag_id_key").on(table.videoId, table.tagId),
]);

export const videoTags = pgTable("video_tags", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	tag: text().notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("video_tags_tag_lower_gin_trgm_idx").using("gin", sql`lower(tag)`),
]);

export const pushSubscriptions = pgTable("push_subscriptions", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	endpoint: text().notNull(),
	p256dh: text().notNull(),
	auth: text().notNull(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	lastUsed: timestamp("last_used", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_push_subscriptions_user_id").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "push_subscriptions_user_id_fkey"
		}).onDelete("cascade"),
	unique("push_subscriptions_user_id_endpoint_key").on(table.userId, table.endpoint),
]);

export const notificationQueue = pgTable("notification_queue", {
	id: bigserial({ mode: "number" }).primaryKey().notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	userId: bigint("user_id", { mode: "number" }).notNull(),
	// You can use { mode: "number" } if numbers are exceeding js number limitations
	videoId: bigint("video_id", { mode: "number" }),
	notificationType: text("notification_type").notNull(),
	title: text().notNull(),
	body: text().notNull(),
	data: jsonb(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	status: text().default('pending'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_notification_queue_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_notification_queue_user_id").using("btree", table.userId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notification_queue_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.videoId],
			foreignColumns: [videos.id],
			name: "notification_queue_video_id_fkey"
		}).onDelete("cascade"),
]);
