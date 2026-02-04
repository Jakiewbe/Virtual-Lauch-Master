/**
 * 健康检查服务
 * 提供 HTTP 端点用于 Docker 健康检查
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { logger } from '../utils/index.js';
import { getRpcPool } from './rpc-pool.js';
import { State } from '../types.js';

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    state: State;
    projectId: number | null;
    projectSymbol: string | null;
    rpc: {
        httpHealthy: boolean;
        wssConnected: boolean;
    };
    timestamp: string;
}

export class HealthServer {
    private server: Server | null = null;
    private startTime: number = Date.now();
    private currentState: State = State.DISCOVER;
    private currentProjectId: number | null = null;
    private currentProjectSymbol: string | null = null;
    private port: number;

    constructor(port: number = 3000) {
        this.port = port;
    }

    /**
     * 更新状态
     */
    updateState(state: State, projectId: number | null, projectSymbol: string | null): void {
        this.currentState = state;
        this.currentProjectId = projectId;
        this.currentProjectSymbol = projectSymbol;
    }

    /**
     * 获取健康状态
     */
    private async getHealth(): Promise<HealthStatus> {
        const rpcPool = getRpcPool();
        const rpcHealth = await rpcPool.healthCheck();

        const isHealthy = rpcHealth.http.healthy;
        const isDegraded = !rpcHealth.wss.connected && rpcHealth.http.healthy;

        return {
            status: isHealthy ? (isDegraded ? 'degraded' : 'healthy') : 'unhealthy',
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            state: this.currentState,
            projectId: this.currentProjectId,
            projectSymbol: this.currentProjectSymbol,
            rpc: {
                httpHealthy: rpcHealth.http.healthy,
                wssConnected: rpcHealth.wss.connected,
            },
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * 处理请求
     */
    private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = req.url || '/';

        if (req.method === 'GET' && url === '/health') {
            try {
                const health = await this.getHealth();
                const statusCode = health.status === 'healthy' ? 200 :
                    health.status === 'degraded' ? 200 : 503;

                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health, null, 2));
            } catch (error) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'unhealthy', error: String(error) }));
            }
        } else if (req.method === 'GET' && url === '/ready') {
            // Kubernetes readiness probe
            const isReady = this.currentState !== State.DISCOVER;
            res.writeHead(isReady ? 200 : 503, { 'Content-Type': 'text/plain' });
            res.end(isReady ? 'ready' : 'not ready');
        } else if (req.method === 'GET' && url === '/live') {
            // Kubernetes liveness probe
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('alive');
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    }

    /**
     * 启动服务器
     */
    start(): void {
        this.server = createServer((req, res) => {
            this.handleRequest(req, res).catch((error) => {
                logger.error('Health server error', { error: String(error) });
                res.writeHead(500);
                res.end('Internal Server Error');
            });
        });

        this.server.listen(this.port, () => {
            logger.info('Health server started', { port: this.port });
        });

        this.server.on('error', (error) => {
            logger.error('Health server error', { error: String(error) });
        });
    }

    /**
     * 停止服务器
     */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    logger.info('Health server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// 单例
let healthServerInstance: HealthServer | null = null;

export function getHealthServer(port?: number): HealthServer {
    if (!healthServerInstance) {
        healthServerInstance = new HealthServer(port);
    }
    return healthServerInstance;
}
