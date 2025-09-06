import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '@/contexts/app-context';

// WebSocket event types (matching server-side)
export type WebSocketEvent = 
  | { type: 'homework_status_update'; homeworkId: string; status: string; userId: string }
  | { type: 'new_notification'; userId: string; notification: any }
  | { type: 'user_online'; userId: string }
  | { type: 'homework_assigned'; homeworkId: string; workerId: string; userId: string }
  | { type: 'price_increase_request'; homeworkId: string; userId: string }
  | { type: 'payment_approved'; homeworkId: string; userId: string }
  | { type: 'connected'; message: string; timestamp: string }
  | { type: 'pong' };

interface UseWebSocketOptions {
  enabled?: boolean;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  onMessage?: (event: WebSocketEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastMessage: WebSocketEvent | null;
  reconnectCount: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    enabled = true,
    reconnectAttempts = 5,
    reconnectInterval = 3000,
    onMessage,
    onConnect,
    onDisconnect,
    onError
  } = options;

  const { user } = useAppContext();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectCountRef = useRef(0);
  const isManualCloseRef = useRef(false);

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastMessage: null,
    reconnectCount: 0
  });

  // Clear reconnect timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!enabled || !user?.id || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Use localhost for development, adjust for production
      const wsUrl = `ws://localhost:8080?userId=${encodeURIComponent(user.id)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        reconnectCountRef.current = 0;
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null,
          reconnectCount: 0
        }));
        onConnect?.();

        // Send ping to keep connection alive
        ws.send(JSON.stringify({ type: 'ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketEvent = JSON.parse(event.data);
          setState(prev => ({ ...prev, lastMessage: data }));
          onMessage?.(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        wsRef.current = null;
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false
        }));
        onDisconnect?.();

        // Attempt reconnection if not manually closed
        if (!isManualCloseRef.current && enabled && reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current++;
          setState(prev => ({ ...prev, reconnectCount: reconnectCountRef.current }));
          
          console.log(`Attempting to reconnect (${reconnectCountRef.current}/${reconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setState(prev => ({
          ...prev,
          error: 'WebSocket connection error',
          isConnecting: false
        }));
        onError?.(error);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Connection failed',
        isConnecting: false
      }));
    }
  }, [enabled, user?.id, reconnectAttempts, reconnectInterval, onConnect, onMessage, onDisconnect, onError]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    isManualCloseRef.current = true;
    clearReconnectTimeout();
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    
    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      error: null
    }));
  }, [clearReconnectTimeout]);

  // Send message through WebSocket
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
      }
    }
    return false;
  }, []);

  // Manual reconnect
  const reconnect = useCallback(() => {
    isManualCloseRef.current = false;
    reconnectCountRef.current = 0;
    clearReconnectTimeout();
    connect();
  }, [connect, clearReconnectTimeout]);

  // Subscribe to specific channels
  const subscribe = useCallback((channel: string) => {
    return sendMessage({ type: 'subscribe', channel });
  }, [sendMessage]);

  // Effect to handle connection lifecycle
  useEffect(() => {
    if (enabled && user?.id) {
      isManualCloseRef.current = false;
      connect();
    }

    return () => {
      isManualCloseRef.current = true;
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [enabled, user?.id, connect, clearReconnectTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clearReconnectTimeout]);

  return {
    ...state,
    connect,
    disconnect,
    reconnect,
    sendMessage,
    subscribe
  };
}

// Hook for homework-specific WebSocket events
export function useHomeworkWebSocket() {
  const { getHomeworksForUser } = useAppContext();

  const handleMessage = useCallback((event: WebSocketEvent) => {
    switch (event.type) {
      case 'homework_status_update':
        console.log('Homework status updated:', event.homeworkId, event.status);
        // Trigger refetch of homework data
        getHomeworksForUser?.();
        break;
      
      case 'homework_assigned':
        console.log('New homework assigned:', event.homeworkId, event.workerId);
        getHomeworksForUser?.();
        break;
      
      case 'price_increase_request':
        console.log('Price increase requested:', event.homeworkId);
        getHomeworksForUser?.();
        break;
      
      case 'payment_approved':
        console.log('Payment approved:', event.homeworkId);
        getHomeworksForUser?.();
        break;
      
      case 'new_notification':
        console.log('New notification:', event.notification);
        // Handle notification display
        break;
      
      default:
        console.log('Received WebSocket event:', event);
    }
  }, [getHomeworksForUser]);

  return useWebSocket({
    enabled: true,
    onMessage: handleMessage,
    onConnect: () => console.log('Connected to homework WebSocket'),
    onDisconnect: () => console.log('Disconnected from homework WebSocket'),
    onError: (error) => console.error('Homework WebSocket error:', error)
  });
}