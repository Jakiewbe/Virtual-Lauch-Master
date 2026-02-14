/**
 * Virtuals Launch Watcher - 类型定义
 */

// ========== 配置类型 ==========

export interface Config {
    chain: {
        name: string;
        chainId: number;
        rpc: {
            http: string[];
            wss: string[];
        };
    };
    virtuals: {
        apiBase: string;
        pollIntervalMs: number;
        maxProjectAgeMinutes: number;
    };
    addresses: {
        buybackAddr: string;
        virtualToken: string;
    };
    thresholds: {
        bigTradeVirtual: number;
        taxWindowMinutes: number;
        buybackRateWindowMinutes: number;
        stallAlertMinutes: number;
    };
    telegram?: {
        botToken: string;
        chatId: string;
    };
    logging: {
        level: 'debug' | 'info' | 'warn' | 'error';
    };
}

// ========== Virtuals API 类型 ==========

export interface VirtualsApiResponse<T> {
    data: T[];
    meta: {
        pagination: {
            page: number;
            pageSize: number;
            pageCount: number;
            total: number;
        };
    };
}

export type AgentStatus = 'INITIALIZED' | 'UNDERGRAD' | 'AVAILABLE';
export type FactoryType = 'OLD' | 'BONDING' | 'BONDING_V2' | 'BONDING_V4' | 'VIBES_BONDING_V2';

export interface VirtualsAgent {
    id: number;
    uid: string;
    name: string;
    symbol: string;
    description: string;
    status: AgentStatus;
    tokenAddress: string | null;
    lpAddress: string | null;
    preToken: string | null;
    preTokenPair: string | null;
    daoAddress: string | null;
    lpCreatedAt: string | null;
    createdAt: string;
    launchedAt: string | null;
    factory: FactoryType;
    holderCount: number;
    volume24h: number;
    priceChangePercent24h: number;
    liquidityUsd: number;
    mcapInVirtual: number;
    virtualTokenValue: string;
    vibesInfo?: {
        status: 'PRECOMMIT' | 'COMMITTED';
        vaultAddress: string;
        expectedRuggedAt: string;
        icoTargetFdv: number;
    };
    socials: Record<string, string>;
    image: { url: string };
}

// ========== 项目选择类型 ==========

export type PoolType = 'uniswap_v2' | 'virtuals_curve';

export interface SelectedProject {
    agent: VirtualsAgent;
    poolAddress: string;
    poolType: PoolType;
    t0: Date;
}

// ========== 状态机类型 ==========

export enum State {
    DISCOVER = 'DISCOVER',
    WAIT_T0 = 'WAIT_T0',
    LAUNCH_WINDOW = 'LAUNCH_WINDOW',
    BUYBACK_PHASE = 'BUYBACK_PHASE',
    DONE = 'DONE',
}

export interface StateMachineContext {
    state: State;
    project: SelectedProject | null;
    t0: Date | null;
    t1: Date | null;
    taxTotal: bigint;
    startBalance: bigint | null;
    lastTaxUpdate: Date | null;
    lastBuybackUpdate: Date | null;
}

// ========== 税收类型 ==========

export interface TaxResult {
    inflow: bigint;
    outflow: bigint;
    netInflow: bigint;
    balanceDiff: bigint;
    delta: bigint;
}

// ========== 回购类型 ==========

export interface BuybackStatus {
    spentTotal: bigint;
    spentWindow: bigint;
    ratePerHour: number;
    remaining: bigint;
    etaHours: number;
    progress: number;
    lastTxAmount: bigint | null;
}

export interface SpentRecord {
    time: number;
    amount: bigint;
    txHash: string;
}

// ========== 大额交易类型 ==========

export interface WhaleTradeInfo {
    direction: 'BUY' | 'SELL';
    amountVirtual: bigint;
    amountToken: bigint;
    trader: string;
    txHash: string;
    blockNumber: number;
    timestamp: number;
}

// ========== 日志类型 ==========

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    state: State;
    projectId: number | null;
    projectSymbol: string | null;
    message: string;
    data?: Record<string, unknown>;
}
