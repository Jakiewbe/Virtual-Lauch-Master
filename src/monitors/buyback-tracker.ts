/**
 * 回购追踪器
 * 追踪 T1 之后的回购花费速率和 ETA
 */

import { ethers } from 'ethers';
import { logger } from '../utils/index.js';
import { getConfig } from '../config.js';
import { ResilientWebSocket } from '../providers/resilient-ws.js';
import { ERC20_ABI } from '../constants/index.js';
import type { BuybackStatus, SpentRecord } from '../types.js';

export class BuybackTracker {
    private taxTotal: bigint;
    private buybackAddr: string;
    private virtualTokenAddr: string;
    private rateWindowMinutes: number;
    private stallAlertMinutes: number;

    private spentHistory: SpentRecord[] = [];
    private spentTotal: bigint = 0n;
    private lastSpentTime: number = 0;
    private ws: ResilientWebSocket | null = null;
    private onStall: (() => void) | null = null;
    private isRunning: boolean = false;
    private stallAlerted: boolean = false;

    constructor(taxTotal: bigint) {
        const config = getConfig();
        this.taxTotal = taxTotal;
        this.buybackAddr = config.addresses.buybackAddr.toLowerCase();
        this.virtualTokenAddr = config.addresses.virtualToken;
        this.rateWindowMinutes = config.thresholds.buybackRateWindowMinutes;
        this.stallAlertMinutes = config.thresholds.stallAlertMinutes;
    }

    /**
     * 启动回购监控
     */
    async start(onStall?: () => void): Promise<void> {
        if (this.isRunning) {
            logger.warn('BuybackTracker already running');
            return;
        }

        this.onStall = onStall || null;
        this.isRunning = true;

        const config = getConfig();
        this.ws = new ResilientWebSocket(config.chain.rpc.wss[0]);

        const provider = await this.ws.connect();

        const contract = new ethers.Contract(
            this.virtualTokenAddr,
            ERC20_ABI,
            provider
        );

        // 监听 Transfer 事件（from = BUYBACK_ADDR 表示回购花费）
        this.ws.addSubscription(
            contract,
            'Transfer',
            (from: string, to: string, value: bigint, event: ethers.EventLog) => {
                if (from.toLowerCase() === this.buybackAddr) {
                    this.recordSpent(value, event.transactionHash);
                }
            }
        );

        logger.info('BuybackTracker started', {
            taxTotal: ethers.formatEther(this.taxTotal),
        });
    }

    /**
     * 记录花费
     */
    private recordSpent(amount: bigint, txHash: string): void {
        const now = Date.now();

        this.spentHistory.push({
            time: now,
            amount,
            txHash,
        });
        this.spentTotal += amount;
        this.lastSpentTime = now;

        // 重置停滞告警标记
        this.stallAlerted = false;

        // 清理超出滑窗的历史
        const windowStart = now - this.rateWindowMinutes * 60 * 1000;
        this.spentHistory = this.spentHistory.filter((h) => h.time >= windowStart);

        logger.debug('Buyback spent recorded', {
            amount: ethers.formatEther(amount),
            total: ethers.formatEther(this.spentTotal),
            txHash,
        });
    }

    /**
     * 获取当前状态
     */
    getStatus(): BuybackStatus {
        const now = Date.now();
        const windowStart = now - this.rateWindowMinutes * 60 * 1000;

        // 滑窗内花费
        const spentWindow = this.spentHistory
            .filter((h) => h.time >= windowStart)
            .reduce((sum, h) => sum + h.amount, 0n);

        // 速率 (VIRTUAL / 小时)
        const windowSeconds = this.rateWindowMinutes * 60;
        const spentWindowNum = Number(ethers.formatEther(spentWindow));
        const ratePerHour = (spentWindowNum / windowSeconds) * 3600;

        // 剩余和 ETA
        const remaining =
            this.taxTotal > this.spentTotal ? this.taxTotal - this.spentTotal : 0n;

        const remainingNum = Number(ethers.formatEther(remaining));
        const etaHours = ratePerHour > 0 ? remainingNum / ratePerHour : Infinity;

        // 进度百分比
        const progress =
            this.taxTotal > 0n
                ? Number((this.spentTotal * 10000n) / this.taxTotal) / 100
                : 0;

        return {
            spentTotal: this.spentTotal,
            spentWindow,
            ratePerHour,
            remaining,
            etaHours,
            progress,
        };
    }

    /**
     * 检查是否停滞
     */
    isStalled(): boolean {
        if (this.spentTotal >= this.taxTotal) {
            return false; // 已完成
        }

        const now = Date.now();
        const stallThreshold = this.stallAlertMinutes * 60 * 1000;

        // 从未有过花费，或者超过阈值时间没有花费
        if (this.lastSpentTime === 0) {
            return false; // 刚开始，还没数据
        }

        return now - this.lastSpentTime > stallThreshold;
    }

    /**
     * 检查并触发停滞告警（只触发一次）
     */
    checkStall(): void {
        if (this.isStalled() && !this.stallAlerted && this.onStall) {
            this.stallAlerted = true;
            this.onStall();
        }
    }

    /**
     * 判断回购是否完成
     */
    isComplete(): boolean {
        return this.spentTotal >= this.taxTotal;
    }

    /**
     * 判断是否正在运行
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * 获取花费记录
     */
    getSpentHistory(): ReadonlyArray<SpentRecord> {
        return this.spentHistory;
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
        logger.info('BuybackTracker stopped', {
            totalSpent: ethers.formatEther(this.spentTotal),
        });
    }
}
