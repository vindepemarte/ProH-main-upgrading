import { NextRequest } from 'next/server';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';

// WebSocket event types for type safety
export type WebSocketEvent = 
  | { type: 'homework_status_update'; homeworkId: string; status: string; userId: string }
  | { type: 'new_notification'; userId: string; notification: any }
  | { type: 'user_online'; userId: string }
  | { type: 'homework_assigned'; homeworkId: string; workerId: string; userId: string }
  | { type: 'price_increase_request'; homeworkId: string; userId: string }
  | { type: 'payment_approved'; homeworkId: string; userId: string };

// Global WebSocket server instance
let wss: WebSocketServer | null = null;
const clients = new Map<string, WebSocket>();

// Initialize WebSocket server
function initWebSocketServer() {
  if (wss) return wss;
  
  wss = new WebSocketServer({ 
    port: 8080,
    perMessageDeflate: false,
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log('New WebSocket connection established');
    
    // Extract user ID from query parameters or headers
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    
    if (userId) {
      clients.set(userId, ws);
      console.log(`User ${userId} connected via WebSocket`);
      
      // Broadcast user online status
      broadcastToAll({
        type: 'user_online',
        userId
      });
    }

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received WebSocket message:', message);
        
        // Handle different message types
        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'subscribe':
            // Subscribe to specific channels/topics
            if (message.channel && userId) {
              console.log(`User ${userId} subscribed to ${message.channel}`);
            }
            break;
          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    // Handle connection close
    ws.on('close', () => {
      if (userId) {
        clients.delete(userId);
        console.log(`User ${userId} disconnected from WebSocket`);
      }
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      if (userId) {
        clients.delete(userId);
      }
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket connection established',
      timestamp: new Date().toISOString()
    }));
  });

  wss.on('error', (error: Error) => {
    console.error('WebSocket server error:', error);
  });

  console.log('WebSocket server initialized on port 8080');
  return wss;
}

// Broadcast message to all connected clients
export function broadcastToAll(event: WebSocketEvent) {
  if (!wss) return;
  
  const message = JSON.stringify(event);
  
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
  });
}

// Send message to specific user
export function sendToUser(userId: string, event: WebSocketEvent) {
  const client = clients.get(userId);
  
  if (client && client.readyState === 1) { // WebSocket.OPEN
    try {
      client.send(JSON.stringify(event));
      return true;
    } catch (error) {
      console.error(`Error sending message to user ${userId}:`, error);
      clients.delete(userId);
      return false;
    }
  }
  
  return false;
}

// Send message to multiple users
export function sendToUsers(userIds: string[], event: WebSocketEvent) {
  const results = userIds.map(userId => sendToUser(userId, event));
  return results.filter(Boolean).length;
}

// Get connected users count
export function getConnectedUsersCount(): number {
  return clients.size;
}

// Get connected user IDs
export function getConnectedUserIds(): string[] {
  return Array.from(clients.keys());
}

// HTTP endpoint for WebSocket server management
export async function GET(request: NextRequest) {
  try {
    // Initialize WebSocket server if not already done
    if (!wss) {
      initWebSocketServer();
    }
    
    return new Response(JSON.stringify({
      status: 'WebSocket server running',
      port: 8080,
      connectedClients: getConnectedUsersCount(),
      connectedUsers: getConnectedUserIds()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in WebSocket GET endpoint:', error);
    return new Response(JSON.stringify({
      error: 'Failed to initialize WebSocket server',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// HTTP endpoint for sending messages via REST API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, userId, userIds, ...eventData } = body;
    
    if (!type) {
      return new Response(JSON.stringify({
        error: 'Event type is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const event: WebSocketEvent = { type, ...eventData };
    
    let result;
    if (userId) {
      // Send to specific user
      result = sendToUser(userId, event);
    } else if (userIds && Array.isArray(userIds)) {
      // Send to multiple users
      result = sendToUsers(userIds, event);
    } else {
      // Broadcast to all
      broadcastToAll(event);
      result = getConnectedUsersCount();
    }
    
    return new Response(JSON.stringify({
      success: true,
      sent: result,
      event
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in WebSocket POST endpoint:', error);
    return new Response(JSON.stringify({
      error: 'Failed to send WebSocket message',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Initialize WebSocket server on module load
if (typeof window === 'undefined') {
  // Only run on server side
  setTimeout(() => {
    initWebSocketServer();
  }, 1000);
}