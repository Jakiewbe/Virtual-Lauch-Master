/**
 * Telegram 推送模块
 * 支持消息格式化、去重、节流和队列
 */

import { logger, LRUCache, TelegramError, formatVirtual, shortenAddress, formatEta, formatPercent } from '../utils/index.js';
import { getConfig } from '../config.js';
import type { WhaleTradeInfo, TaxResult, BuybackStatus, VirtualsAgent } from '../types.js';

interface QueuedMessage {
    message: string;
    priority: number;
    timestamp: number;
}

export class TelegramNotifier {
    private baseUrl: string;
    private chatId: string;
    private throttleMap: Map<string, number> = new Map();
    private throttleMs: number = 60000;
    private sentHashes: LRUCache<string, boolean>;
    private messageQueue: QueuedMessage[] = [];
    private isProcessing: boolean = false;
    private minInterval: number = 1000; // 最小发送间隔

    constructor() {
        const config = getConfig();
        this.baseUrl = `https://api.telegram.org/bot${config.telegram.botToken}`;
        this.chatId = config.telegram.chatId;
        this.sentHashes = new LRUCache(500);
    }

    /**
     * 发送消息（内部）
     */
    private async sendImmediate(message: string): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new TelegramError(`Telegram API error: ${response.status} - ${error}`);
            }

            logger.debug('Telegram message sent');
        } catch (error) {
            logger.logError('Failed to send Telegram message', error);
            // 不抛出，避免中断主流程
        }
    }

    /**
     * 队列发送（带节流）
     */
    private async send(message: string, options?: {
        throttleKey?: string;
        priority?: number;
        skipThrottle?: boolean;
    }): Promise<void> {
        const { throttleKey, priority = 0, skipThrottle = false } = options || {};

        // 节流检查
        if (throttleKey && !skipThrottle) {
            const lastSent = this.throttleMap.get(throttleKey) || 0;
            if (Date.now() - lastSent < this.throttleMs) {
                logger.debug('Message throttled', { key: throttleKey });
                return;
            }
            this.throttleMap.set(throttleKey, Date.now());
        }

        // 添加到队列
        this.messageQueue.push({ message, priority, timestamp: Date.now() });
        this.messageQueue.sort((a, b) => b.priority - a.priority);

        // 处理队列
        this.processQueue();
    }

    /**
     * 处理消息队列
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.messageQueue.length > 0) {
            const item = this.messageQueue.shift();
            if (item) {
                await this.sendImmediate(item.message);

                // 最小间隔
                if (this.messageQueue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.minInterval));
                }
            }
        }

        this.isProcessing = false;
    }

    /**
     * 发送大额交易告警
     */
    async sendWhaleTrade(trade: WhaleTradeInfo, project: VirtualsAgent): Promise<void> {
        // 去重检查
        if (this.sentHashes.has(trade.txHash)) {
            return;
        }
        this.sentHashes.set(trade.txHash, true);

        const emoji = trade.direction === 'BUY' ? '🟢' : '🔴';
        const amount = formatVirtual(trade.amountVirtual);
        const shortAddr = shortenAddress(trade.trader);

        const message = `
${emoji} <b>Whale ${trade.direction}</b>
━━━━━━━━━━━━━━━
Project: <b>$${project.symbol}</b>
Amount: <code>${amount}</code> VIRTUAL
Trader: <code>${shortAddr}</code>
<a href="https://basescan.org/tx/${trade.txHash}">View Tx</a> | Block: ${trade.blockNumber}
`.trim();

        await this.send(message, { priority: 10, skipThrottle: true });
    }

    /**
     * 发送税收窗口进度
     */
    async sendTaxProgress(result: TaxResult, project: VirtualsAgent, elapsedMinutes: number): Promise<void> {
        const netInflow = formatVirtual(result.netInflow);
        const balanceDiff = formatVirtual(result.balanceDiff);
        const delta = formatVirtual(result.delta);

        const message = `
🧾 <b>Tax Window</b> [${Math.floor(elapsedMinutes)}/100 min]
━━━━━━━━━━━━━━━
Project: <b>$${project.symbol}</b>
Net Inflow: <code>${netInflow}</code> VIRTUAL
Balance Δ: <code>${balanceDiff}</code> VIRTUAL
Diff: <code>${delta}</code>
`.trim();

        await this.send(message, { throttleKey: `tax_${project.id}`, priority: 5 });
    }

    /**
     * 发送回购状态
     */
    async sendBuybackStatus(status: BuybackStatus, project: VirtualsAgent): Promise<void> {
        const spent = formatVirtual(status.spentTotal);
        const remaining = formatVirtual(status.remaining);
        const rate = status.ratePerHour.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const eta = formatEta(status.etaHours);
        const progress = formatPercent(status.progress);

        const message = `
🔁 <b>Buyback Progress</b> [${progress}]
━━━━━━━━━━━━━━━
Project: <b>$${project.symbol}</b>
Spent: <code>${spent}</code> VIRTUAL
Remaining: <code>${remaining}</code> VIRTUAL
Rate: <code>${rate}</code>/h | ETA: ~${eta}
`.trim();

        await this.send(message, { throttleKey: `buyback_${project.id}`, priority: 5 });
    }

    /**
     * 发送回购停滞告警
     */
    async sendStallAlert(project: VirtualsAgent): Promise<void> {
        const config = getConfig();

        const message = `
⚠️ <b>Buyback Stalled</b>
━━━━━━━━━━━━━━━
Project: <b>$${project.symbol}</b>
No spending detected for ${config.thresholds.stallAlertMinutes}+ minutes
Please check manually.
`.trim();

        await this.send(message, { priority: 15, skipThrottle: true });
    }

    /**
     * 发送项目开始监控通知
     */
    async sendProjectStart(project: VirtualsAgent, poolType: string): Promise<void> {
        const tokenAddr = project.tokenAddress
            ? `<code>${shortenAddress(project.tokenAddress, 6)}</code>`
            : 'N/A';

        const message = `
🚀 <b>Monitoring Started</b>
━━━━━━━━━━━━━━━
Project: <b>$${project.symbol}</b> (${project.name})
Pool Type: ${poolType}
Token: ${tokenAddr}
ID: ${project.id}
`.trim();

        await this.send(message, { priority: 8 });
    }

    /**
     * 发送监控完成通知
     */
    async sendComplete(project: VirtualsAgent, status: BuybackStatus): Promise<void> {
        const spent = formatVirtual(status.spentTotal);
        const progress = formatPercent(status.progress);

        const message = `
✅ <b>Monitoring Complete</b>
━━━━━━━━━━━━━━━
Project: <b>$${project.symbol}</b>
Total Buyback: <code>${spent}</code> VIRTUAL
Progress: ${progress}
`.trim();

        await this.send(message, { priority: 8 });
    }

    /**
     * 发送错误告警
     */
    async sendError(title: string, details: string): Promise<void> {
        const message = `
🚨 <b>${title}</b>
━━━━━━━━━━━━━━━
${details}
Time: ${new Date().toISOString()}
`.trim();

        await this.send(message, { priority: 20, skipThrottle: true });
    }

    /**
     * 测试连接
     */
    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/getMe`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

// 单例
let notifierInstance: TelegramNotifier | null = null;

export function getTelegramNotifier(): TelegramNotifier {
    if (!notifierInstance) {
        notifierInstance = new TelegramNotifier();
    }
    return notifierInstance;
}
