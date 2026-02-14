/**
 * 税收统计追踪器
 * 统计 [T0, T1] 期间 BUYBACK_ADDR 的 VIRTUAL 净流入
 */

import { ethers } from 'ethers';
import { logger, timeToBlock } from '../utils/index.js';
import { getConfig } from '../config.js';
import { getRpcPool } from '../providers/rpc-pool.js';
import { ERC20_ABI } from '../constants/index.js';
import type { TaxResult } from '../types.js';

export class TaxTracker {
    private virtualToken: ethers.Contract;
    private buybackAddr: string;
    private virtualTokenAddr: string;
    private blockStart: number = 0;
    private lastProcessedBlock: number = 0;
    private startBalance: bigint = 0n;
    private accumulated: TaxResult = {
        inflow: 0n,
        outflow: 0n,
        netInflow: 0n,
        balanceDiff: 0n,
        delta: 0n,
    };

    constructor() {
        const config = getConfig();
        const rpcPool = getRpcPool();

        this.buybackAddr = config.addresses.buybackAddr.toLowerCase();
        this.virtualTokenAddr = config.addresses.virtualToken;
        this.virtualToken = new ethers.Contract(
            this.virtualTokenAddr,
            ERC20_ABI,
            rpcPool.getHttpProvider()
        );
    }

    /**
     * 初始化追踪器
     * @param t0 税收窗口开始时间
     */
    async init(t0: Date): Promise<void> {
        const rpcPool = getRpcPool();
        const provider = rpcPool.getHttpProvider();

        this.blockStart = await timeToBlock(provider, t0.getTime());
        this.lastProcessedBlock = this.blockStart;

        try {
            this.startBalance = await this.virtualToken.balanceOf(this.buybackAddr, {
                blockTag: this.blockStart,
            });
        } catch (e) {
            logger.warn('TaxTracker init: balanceOf at blockStart failed, retrying once', {
                blockStart: this.blockStart,
                error: String(e),
            });
            try {
                this.startBalance = await this.virtualToken.balanceOf(this.buybackAddr, {
                    blockTag: this.blockStart,
                });
            } catch {
                this.startBalance = 0n;
                logger.warn('TaxTracker init: using startBalance 0, netInflow only', { blockStart: this.blockStart });
            }
        }

        logger.info('TaxTracker initialized', {
            blockStart: this.blockStart,
            initialBalance: ethers.formatEther(this.startBalance),
        });
    }

    getStartBalance(): bigint {
        return this.startBalance;
    }

    /**
     * 更新税收统计（增量）
     */
    async update(): Promise<TaxResult> {
        const rpcPool = getRpcPool();
        const provider = rpcPool.getHttpProvider();

        try {
            const latestBlock = await provider.getBlockNumber();

            if (latestBlock <= this.lastProcessedBlock) {
                return this.accumulated;
            }

            // 限制单次查询范围，避免 RPC 超时
            const maxBlockRange = 2000;
            const toBlock = Math.min(latestBlock, this.lastProcessedBlock + maxBlockRange);

            // 查询 Transfer 事件
            const filter = this.virtualToken.filters.Transfer();
            const logs = await this.virtualToken.queryFilter(
                filter,
                this.lastProcessedBlock + 1,
                toBlock
            );

            let inflowDelta = 0n;
            let outflowDelta = 0n;

            for (const log of logs) {
                if (!('args' in log) || !log.args) {
                    continue;
                }
                const [from, to, value] = log.args as unknown as [string, string, bigint];

                if (to.toLowerCase() === this.buybackAddr) {
                    inflowDelta += value;
                }
                if (from.toLowerCase() === this.buybackAddr) {
                    outflowDelta += value;
                }
            }

            // 累加
            this.accumulated.inflow += inflowDelta;
            this.accumulated.outflow += outflowDelta;
            this.accumulated.netInflow = this.accumulated.inflow - this.accumulated.outflow;

            // 计算余额差
            const currentBalance = await this.virtualToken.balanceOf(this.buybackAddr);
            this.accumulated.balanceDiff = currentBalance - this.startBalance;
            this.accumulated.delta = this.accumulated.balanceDiff - this.accumulated.netInflow;

            const processedBlocks = toBlock - this.lastProcessedBlock;
            this.lastProcessedBlock = toBlock;

            logger.debug('Tax update', {
                blocksProcessed: processedBlocks,
                netInflow: ethers.formatEther(this.accumulated.netInflow),
                balanceDiff: ethers.formatEther(this.accumulated.balanceDiff),
            });

            return this.accumulated;
        } catch (error) {
            logger.error('Failed to update tax', {
                error: error instanceof Error ? error.message : String(error),
            });

            // 尝试切换 RPC
            rpcPool.rotateHttp();
            this.virtualToken = new ethers.Contract(
                this.virtualTokenAddr,
                ERC20_ABI,
                rpcPool.getHttpProvider()
            );

            throw error;
        }
    }

    /**
     * 获取当前统计结果
     */
    getResult(): TaxResult {
        return { ...this.accumulated };
    }

    /**
     * 获取税收总额（用于回购追踪）
     */
    getTaxTotal(): bigint {
        return this.accumulated.netInflow;
    }

    /**
     * 获取处理进度
     */
    getProgress(): { startBlock: number; currentBlock: number } {
        return {
            startBlock: this.blockStart,
            currentBlock: this.lastProcessedBlock,
        };
    }
}
