/**
 * API 调用封装
 */

import type { ApiState, Trade, ApiEvent, RpcHealth, Config, UpcomingLaunch } from './types';

const API_BASE = '/api';

async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

export async function getState(): Promise<ApiState> {
    return fetchJson<ApiState>('/state');
}

export async function getTrades(): Promise<Trade[]> {
    return fetchJson<Trade[]>('/trades');
}

export async function getEvents(): Promise<ApiEvent[]> {
    return fetchJson<ApiEvent[]>('/events');
}

export async function getHealth(): Promise<RpcHealth> {
    return fetchJson<RpcHealth>('/health');
}

export async function getConfig(): Promise<Config> {
    return fetchJson<Config>('/config');
}

export async function getUpcomingLaunches(): Promise<UpcomingLaunch[]> {
    return fetchJson<UpcomingLaunch[]>('/upcoming-launches');
}
