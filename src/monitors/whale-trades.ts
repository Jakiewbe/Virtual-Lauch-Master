/**
 * 大额交易监控器
 * 监控 Uniswap V2 Swap 事件，筛选大额交易
 */

import { ethers } from 'ethers';
import { logger, LRUCache } from '../utils/index.js';
import { getConfig } from '../config.js';
import { ResilientWebSocket } from '../providers/resilient-ws.js';
import { UNISWAP_V2_PAIR_ABI, ERC20_ABI } from '../constants/index.js';
import type { WhaleTradeInfo, PoolType } from '../types.js';

export class WhaleTrades {
    private threshold: bigint;
    private virtualTokenAddr: string;
    private poolAddress: string;
    private poolType: PoolType;
    private virtualIsToken0: boolean = false;
    private lruCache: LRUCache<string, boolean>;
    private ws: ResilientWebSocket | null = null;
    private onWhaleTrade: ((trade: WhaleTradeInfo) => void) | null = null;
    private isRunning: boolean = false;

    constructor(poolAddress: string, poolType: PoolType) {
        const config = getConfig();
        this.threshold = ethers.parseEther(config.thresholds.bigTradeVirtual.toString());
        this.virtualTokenAddr = config.addresses.virtualToken.toLowerCase();
        this.poolAddress = poolAddress;
        this.poolType = poolType;
        this.lruCache = new LRUCache(1000);
    }

    /**
     * 启动监控
     */
    async start(onWhaleTrade: (trade: WhaleTradeInfo) => void): Promise<void> {
        if (this.isRunning) {
            logger.warn('WhaleTrades monitor already running');
            return;
        }

        this.onWhaleTrade = onWhaleTrade;
        this.isRunning = true;

        const config = getConfig();
        this.ws = new ResilientWebSocket(config.chain.rpc.wss[0]);

        const provider = await this.ws.connect();

        if (this.poolType === 'uniswap_v2') {
            await this.initUniswapV2(provider);
        } else {
            await this.initVirtualsCurve(provider);
        }

        logger.info('WhaleTrades monitor started', {
            poolAddress: this.poolAddress,
            poolType: this.poolType,
            threshold: ethers.formatEther(this.threshold),
        });
    }

    /**
     * 初始化 Uniswap V2 监控
     */
    private async initUniswapV2(provider: ethers.WebSocketProvider): Promise<void> {
        const pair = new ethers.Contract(this.poolAddress, UNISWAP_V2_PAIR_ABI, provider);

        // 确定 VIRTUAL 是 token0 还是 token1
        const token0 = await pair.token0();
        this.virtualIsToken0 = token0.toLowerCase() === this.virtualTokenAddr;

        logger.debug('Uniswap V2 pair initialized', {
            token0,
            virtualIsToken0: this.virtualIsToken0,
        });

        // 订阅 Swap 事件
        this.ws!.addSubscription(
            pair,
            'Swap',
            (
                sender: string,
                amount0In: bigint,
                amount1In: bigint,
                amount0Out: bigint,
                amount1Out: bigint,
                to: string,
                event: ethers.EventLog
            ) => {
                this.handleSwap(
                    sender,
                    amount0In,
                    amount1In,
                    amount0Out,
                    amount1Out,
                    event.transactionHash,
                    event.blockNumber
                );
            }
        );
    }

    /**
     * 初始化 Virtuals Curve 监控（降级到 Transfer 事件）
     */
    private async initVirtualsCurve(provider: ethers.WebSocketProvider): Promise<void> {
        const virtualToken = new ethers.Contract(
            this.virtualTokenAddr,
            ERC20_ABI,
            provider
        );

        // 监听 VIRTUAL 的 Transfer 事件，筛选与池子相关的
        this.ws!.addSubscription(
            virtualToken,
            'Transfer',
            (from: string, to: string, value: bigint, event: ethers.EventLog) => {
                this.handleTransfer(from, to, value, event.transactionHash, event.blockNumber);
            }
        );

        logger.info('Using Transfer-based monitoring for Virtuals Curve');
    }

    /**
     * 处理 Uniswap V2 Swap 事件
     */
    private handleSwap(
        sender: string,
        amount0In: bigint,
        amount1In: bigint,
        amount0Out: bigint,
        amount1Out: bigint,
        txHash: string,
        blockNumber: number
    ): void {
        // 去重检查
        if (this.lruCache.has(txHash)) {
            return;
        }

        // 计算 ΔVIRTUAL
        let deltaVirtual: bigint;
        let deltaToken: bigint;

        if (this.virtualIsToken0) {
            deltaVirtual = amount0In - amount0Out;
            deltaToken = amount1Out - amount1In;
        } else {
            deltaVirtual = amount1In - amount1Out;
            deltaToken = amount0Out - amount0In;
        }

        // 检查阈值
        const absVirtual = deltaVirtual < 0n ? -deltaVirtual : deltaVirtual;
        if (absVirtual < this.threshold) {
            return;
        }

        // 标记已处理
        this.lruCache.set(txHash, true);

        const trade: WhaleTradeInfo = {
            direction: deltaVirtual > 0n ? 'SELL' : 'BUY',
            amountVirtual: absVirtual,
            amountToken: deltaToken < 0n ? -deltaToken : deltaToken,
            trader: sender,
            txHash,
            blockNumber,
            timestamp: Date.now(),
        };

        logger.info('Whale trade detected', {
            direction: trade.direction,
            amount: ethers.formatEther(trade.amountVirtual),
            txHash,
        });

        if (this.onWhaleTrade) {
            this.onWhaleTrade(trade);
        }
    }

    /**
     * 处理 Transfer 事件（Virtuals Curve 降级方案）
     */
    private handleTransfer(
        from: string,
        to: string,
        value: bigint,
        txHash: string,
        blockNumber: number
    ): void {
        // 只关注与池子相关的转账
        const poolAddr = this.poolAddress.toLowerCase();
        if (from.toLowerCase() !== poolAddr && to.toLowerCase() !== poolAddr) {
            return;
        }

        // 去重检查
        if (this.lruCache.has(txHash)) {
            return;
        }

        // 检查阈值
        if (value < this.threshold) {
            return;
        }

        // 标记已处理
        this.lruCache.set(txHash, true);

        const isBuy = from.toLowerCase() === poolAddr;

        const trade: WhaleTradeInfo = {
            direction: isBuy ? 'BUY' : 'SELL',
            amountVirtual: value,
            amountToken: 0n, // 无法确定
            trader: isBuy ? to : from,
            txHash,
            blockNumber,
            timestamp: Date.now(),
        };

        logger.info('Whale trade detected (Transfer)', {
            direction: trade.direction,
            amount: ethers.formatEther(trade.amountVirtual),
            txHash,
        });

        if (this.onWhaleTrade) {
            this.onWhaleTrade(trade);
        }
    }

    /**
     * 判断是否正在运行
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * 停止监控
     */
    async stop(): Promise<void> {
        this.isRunning = false;

        if (this.ws) {
            await this.ws.destroy();
            this.ws = null;
        }
        this.lruCache.clear();
        logger.info('WhaleTrades monitor stopped');
    }
}
