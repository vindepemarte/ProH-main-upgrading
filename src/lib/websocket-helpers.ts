import type { WebSocketEvent } from '@/hooks/use-websocket';

// Helper function to send WebSocket events via REST API
export async function sendWebSocketEvent(event: Record<string, any>) {
  try {
    const response = await fetch('/api/websocket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`WebSocket API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('WebSocket event sent:', result);
    return result;
  } catch (error) {
    console.error('Failed to send WebSocket event:', error);
    return null;
  }
}

// Helper function to notify homework status updates
export async function notifyHomeworkStatusUpdate(
  homeworkId: string, 
  status: string, 
  userId: string
) {
  return sendWebSocketEvent({
    type: 'homework_status_update',
    homeworkId,
    status,
    userId
  });
}

// Helper function to notify homework assignment
export async function notifyHomeworkAssigned(
  homeworkId: string, 
  workerId: string, 
  userId: string
) {
  return sendWebSocketEvent({
    type: 'homework_assigned',
    homeworkId,
    workerId,
    userId
  });
}

// Helper function to notify price increase requests
export async function notifyPriceIncreaseRequest(
  homeworkId: string, 
  userId: string
) {
  return sendWebSocketEvent({
    type: 'price_increase_request',
    homeworkId,
    userId
  });
}

// Helper function to notify payment approval
export async function notifyPaymentApproved(
  homeworkId: string, 
  userId: string
) {
  return sendWebSocketEvent({
    type: 'payment_approved',
    homeworkId,
    userId
  });
}

// Helper function to send notifications to specific users
export async function sendNotificationToUser(
  userId: string, 
  notification: any
) {
  return sendWebSocketEvent({
    type: 'new_notification',
    userId,
    notification
  });
}

// Helper function to send notifications to multiple users
export async function sendNotificationToUsers(
  userIds: string[], 
  notification: any
) {
  return sendWebSocketEvent({
    type: 'new_notification',
    userIds,
    notification
  });
}

// Helper function to broadcast notifications to all users
export async function broadcastNotificationToAll(notification: any) {
  return sendWebSocketEvent({
    type: 'new_notification',
    notification
  });
}

// Helper function to check WebSocket server status
export async function getWebSocketStatus() {
  try {
    const response = await fetch('/api/websocket', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`WebSocket status check failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to check WebSocket status:', error);
    return null;
  }
}