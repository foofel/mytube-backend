import { db } from './orm';
import { videos, users, notificationQueue, pushSubscriptions } from './drizzle/schema';
import { eq } from 'drizzle-orm';
import { sendNotificationToUser, sendNotificationToUsers, type NotificationPayload } from './push-notifications';

/**
 * Queue a notification in the database
 */
async function queueNotification(
  userId: number,
  videoId: number | null,
  notificationType: string,
  title: string,
  body: string,
  data?: any
): Promise<void> {
  try {
    await db.insert(notificationQueue).values({
      userId,
      videoId,
      notificationType,
      title,
      body,
      data: data || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error queueing notification:', error);
  }
}

/**
 * Mark notification as sent in the queue
 */
async function markNotificationSent(notificationId: number): Promise<void> {
  try {
    await db
      .update(notificationQueue)
      .set({
        status: 'sent',
        sentAt: new Date().toISOString(),
      })
      .where(eq(notificationQueue.id, notificationId));
  } catch (error) {
    console.error('Error marking notification as sent:', error);
  }
}

/**
 * Notify user when their video has finished processing
 */
export async function notifyVideoProcessed(
  videoId: number,
  userId: number
): Promise<void> {
  try {
    const [video] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, videoId));

    if (!video) {
      console.error(`Video ${videoId} not found`);
      return;
    }

    const payload: NotificationPayload = {
      title: '✅ Video Ready!',
      body: `Your video "${video.title || 'Untitled'}" has finished processing`,
      icon: video.posterImage || '/icon-192.png',
      data: {
        url: `/video/${video.publicId}`,
        videoId: video.publicId,
        type: 'video_processed',
      },
      actions: [
        {
          action: 'view',
          title: 'View Video',
        },
      ],
    };

    // Queue the notification
    await queueNotification(
      userId,
      videoId,
      'video_processed',
      payload.title,
      payload.body,
      payload.data
    );

    // Send the notification
    const result = await sendNotificationToUser(userId, payload);
    console.log(
      `📤 Notified user ${userId} about video processed: ${result.success} sent, ${result.failed} failed`
    );
  } catch (error) {
    console.error('Error in notifyVideoProcessed:', error);
  }
}

/**
 * Notify users when a new video is uploaded (for followers/subscribers)
 * For now, we'll skip this since there's no follower system yet
 * This is a placeholder for future implementation
 */
export async function notifyNewVideo(
  videoId: number,
  uploaderUserId: number
): Promise<void> {
  try {
    const [video] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, videoId));

    if (!video) {
      console.error(`Video ${videoId} not found`);
      return;
    }

    const [uploader] = await db
      .select()
      .from(users)
      .where(eq(users.id, uploaderUserId));

    if (!uploader) {
      console.error(`Uploader ${uploaderUserId} not found`);
      return;
    }

    // Get all users who have push subscriptions (except the uploader)
    const allSubscriptions = await db
      .select({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, uploaderUserId).not());

    // Get unique user IDs
    const userIds = [...new Set(allSubscriptions.map(s => s.userId))];

    if (userIds.length === 0) {
      console.log(`📢 No users to notify for new video ${videoId}`);
      return;
    }

    const payload: NotificationPayload = {
      title: `🎥 New Video from ${uploader.displayName}`,
      body: video.title || 'Check out this new video!',
      icon: uploader.profileImagePath || '/icon-192.png',
      badge: '/badge-72.png',
      data: {
        url: `/video/${video.publicId}`,
        videoId: video.publicId,
        uploaderId: uploaderUserId.toString(),
        type: 'new_video',
      },
      actions: [
        {
          action: 'view',
          title: 'Watch Now',
        },
      ],
    };

    // Send to all users with push subscriptions
    const result = await sendNotificationToUsers(userIds, payload);
    console.log(
      `📢 Notified ${userIds.length} users about new video from ${uploader.displayName}: ${result.success} sent, ${result.failed} failed`
    );
  } catch (error) {
    console.error('Error in notifyNewVideo:', error);
  }
}

/**
 * Send a custom notification to a user
 */
export async function sendCustomNotification(
  userId: number,
  title: string,
  body: string,
  data?: any
): Promise<void> {
  try {
    const payload: NotificationPayload = {
      title,
      body,
      icon: '/icon-192.png',
      data: data || {},
    };

    // Queue the notification
    await queueNotification(
      userId,
      null,
      'custom',
      title,
      body,
      data
    );

    // Send the notification
    const result = await sendNotificationToUser(userId, payload);
    console.log(
      `📤 Sent custom notification to user ${userId}: ${result.success} sent, ${result.failed} failed`
    );
  } catch (error) {
    console.error('Error in sendCustomNotification:', error);
  }
}
