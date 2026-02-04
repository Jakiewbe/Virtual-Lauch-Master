/**
 * 自恢复 WebSocket 连接
 * 支持指数退避重连
 */

import { ethers } from 'ethers';
import { logger, sleep } from '../utils/index.js';
import { getConfig } from '../config.js';

interface Subscription {
    event: ethers.ContractEventName;
    listener: ethers.Listener;
    contract: ethers.Contract;
}

export class ResilientWebSocket {
    private url: string;
    private provider: ethers.WebSocketProvider | null = null;
    private reconnectDelay = 1000;
    private maxDelay = 60000;
    private subscriptions: Subscription[] = [];
    private isConnecting = false;
    private shouldReconnect = true;

    constructor(url?: string) {
        const config = getConfig();
        this.url = url || config.chain.rpc.wss[0];
    }

    /**
     * 连接 WebSocket
     */
    async connect(): Promise<ethers.WebSocketProvider> {
        if (this.isConnecting) {
            // 等待正在进行的连接
            while (this.isConnecting) {
                await sleep(100);
            }
            if (this.provider) {
                return this.provider;
            }
        }

        this.isConnecting = true;

        try {
            logger.info('Connecting to WSS', { url: this.url });
            this.provider = new ethers.WebSocketProvider(this.url);

            // 等待连接就绪
            await this.provider.ready;

            // 设置断线处理
            this.setupDisconnectHandler();

            // 重置重连延迟
            this.reconnectDelay = 1000;

            // 恢复订阅
            await this.restoreSubscriptions();

            logger.info('WSS connected successfully');
            return this.provider;
        } catch (error) {
            logger.error('WSS connection failed', {
                url: this.url,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * 设置断线处理
     */
    private setupDisconnectHandler(): void {
        if (!this.provider) return;

        const ws = (this.provider as unknown as { websocket: WebSocket }).websocket;
        if (!ws) return;

        ws.onclose = () => {
            logger.warn('WSS connection closed');
            if (this.shouldReconnect) {
                this.handleDisconnect();
            }
        };

        ws.onerror = (error) => {
            logger.error('WSS error', { error: String(error) });
        };
    }

    /**
     * 处理断线重连
     */
    private async handleDisconnect(): Promise<void> {
        if (!this.shouldReconnect) return;

        logger.info('Attempting reconnect', { delay: this.reconnectDelay });
        await sleep(this.reconnectDelay);

        // 指数退避
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);

        try {
            await this.connect();
        } catch (error) {
            logger.warn('Reconnect failed, will retry', {
                error: error instanceof Error ? error.message : String(error),
            });
            this.handleDisconnect();
        }
    }

    /**
     * 获取 Provider
     */
    getProvider(): ethers.WebSocketProvider | null {
        return this.provider;
    }

    /**
     * 添加事件订阅（断线后自动恢复）
     */
    addSubscription(
        contract: ethers.Contract,
        event: ethers.ContractEventName,
        listener: ethers.Listener
    ): void {
        this.subscriptions.push({ contract, event, listener });

        // 立即订阅
        contract.on(event, listener);
        logger.debug('Subscription added', { event: String(event) });
    }

    /**
     * 恢复所有订阅
     */
    private async restoreSubscriptions(): Promise<void> {
        if (!this.provider || this.subscriptions.length === 0) return;

        logger.info('Restoring subscriptions', { count: this.subscriptions.length });

        for (const sub of this.subscriptions) {
            try {
                // 重新创建 Contract 实例
                const newContract = new ethers.Contract(
                    await sub.contract.getAddress(),
                    sub.contract.interface,
                    this.provider
                );

                // 更新引用并重新订阅
                sub.contract = newContract;
                newContract.on(sub.event, sub.listener);

                logger.debug('Subscription restored', { event: String(sub.event) });
            } catch (error) {
                logger.error('Failed to restore subscription', {
                    event: String(sub.event),
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    /**
     * 移除订阅
     */
    removeSubscription(event: ethers.ContractEventName): void {
        this.subscriptions = this.subscriptions.filter((sub) => sub.event !== event);
    }

    /**
     * 清除所有订阅
     */
    clearSubscriptions(): void {
        for (const sub of this.subscriptions) {
            try {
                sub.contract.off(sub.event, sub.listener);
            } catch (error) {
                // 忽略清理错误
            }
        }
        this.subscriptions = [];
        logger.info('All subscriptions cleared');
    }

    /**
     * 关闭连接
     */
    async destroy(): Promise<void> {
        this.shouldReconnect = false;
        this.clearSubscriptions();

        if (this.provider) {
            try {
                await this.provider.destroy();
            } catch (error) {
                logger.warn('Error destroying WSS provider', { error: String(error) });
            }
            this.provider = null;
        }

        logger.info('ResilientWebSocket destroyed');
    }
}
