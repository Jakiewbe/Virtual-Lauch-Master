/**
 * RPC 连接池
 * 支持多端点 HTTP 和 WSS，自动切换和健康检查
 */

import { ethers } from 'ethers';
import { logger, RpcError, withRetry, withTimeout } from '../utils/index.js';
import { getConfig } from '../config.js';

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

export class RpcPool {
    private httpProviders: ethers.JsonRpcProvider[] = [];
    private wssProviders: Map<number, ethers.WebSocketProvider> = new Map();
    private currentHttpIndex = 0;
    private currentWssIndex = 0;
    private httpUrls: string[];
    private wssUrls: string[];
    private httpLatencies: Map<number, number> = new Map();

    constructor() {
        const config = getConfig();
        this.httpUrls = config.chain.rpc.http;
        this.wssUrls = config.chain.rpc.wss;

        // 初始化 HTTP providers
        for (const url of this.httpUrls) {
            try {
                const provider = new ethers.JsonRpcProvider(url, undefined, {
                    staticNetwork: true,
                    batchMaxCount: 1,
                });
                this.httpProviders.push(provider);
                logger.debug('HTTP provider initialized', { url });
            } catch (error) {
                logger.warn('Failed to initialize HTTP provider', { url, error: String(error) });
            }
        }

        if (this.httpProviders.length === 0) {
            throw new RpcError('No HTTP providers available', 'none');
        }

        logger.info('RPC Pool initialized', {
            httpCount: this.httpProviders.length,
            wssCount: this.wssUrls.length,
        });
    }

    /**
     * 获取当前 HTTP Provider
     */
    getHttpProvider(): ethers.JsonRpcProvider {
        return this.httpProviders[this.currentHttpIndex];
    }

    /**
     * 获取当前 HTTP URL
     */
    getCurrentHttpUrl(): string {
        return this.httpUrls[this.currentHttpIndex];
    }

    /**
     * 获取或创建 WSS Provider（懒加载）
     */
    async getWssProvider(): Promise<ethers.WebSocketProvider> {
        let provider = this.wssProviders.get(this.currentWssIndex);

        if (!provider) {
            provider = await this.createWssProvider(this.currentWssIndex);
        }

        return provider;
    }

    /**
     * 创建 WSS Provider
     */
    private async createWssProvider(index: number): Promise<ethers.WebSocketProvider> {
        const url = this.wssUrls[index];
        try {
            const provider = new ethers.WebSocketProvider(url);
            await withTimeout(provider.ready, 10000, 'WSS connection timeout');
            this.wssProviders.set(index, provider);
            logger.info('WSS provider connected', { url });
            return provider;
        } catch (error) {
            throw new RpcError('Failed to connect WSS', url, error instanceof Error ? error : undefined);
        }
    }

    /**
     * 轮换到下一个 HTTP Provider
     */
    rotateHttp(): ethers.JsonRpcProvider {
        const oldIndex = this.currentHttpIndex;
        this.currentHttpIndex = (this.currentHttpIndex + 1) % this.httpProviders.length;
        logger.info('Rotated HTTP provider', {
            from: this.httpUrls[oldIndex],
            to: this.httpUrls[this.currentHttpIndex],
        });
        return this.httpProviders[this.currentHttpIndex];
    }

    /**
     * 轮换到下一个 WSS Provider
     */
    async rotateWss(): Promise<ethers.WebSocketProvider> {
        // 销毁当前连接
        const currentProvider = this.wssProviders.get(this.currentWssIndex);
        if (currentProvider) {
            try {
                await currentProvider.destroy();
                this.wssProviders.delete(this.currentWssIndex);
            } catch (error) {
                logger.warn('Error destroying WSS provider', { error: String(error) });
            }
        }

        const oldIndex = this.currentWssIndex;
        this.currentWssIndex = (this.currentWssIndex + 1) % this.wssUrls.length;

        logger.info('Rotating WSS provider', {
            from: this.wssUrls[oldIndex],
            to: this.wssUrls[this.currentWssIndex],
        });

        return this.createWssProvider(this.currentWssIndex);
    }

    /**
     * 带重试的 RPC 调用
     */
    async call<T>(fn: (provider: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
        return withRetry(
            async () => {
                const endTimer = logger.time('RPC call');
                try {
                    const result = await fn(this.getHttpProvider());
                    endTimer();
                    return result;
                } catch (error) {
                    endTimer();
                    throw error;
                }
            },
            {
                maxAttempts: this.httpProviders.length,
                initialDelayMs: 500,
                maxDelayMs: 5000,
                onRetry: (error, attempt) => {
                    logger.warn('RPC call failed, rotating provider', {
                        attempt,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this.rotateHttp();
                },
            }
        );
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<RpcHealth> {
        const httpUrl = this.httpUrls[this.currentHttpIndex];
        let httpHealthy = false;
        let httpLatency = -1;

        try {
            const start = performance.now();
            await this.getHttpProvider().getBlockNumber();
            httpLatency = Math.round(performance.now() - start);
            httpHealthy = true;
            this.httpLatencies.set(this.currentHttpIndex, httpLatency);
        } catch (error) {
            logger.warn('HTTP health check failed', { url: httpUrl });
        }

        const wssUrl = this.wssUrls[this.currentWssIndex];
        const wssConnected = this.wssProviders.has(this.currentWssIndex);

        return {
            http: {
                current: httpUrl,
                healthy: httpHealthy,
                latencyMs: httpLatency,
            },
            wss: {
                current: wssUrl,
                connected: wssConnected,
            },
        };
    }

    /**
     * 选择最快的 HTTP Provider
     */
    async selectFastest(): Promise<void> {
        const latencies: Array<{ index: number; latency: number }> = [];

        for (let i = 0; i < this.httpProviders.length; i++) {
            try {
                const start = performance.now();
                await withTimeout(this.httpProviders[i].getBlockNumber(), 5000);
                const latency = performance.now() - start;
                latencies.push({ index: i, latency });
                logger.debug('RPC latency test', { url: this.httpUrls[i], latencyMs: Math.round(latency) });
            } catch {
                logger.debug('RPC latency test failed', { url: this.httpUrls[i] });
            }
        }

        if (latencies.length > 0) {
            latencies.sort((a, b) => a.latency - b.latency);
            this.currentHttpIndex = latencies[0].index;
            logger.info('Selected fastest RPC', {
                url: this.httpUrls[this.currentHttpIndex],
                latencyMs: Math.round(latencies[0].latency),
            });
        }
    }

    /**
     * 关闭所有连接
     */
    async destroy(): Promise<void> {
        for (const [index, provider] of this.wssProviders) {
            try {
                await provider.destroy();
                logger.debug('WSS provider destroyed', { url: this.wssUrls[index] });
            } catch (error) {
                logger.warn('Error destroying WSS provider', { error: String(error) });
            }
        }
        this.wssProviders.clear();
        logger.info('RPC Pool destroyed');
    }
}

// 单例
let rpcPoolInstance: RpcPool | null = null;

export function getRpcPool(): RpcPool {
    if (!rpcPoolInstance) {
        rpcPoolInstance = new RpcPool();
    }
    return rpcPoolInstance;
}

export function resetRpcPool(): void {
    if (rpcPoolInstance) {
        rpcPoolInstance.destroy();
        rpcPoolInstance = null;
    }
}
