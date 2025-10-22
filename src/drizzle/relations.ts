import { relations } from "drizzle-orm/relations";
import { users, passwords, videos, uploads, transcodeJobs, transcodeInfo, videoTagMap, videoTags, pushSubscriptions, notificationQueue } from "./schema";

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
	pushSubscriptions: many(pushSubscriptions),
	notificationQueues: many(notificationQueue),
}));

export const videosRelations = relations(videos, ({one, many}) => ({
	user: one(users, {
		fields: [videos.userId],
		references: [users.id]
	}),
	uploads: many(uploads),
	transcodeInfos: many(transcodeInfo),
	videoTagMaps: many(videoTagMap),
	notificationQueues: many(notificationQueue),
}));

export const uploadsRelations = relations(uploads, ({one, many}) => ({
	video: one(videos, {
		fields: [uploads.videoId],
		references: [videos.id]
	}),
	user: one(users, {
		fields: [uploads.userId],
		references: [users.id]
	}),
	transcodeJobs: many(transcodeJobs),
}));

export const transcodeJobsRelations = relations(transcodeJobs, ({one}) => ({
	upload: one(uploads, {
		fields: [transcodeJobs.uploadId],
		references: [uploads.id]
	}),
}));

export const transcodeInfoRelations = relations(transcodeInfo, ({one}) => ({
	video: one(videos, {
		fields: [transcodeInfo.videoId],
		references: [videos.id]
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

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({one}) => ({
	user: one(users, {
		fields: [pushSubscriptions.userId],
		references: [users.id]
	}),
}));

export const notificationQueueRelations = relations(notificationQueue, ({one}) => ({
	user: one(users, {
		fields: [notificationQueue.userId],
		references: [users.id]
	}),
	video: one(videos, {
		fields: [notificationQueue.videoId],
		references: [videos.id]
	}),
}));