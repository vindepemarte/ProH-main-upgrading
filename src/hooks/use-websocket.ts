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

  // Polling mechanism to replace WebSocket
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimestamp = useRef<string>('');
  
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    const pollEvents = async () => {
      if (!user?.id || !state.isConnected) return;
      
      try {
        const response = await fetch(`/api/websocket?userId=${encodeURIComponent(user.id)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        if (data.status === 'success' && data.events) {
          // Process new events
          data.events.forEach((event: any) => {
            if (event.timestamp > lastEventTimestamp.current) {
              setState(prev => ({ ...prev, lastMessage: event }));
              onMessage?.(event);
              lastEventTimestamp.current = event.timestamp;
            }
          });
        }
      } catch (error: any) {
        console.error('Polling error:', error);
        // Don't disconnect on polling errors, just log them
      }
    };
    
    // Poll every 2 seconds
    pollingIntervalRef.current = setInterval(pollEvents, 2000);
    
    // Initial poll
    pollEvents();
  }, [user?.id, state.isConnected, onMessage]);

  // Connect using polling (fallback for WebSocket)
  const connect = useCallback(() => {
    if (!enabled || !user?.id) {
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      console.log('Starting polling connection for user:', user.id);
      
      // Simulate WebSocket connection with polling
      setState(prev => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        error: null,
        reconnectCount: 0
      }));
      
      onConnect?.();
      
      // Start polling for events
      startPolling();
    } catch (error: any) {
      console.error('Connection error:', error);
      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        error: error.message || 'Connection failed'
      }));
      onError?.(error);
      
      // Attempt reconnection
      if (reconnectCountRef.current < reconnectAttempts) {
        reconnectCountRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval * Math.pow(2, reconnectCountRef.current - 1));
      }
    }
  }, [enabled, user?.id, reconnectAttempts, reconnectInterval, onConnect, onError, startPolling]);



  // Disconnect polling
    const disconnect = useCallback(() => {
      isManualCloseRef.current = true;
      clearReconnectTimeout();
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        error: null
      }));
    }, [clearReconnectTimeout]);

  // Send message via API (since we're using polling)
  const sendMessage = useCallback(async (message: any) => {
    try {
      const response = await fetch('/api/websocket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...message, userId: user?.id })
      });
      return response.ok;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }, [user?.id]);

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
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
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