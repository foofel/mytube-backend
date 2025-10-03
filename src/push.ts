import { sendNotificationToUser }  from './push-notifications';
import { requireAuth } from './auth';
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  sendTestNotification,
  type PushSubscription,
} from './push-notifications';

/**
 * GET /api/push/vapid-public-key
 * Return the VAPID public key for the frontend
 */
export async function getVapidPublicKeyHandler(req: Request): Promise<Response> {
  try {
    const publicKey = getVapidPublicKey();

    if (!publicKey) {
      return Response.json(
        { error: 'Push notifications not configured' },
        { status: 503 }
      );
    }

    return Response.json({ publicKey });
  } catch (error) {
    console.error('Error getting VAPID public key:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/push/subscribe
 * Subscribe to push notifications
 */
export async function subscribeToPushHandler(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const subscription = body.subscription as PushSubscription;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return Response.json(
        { error: 'Invalid subscription data' },
        { status: 400 }
      );
    }

    const userAgent = req.headers.get('user-agent') || undefined;

    await saveSubscription(user.id, subscription, userAgent);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/push/unsubscribe
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPushHandler(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { endpoint } = body;

    if (!endpoint) {
      return Response.json(
        { error: 'Endpoint required' },
        { status: 400 }
      );
    }

    await removeSubscription(user.id, endpoint);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/push/test
 * Send a test notification
 * Body (optional): { title?: string, body?: string, url?: string }
 */
export async function sendTestNotificationHandler(req: Request): Promise<Response> {
  const user = await requireAuth(req);
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    let customMessage = null;

    // Try to parse custom message from body
    try {
      const body = await req.json();
      if (body && (body.title || body.body || body.url)) {
        customMessage = body;
      }
    } catch {
      // No body or invalid JSON, use default
    }

    if (customMessage) {
      // Send custom notification

      await sendNotificationToUser(user.id, {
        title: customMessage.title || '🎉 Test Notification',
        body: customMessage.body || 'Push notifications are working!',
        icon: '/icon-192.png',
        data: {
          url: customMessage.url || '/',
        },
      });
    } else {
      // Send default test notification
      await sendTestNotification(user.id);
    }

    return Response.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    console.error('Error sending test notification:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
