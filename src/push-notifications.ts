import webpush from 'web-push';
import { db } from './orm';
import { pushSubscriptions } from './drizzle/schema';
import { eq, and } from 'drizzle-orm';

// Initialize web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@mytube.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn('⚠️  VAPID keys not configured. Push notifications will not work.');
  console.warn('   Run: bun src/generate-vapid-keys.ts to generate keys');
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url?: string;
    videoId?: string;
    [key: string]: any;
  };
  actions?: Array<{
    action: string;
    title: string;
  }>;
}

/**
 * Get VAPID public key for frontend
 */
export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY || null;
}

/**
 * Save a push subscription to the database
 */
export async function saveSubscription(
  userId: number,
  subscription: PushSubscription,
  userAgent?: string
): Promise<void> {
  try {
    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: subscription.endpoint,
        p256Dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent || null,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: {
          p256Dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          lastUsed: new Date().toISOString(),
        },
      });

    console.log(`✅ Saved push subscription for user ${userId}`);
  } catch (error) {
    console.error('Error saving push subscription:', error);
    throw error;
  }
}

/**
 * Remove a push subscription from the database
 */
export async function removeSubscription(
  userId: number,
  endpoint: string
): Promise<void> {
  try {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint)
        )
      );

    console.log(`🗑️  Removed push subscription for user ${userId}`);
  } catch (error) {
    console.error('Error removing push subscription:', error);
    throw error;
  }
}

/**
 * Get all push subscriptions for a user
 */
export async function getUserSubscriptions(
  userId: number
): Promise<Array<typeof pushSubscriptions.$inferSelect>> {
  try {
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    return subscriptions;
  } catch (error) {
    console.error('Error getting user subscriptions:', error);
    return [];
  }
}

/**
 * Send a push notification to a specific user (all their devices)
 */
export async function sendNotificationToUser(
  userId: number,
  payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('⚠️  Cannot send notification: VAPID keys not configured');
    return { success: 0, failed: 0 };
  }

  const subscriptions = await getUserSubscriptions(userId);

  if (subscriptions.length === 0) {
    console.log(`No push subscriptions found for user ${userId}`);
    return { success: 0, failed: 0 };
  }

  let successCount = 0;
  let failedCount = 0;

  // Send to all user's devices
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256Dh,
            auth: sub.auth,
          },
        };

        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify(payload)
        );

        // Update last_used timestamp
        await db
          .update(pushSubscriptions)
          .set({ lastUsed: new Date().toISOString() })
          .where(eq(pushSubscriptions.id, sub.id));

        successCount++;
        console.log(`✅ Sent notification to user ${userId} device ${sub.id}`);
      } catch (error: any) {
        failedCount++;
        console.error(`Failed to send notification to device ${sub.id}:`, error.message);

        // Handle expired/invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(`🗑️  Removing expired subscription ${sub.id}`);
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
        }
      }
    })
  );

  return { success: successCount, failed: failedCount };
}

/**
 * Send a push notification to multiple users
 */
export async function sendNotificationToUsers(
  userIds: number[],
  payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;

  await Promise.all(
    userIds.map(async (userId) => {
      const result = await sendNotificationToUser(userId, payload);
      totalSuccess += result.success;
      totalFailed += result.failed;
    })
  );

  return { success: totalSuccess, failed: totalFailed };
}

/**
 * Test notification helper
 */
export async function sendTestNotification(userId: number): Promise<void> {
  await sendNotificationToUser(userId, {
    title: '🎉 Test Notification',
    body: 'Push notifications are working!',
    icon: '/icon-192.png',
    data: {
      url: '/',
    },
  });
}
