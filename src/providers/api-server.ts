/**
 * API 服务器
 * 提供 REST API 和 WebSocket 实时更新
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/index.js';
import { getConfig } from '../config.js';
import { getRpcPool } from './rpc-pool.js';
import { State, StateMachineContext, WhaleTradeInfo, TaxResult, BuybackStatus, VirtualsAgent } from '../types.js';

// 事件类型
export type ApiEventType =
    | 'state_change'
    | 'whale_trade'
    | 'tax_update'
    | 'buyback_update'
    | 'project_start'
    | 'project_complete'
    | 'error';

export interface ApiEvent {
    type: ApiEventType;
    timestamp: string;
    data: unknown;
}

export interface ApiState {
    state: State;
    project: VirtualsAgent | null;
    t0: string | null;
    t1: string | null;
    taxTotal: string;
    elapsedMinutes: number;
    remainingMinutes: number;
}

export class ApiServer {
    private server: Server | null = null;
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private eventHistory: ApiEvent[] = [];
    private maxHistory: number = 100;
    private port: number;

    // 状态缓存
    private currentState: State = State.DISCOVER;
    private currentProject: VirtualsAgent | null = null;
    private t0: Date | null = null;
    private t1: Date | null = null;
    private taxTotal: bigint = 0n;
    private lastTaxResult: TaxResult | null = null;
    private lastBuybackStatus: BuybackStatus | null = null;
    private tradeHistory: WhaleTradeInfo[] = [];

    constructor(port: number = 4000) {
        this.port = port;
    }

    /**
     * 更新状态
     */
    updateContext(context: StateMachineContext): void {
        const stateChanged = this.currentState !== context.state;

        this.currentState = context.state;
        this.currentProject = context.project?.agent || null;
        this.t0 = context.t0;
        this.t1 = context.t1;
        this.taxTotal = context.taxTotal;

        if (stateChanged) {
            this.broadcast({
                type: 'state_change',
                timestamp: new Date().toISOString(),
                data: this.getStateSnapshot(),
            });
        }
    }

    /**
     * 记录大额交易
     */
    recordTrade(trade: WhaleTradeInfo): void {
        this.tradeHistory.unshift(trade);
        if (this.tradeHistory.length > this.maxHistory) {
            this.tradeHistory.pop();
        }

        this.broadcast({
            type: 'whale_trade',
            timestamp: new Date().toISOString(),
            data: {
                direction: trade.direction,
                amountVirtual: trade.amountVirtual.toString(),
                trader: trade.trader,
                txHash: trade.txHash,
                blockNumber: trade.blockNumber,
            },
        });
    }

    /**
     * 更新税收数据
     */
    updateTax(result: TaxResult, elapsedMinutes: number): void {
        this.lastTaxResult = result;

        this.broadcast({
            type: 'tax_update',
            timestamp: new Date().toISOString(),
            data: {
                netInflow: result.netInflow.toString(),
                balanceDiff: result.balanceDiff.toString(),
                delta: result.delta.toString(),
                elapsedMinutes,
            },
        });
    }

    /**
     * 更新回购数据
     */
    updateBuyback(status: BuybackStatus): void {
        this.lastBuybackStatus = status;

        this.broadcast({
            type: 'buyback_update',
            timestamp: new Date().toISOString(),
            data: {
                spentTotal: status.spentTotal.toString(),
                remaining: status.remaining.toString(),
                ratePerHour: status.ratePerHour,
                etaHours: status.etaHours,
                progress: status.progress,
            },
        });
    }

    /**
     * 获取状态快照
     */
    private getStateSnapshot(): ApiState {
        const now = Date.now();
        const elapsedMinutes = this.t0 ? (now - this.t0.getTime()) / 60000 : 0;
        const remainingMinutes = this.t1 ? Math.max(0, (this.t1.getTime() - now) / 60000) : 0;

        return {
            state: this.currentState,
            project: this.currentProject,
            t0: this.t0?.toISOString() || null,
            t1: this.t1?.toISOString() || null,
            taxTotal: this.taxTotal.toString(),
            elapsedMinutes,
            remainingMinutes,
        };
    }

    /**
     * 广播消息给所有客户端
     */
    private broadcast(event: ApiEvent): void {
        // 记录历史
        this.eventHistory.unshift(event);
        if (this.eventHistory.length > this.maxHistory) {
            this.eventHistory.pop();
        }

        // 广播
        const message = JSON.stringify(event);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    /**
     * 处理 HTTP 请求
     */
    private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '/';

        try {
            if (req.method === 'GET' && url === '/api/state') {
                // 当前状态
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    ...this.getStateSnapshot(),
                    tax: this.lastTaxResult ? {
                        netInflow: this.lastTaxResult.netInflow.toString(),
                        balanceDiff: this.lastTaxResult.balanceDiff.toString(),
                    } : null,
                    buyback: this.lastBuybackStatus ? {
                        spentTotal: this.lastBuybackStatus.spentTotal.toString(),
                        progress: this.lastBuybackStatus.progress,
                        etaHours: this.lastBuybackStatus.etaHours,
                    } : null,
                }));
            } else if (req.method === 'GET' && url === '/api/trades') {
                // 交易历史
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.tradeHistory.map(t => ({
                    ...t,
                    amountVirtual: t.amountVirtual.toString(),
                    amountToken: t.amountToken.toString(),
                }))));
            } else if (req.method === 'GET' && url === '/api/events') {
                // 事件历史
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.eventHistory));
            } else if (req.method === 'GET' && url === '/api/config') {
                // 配置（只读，敏感信息隐藏）
                const config = getConfig();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    chain: config.chain,
                    thresholds: config.thresholds,
                    virtuals: {
                        apiBase: config.virtuals.apiBase,
                        pollIntervalMs: config.virtuals.pollIntervalMs,
                        maxProjectAgeMinutes: config.virtuals.maxProjectAgeMinutes,
                    },
                }));
            } else if (req.method === 'GET' && url === '/api/health') {
                // RPC 健康状态
                const rpcPool = getRpcPool();
                const health = await rpcPool.healthCheck();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not Found' }));
            }
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(error) }));
        }
    }

    /**
     * 启动服务器
     */
    start(): void {
        this.server = createServer((req, res) => {
            this.handleRequest(req, res).catch((error) => {
                logger.error('API server error', { error: String(error) });
                res.writeHead(500);
                res.end('Internal Server Error');
            });
        });

        // WebSocket 服务器
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            logger.debug('WebSocket client connected', { total: this.clients.size });

            // 发送当前状态
            ws.send(JSON.stringify({
                type: 'state_change',
                timestamp: new Date().toISOString(),
                data: this.getStateSnapshot(),
            }));

            ws.on('close', () => {
                this.clients.delete(ws);
                logger.debug('WebSocket client disconnected', { total: this.clients.size });
            });

            ws.on('error', (error) => {
                logger.warn('WebSocket error', { error: String(error) });
                this.clients.delete(ws);
            });
        });

        this.server.listen(this.port, () => {
            logger.info('API server started', { port: this.port });
        });
    }

    /**
     * 停止服务器
     */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            // 关闭所有 WebSocket 连接
            for (const client of this.clients) {
                client.close();
            }
            this.clients.clear();

            if (this.wss) {
                this.wss.close();
                this.wss = null;
            }

            if (this.server) {
                this.server.close(() => {
                    logger.info('API server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// 单例
let apiServerInstance: ApiServer | null = null;

export function getApiServer(port?: number): ApiServer {
    if (!apiServerInstance) {
        apiServerInstance = new ApiServer(port);
    }
    return apiServerInstance;
}
