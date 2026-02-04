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
    elapsedMinutes: number;
    remainingMinutes: number;
    tax: {
        netInflow: string;
        balanceDiff: string;
    } | null;
    buyback: {
        spentTotal: string;
        progress: number;
        etaHours: number;
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
