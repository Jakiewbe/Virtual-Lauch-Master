/**
 * WebSocket Hook
 * 实时接收后端事件
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ApiEvent, ApiState } from './types';

interface UseWebSocketResult {
    isConnected: boolean;
    lastEvent: ApiEvent | null;
    state: ApiState | null;
    reconnect: () => void;
}

export function useWebSocket(): UseWebSocketResult {
    const [isConnected, setIsConnected] = useState(false);
    const [lastEvent, setLastEvent] = useState<ApiEvent | null>(null);
    const [state, setState] = useState<ApiState | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);

    const connect = useCallback(() => {
        // 确定 WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;

        try {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data) as ApiEvent;
                    setLastEvent(data);

                    // 更新状态
                    if (data.type === 'state_change') {
                        setState(data.data as ApiState);
                    }
                } catch (e) {
                    console.error('Failed to parse WebSocket message', e);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                wsRef.current = null;

                // 自动重连
                reconnectTimeoutRef.current = window.setTimeout(() => {
                    connect();
                }, 3000);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error', error);
            };
        } catch (error) {
            console.error('Failed to connect WebSocket', error);
            setIsConnected(false);
        }
    }, []);

    const reconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        connect();
    }, [connect]);

    useEffect(() => {
        connect();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [connect]);

    return { isConnected, lastEvent, state, reconnect };
}
