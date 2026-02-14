/**
 * API 接口类型定义
 */

export type State = 'DISCOVER' | 'WAIT_T0' | 'LAUNCH_WINDOW' | 'BUYBACK_PHASE' | 'DONE';

export interface Project {
    id: number;
    name: string;
    symbol: string;
    tokenAddress: string | null;
    lpAddress: string | null;
}

export interface ApiState {
    state: State;
    project: Project | null;
    t0: string | null;
    t1: string | null;
    taxTotal: string;
    startBalance?: string | null;
    elapsedMinutes: number;
    remainingMinutes: number;
    onchainFdvVirtual?: string | null;
    onchainFdvUsd?: string | null;
    apiFdvVirtual?: string | null;
    apiFdvUsd?: string | null;
    tax: {
        netInflow: string;
        balanceDiff: string;
    } | null;
    buyback: {
        spentTotal: string;
        progress: number;
        etaHours: number;
        ratePerHour?: number;
        lastTxAmount?: string | null;
    } | null;
}

export interface Trade {
    direction: 'BUY' | 'SELL';
    amountVirtual: string;
    amountToken: string;
    trader: string;
    txHash: string;
    blockNumber: number;
    timestamp: number;
}

export interface ApiEvent {
    type: string;
    timestamp: string;
    data: unknown;
}

export interface RpcHealth {
    http: {
        current: string;
        healthy: boolean;
        latencyMs: number;
    };
    wss: {
        current: string;
        connected: boolean;
    };
}

export interface Config {
    chain: {
        name: string;
        chainId: number;
    };
    thresholds: {
        bigTradeVirtual: number;
        taxWindowMinutes: number;
        buybackRateWindowMinutes: number;
        stallAlertMinutes: number;
    };
}

export interface UpcomingLaunch {
    id: number;
    name: string;
    symbol: string;
    status: 'INITIALIZED' | 'UNDERGRAD' | 'AVAILABLE';
    factory: 'VIBES_BONDING_V2' | 'BONDING_V4' | string;
    source: '60_days' | 'unicorn';
    createdAt: string;
    launchedAt: string | null;
    preTokenPair: string | null;
    image?: { url: string };
    mcapInVirtual?: number;
    liquidityUsd?: number;
}
