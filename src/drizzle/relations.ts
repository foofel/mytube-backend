import { relations } from "drizzle-orm/relations";
import { videos, transcodeJobs, transcodeInfo, users, passwords, uploads, videoTagMap, videoTags } from "./schema";

export const transcodeJobsRelations = relations(transcodeJobs, ({one}) => ({
	video: one(videos, {
		fields: [transcodeJobs.videoId],
		references: [videos.id]
	}),
}));

export const videosRelations = relations(videos, ({one, many}) => ({
	transcodeJobs: many(transcodeJobs),
	transcodeInfos: many(transcodeInfo),
	user: one(users, {
		fields: [videos.userId],
		references: [users.id]
	}),
	uploads: many(uploads),
	videoTagMaps: many(videoTagMap),
}));

export const transcodeInfoRelations = relations(transcodeInfo, ({one}) => ({
	video: one(videos, {
		fields: [transcodeInfo.videoId],
		references: [videos.id]
	}),
}));

export const passwordsRelations = relations(passwords, ({one}) => ({
	user: one(users, {
		fields: [passwords.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	passwords: many(passwords),
	videos: many(videos),
	uploads: many(uploads),
}));

export const uploadsRelations = relations(uploads, ({one}) => ({
	video: one(videos, {
		fields: [uploads.videoId],
		references: [videos.id]
	}),
	user: one(users, {
		fields: [uploads.userId],
		references: [users.id]
	}),
}));

export const videoTagMapRelations = relations(videoTagMap, ({one}) => ({
	video: one(videos, {
		fields: [videoTagMap.videoId],
		references: [videos.id]
	}),
	videoTag: one(videoTags, {
		fields: [videoTagMap.tagId],
		references: [videoTags.id]
	}),
}));

export const videoTagsRelations = relations(videoTags, ({many}) => ({
	videoTagMaps: many(videoTagMap),
}));