import { NextRequest, NextResponse } from 'next/server';

// WebSocket event types for type safety
export type WebSocketEvent = 
  | { type: 'homework_status_update'; homeworkId: string; status: string; userId: string }
  | { type: 'new_notification'; userId: string; notification: any }
  | { type: 'user_online'; userId: string }
  | { type: 'homework_assigned'; homeworkId: string; workerId: string; userId: string }
  | { type: 'price_increase_request'; homeworkId: string; userId: string }
  | { type: 'payment_approved'; homeworkId: string; userId: string };

// In-memory storage for events (in production, use Redis or database)
const eventStore: (WebSocketEvent & { timestamp: string })[] = [];
const MAX_EVENTS = 100;

// Store event in memory (replace with database in production)
function storeEvent(event: WebSocketEvent) {
  eventStore.push({
    ...event,
    timestamp: new Date().toISOString()
  });
  
  // Keep only recent events
  if (eventStore.length > MAX_EVENTS) {
    eventStore.shift();
  }
}

// Get recent events for a user
function getRecentEvents(userId?: string, limit: number = 10): (WebSocketEvent & { timestamp: string })[] {
  let events = eventStore.slice(-limit);
  
  if (userId) {
    events = events.filter(event => 
      !('userId' in event) || event.userId === userId
    );
  }
  
  return events;
}

// Simulate broadcasting by storing events
export function broadcastToAll(event: WebSocketEvent) {
  storeEvent(event);
  console.log('Event stored for broadcast:', event);
}

// Send message to specific user
export function sendToUser(userId: string, event: WebSocketEvent) {
  storeEvent({ ...event, userId } as WebSocketEvent);
  console.log(`Event stored for user ${userId}:`, event);
}

// Send message to multiple users
export function sendToUsers(userIds: string[], event: WebSocketEvent) {
  userIds.forEach(userId => sendToUser(userId, event));
}

// Get number of stored events
export function getStoredEventsCount(): number {
  return eventStore.length;
}

// Get list of recent user IDs from events
export function getRecentUserIds(): string[] {
  const userIds = new Set<string>();
  eventStore.forEach(event => {
    if ('userId' in event && event.userId) {
      userIds.add(event.userId);
    }
  });
  return Array.from(userIds);
}

// HTTP GET endpoint - Return recent events for polling
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') || undefined;
  
  // If this is a WebSocket upgrade request, reject it gracefully
  const upgrade = request.headers.get('upgrade');
  if (upgrade === 'websocket') {
    return new NextResponse('WebSocket not supported in this deployment. Using polling instead.', {
      status: 426,
      headers: {
        'Upgrade': 'HTTP/1.1'
      }
    });
  }
  
  // Return recent events as JSON for polling
  try {
    const events = getRecentEvents(userId, 20);
    
    return NextResponse.json({
      status: 'success',
      events,
      totalEvents: eventStore.length,
      userId,
      message: 'Recent events retrieved'
    });
  } catch (error: any) {
    console.error('Error retrieving events:', error);
    return NextResponse.json(
      { status: 'error', message: error.message },
      { status: 500 }
    );
  }
}

// HTTP POST endpoint for sending events
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, userId, userIds, ...eventData } = body;
    
    if (!type) {
      return NextResponse.json(
        { status: 'error', message: 'Event type is required' },
        { status: 400 }
      );
    }
    
    const event: WebSocketEvent = { type, ...eventData } as WebSocketEvent;
    
    if (userIds && Array.isArray(userIds)) {
      // Send to multiple users
      sendToUsers(userIds, event);
      return NextResponse.json({
        status: 'success',
        message: `Event sent to ${userIds.length} users`,
        event,
        recipients: userIds
      });
    } else if (userId) {
      // Send to specific user
      sendToUser(userId, event);
      return NextResponse.json({
        status: 'success',
        message: `Event sent to user ${userId}`,
        event,
        recipient: userId
      });
    } else {
      // Broadcast to all users
      broadcastToAll(event);
      return NextResponse.json({
        status: 'success',
        message: 'Event broadcasted to all users',
        event,
        totalRecipients: getStoredEventsCount()
      });
    }
  } catch (error: any) {
    console.error('Event send error:', error);
    return NextResponse.json(
      { status: 'error', message: error.message },
      { status: 500 }
    );
  }
}

// Initialize event store
console.log('WebSocket API route initialized with event polling system');