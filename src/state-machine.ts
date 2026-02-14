/**
 * 状态机实现
 * DISCOVER → WAIT_T0 → LAUNCH_WINDOW → BUYBACK_PHASE → DONE
 */

import { logger, sleep } from './utils/index.js';
import { getConfig } from './config.js';
import { getVirtualsApi, getHealthServer, getApiServer, getRpcPool } from './providers/index.js';
import { TaxTracker, BuybackTracker, WhaleTrades } from './monitors/index.js';
import { computeCurveFdv, getVirtualPriceUsd } from './services/fdv-calculator.js';
import { getTelegramNotifier } from './notifiers/index.js';
import { State, SelectedProject, StateMachineContext } from './types.js';

export class StateMachine {
    private context: StateMachineContext = {
        state: State.DISCOVER,
        project: null,
        t0: null,
        t1: null,
        taxTotal: 0n,
        startBalance: null,
        lastTaxUpdate: null,
        lastBuybackUpdate: null,
    };

    private taxTracker: TaxTracker | null = null;
    private buybackTracker: BuybackTracker | null = null;
    private whaleTrades: WhaleTrades | null = null;
    private abortController: AbortController = new AbortController();
    private tickCount: number = 0;
    private lastProjectStatusCheck: Date | null = null;
    private readonly projectStatusCheckIntervalMs = 60 * 1000;

    /**
     * 启动状态机
     */
    async start(): Promise<void> {
        logger.info('State machine starting');

        while (!this.abortController.signal.aborted) {
            try {
                await this.tick();
                this.tickCount++;

                // 每 60 次 tick 更新一次健康状态
                if (this.tickCount % 60 === 0) {
                    this.updateHealthStatus();
                }

                await sleep(1000);
            } catch (error) {
                logger.error('State machine tick error', {
                    state: this.context.state,
                    error: error instanceof Error ? error.message : String(error),
                });

                // 非致命错误通知
                this.handleError(error);

                await sleep(5000);
            }
        }

        await this.cleanup();
        logger.info('State machine stopped');
    }

    /**
     * 更新健康服务器状态
     */
    private updateHealthStatus(): void {
        try {
            const healthServer = getHealthServer();
            healthServer.updateState(
                this.context.state,
                this.context.project?.agent.id || null,
                this.context.project?.agent.symbol || null
            );
        } catch {
            // 健康服务器可能未初始化
        }
    }

    private updateApiStatus(): void {
        try {
            const apiServer = getApiServer();
            apiServer.updateContext(this.context);
        } catch {
        }
    }

    /**
     * 处理错误
     */
    private handleError(error: unknown): void {
        // 严重错误发送 Telegram 通知
        if (this.tickCount > 10) { // 启动后才发通知
            const notifier = getTelegramNotifier();
            notifier.sendError(
                'State Machine Error',
                `State: ${this.context.state}\n${error instanceof Error ? error.message : String(error)}`
            ).catch(() => { });
        }
    }

    /**
     * 状态机主循环
     */
    private async tick(): Promise<void> {
        logger.setContext(
            this.context.state,
            this.context.project?.agent.id || null,
            this.context.project?.agent.symbol || null
        );

        // 更新健康状态
        this.updateHealthStatus();
        this.updateApiStatus();

        switch (this.context.state) {
            case State.DISCOVER:
                await this.handleDiscover();
                break;
            case State.WAIT_T0:
                await this.handleWaitT0();
                break;
            case State.LAUNCH_WINDOW:
                await this.handleLaunchWindow();
                break;
            case State.BUYBACK_PHASE:
                await this.handleBuybackPhase();
                break;
            case State.DONE:
                await this.handleDone();
                break;
        }
    }

    /**
     * DISCOVER: 发现项目
     */
    private async handleDiscover(): Promise<void> {
        const api = getVirtualsApi();

        await api.discoverProject(
            (project) => {
                this.context.project = project;
                this.context.t0 = project.t0;
                this.context.t1 = new Date(project.t0.getTime() + getConfig().thresholds.taxWindowMinutes * 60 * 1000);
                this.lastProjectStatusCheck = null;
                this.transition(State.WAIT_T0);
            },
            this.abortController.signal
        );
    }

    /**
     * WAIT_T0: 确认 T0 并初始化监控
     */
    private async handleWaitT0(): Promise<void> {
        if (!this.context.project) {
            this.transition(State.DISCOVER);
            return;
        }

        const project = this.context.project;
        const notifier = getTelegramNotifier();

        logger.info('Initializing monitors', {
            project: project.agent.symbol,
            t0: this.context.t0?.toISOString(),
            t1: this.context.t1?.toISOString(),
        });

        // 发送开始通知
        await notifier.sendProjectStart(project.agent, project.poolType);

        // 初始化税收追踪器
        this.taxTracker = new TaxTracker();
        await this.taxTracker.init(this.context.t0!);
        this.context.startBalance = this.taxTracker.getStartBalance();

        // 初始化大额交易监控器
        this.whaleTrades = new WhaleTrades(project.poolAddress, project.poolType);
        await this.whaleTrades.start((trade) => {
            getApiServer().recordTrade(trade);
            notifier.sendWhaleTrade(trade, project.agent);
        });

        this.transition(State.LAUNCH_WINDOW);
    }

    /**
     * LAUNCH_WINDOW: 税收窗口 [T0, T1]
     */
    private async handleLaunchWindow(): Promise<void> {
        if (!this.context.project || !this.context.t1 || !this.taxTracker) {
            this.transition(State.DISCOVER);
            return;
        }

        const now = Date.now();
        const t1Time = this.context.t1.getTime();

        // 检查是否到达 T1
        if (now >= t1Time) {
            // 最后一次更新税收
            const result = await this.taxTracker.update();
            this.context.taxTotal = result.netInflow;

            logger.info('Tax window closed', {
                taxTotal: this.context.taxTotal.toString(),
            });

            // 发送最终税收报告
            const notifier = getTelegramNotifier();
            const elapsedMinutes = getConfig().thresholds.taxWindowMinutes;
            await notifier.sendTaxProgress(result, this.context.project.agent, elapsedMinutes);
            getApiServer().updateTax(result, elapsedMinutes);

            this.transition(State.BUYBACK_PHASE);
            return;
        }

        const taxUpdateInterval = 5 * 60 * 1000;
        if (!this.context.lastTaxUpdate || now - this.context.lastTaxUpdate.getTime() >= taxUpdateInterval) {
            const provider = getRpcPool().getHttpProvider();
            let latestBlock = await provider.getBlockNumber();
            let progress = this.taxTracker.getProgress();
            const maxCatchUpRounds = 10;
            let rounds = 0;
            while (latestBlock - progress.currentBlock > 2000 && rounds < maxCatchUpRounds) {
                await this.taxTracker.update();
                progress = this.taxTracker.getProgress();
                latestBlock = await provider.getBlockNumber();
                rounds++;
            }
            const result = await this.taxTracker.update();
            this.context.lastTaxUpdate = new Date();
            const elapsedMinutes = (now - this.context.t0!.getTime()) / (60 * 1000);
            getApiServer().updateTax(result, elapsedMinutes);
            const notifier = getTelegramNotifier();
            await notifier.sendTaxProgress(result, this.context.project.agent, elapsedMinutes);
        }

        if (this.context.project.poolType === 'virtuals_curve') {
            const tokenAddr = this.context.project.agent.preToken ?? this.context.project.agent.tokenAddress ?? null;
            const fdv = await computeCurveFdv(this.context.project.poolAddress, tokenAddr);
            if (fdv) {
                getApiServer().updateOnchainFdv(fdv.fdvInVirtual, fdv.fdvUsd);
                getApiServer().updateApiFdv(null, null);
            } else {
                try {
                    const api = getVirtualsApi();
                    const fresh = await api.getProjectById(this.context.project.agent.id);
                    if (fresh && (fresh.mcapInVirtual != null || fresh.virtualTokenValue)) {
                        const apiFdvVirtual = fresh.virtualTokenValue ?? String(fresh.mcapInVirtual ?? 0);
                        const usdPerVirtual = await getVirtualPriceUsd();
                        const apiFdvUsd = usdPerVirtual != null && usdPerVirtual > 0 && fresh.mcapInVirtual != null
                            ? (fresh.mcapInVirtual * usdPerVirtual).toFixed(2)
                            : null;
                        getApiServer().updateApiFdv(apiFdvVirtual, apiFdvUsd);
                    }
                } catch {
                    getApiServer().updateApiFdv(null, null);
                }
            }
        }

        if (!this.lastProjectStatusCheck || now - this.lastProjectStatusCheck.getTime() >= this.projectStatusCheckIntervalMs) {
            this.lastProjectStatusCheck = new Date();
            const api = getVirtualsApi();
            try {
                const fresh = await api.getProjectById(this.context.project.agent.id);
                if (fresh && (fresh.status === 'AVAILABLE' || Boolean(fresh.lpAddress))) {
                    logger.info('Project graduated, ending monitoring', { symbol: this.context.project.agent.symbol });
                    this.transition(State.DONE);
                }
            } catch {
                // ignore fetch error, keep current project
            }
        }
    }

    /**
     * BUYBACK_PHASE: 回购阶段 [T1, ∞)
     */
    private async handleBuybackPhase(): Promise<void> {
        if (!this.context.project) {
            this.transition(State.DISCOVER);
            return;
        }

        const notifier = getTelegramNotifier();

        // 首次进入，初始化回购追踪器
        if (!this.buybackTracker) {
            this.buybackTracker = new BuybackTracker(this.context.taxTotal);
            await this.buybackTracker.start(() => {
                notifier.sendStallAlert(this.context.project!.agent);
            });
        }

        // 检查是否完成
        if (this.buybackTracker.isComplete()) {
            this.transition(State.DONE);
            return;
        }

        const now = Date.now();
        if (!this.lastProjectStatusCheck || now - this.lastProjectStatusCheck.getTime() >= this.projectStatusCheckIntervalMs) {
            this.lastProjectStatusCheck = new Date();
            const api = getVirtualsApi();
            try {
                const fresh = await api.getProjectById(this.context.project.agent.id);
                if (fresh && (fresh.status === 'AVAILABLE' || Boolean(fresh.lpAddress))) {
                    logger.info('Project graduated during buyback, ending monitoring', { symbol: this.context.project.agent.symbol });
                    this.transition(State.DONE);
                    return;
                }
            } catch {
                // ignore
            }
        }

        const buybackUpdateInterval = 10 * 60 * 1000;
        if (!this.context.lastBuybackUpdate || now - this.context.lastBuybackUpdate.getTime() >= buybackUpdateInterval) {
            const status = this.buybackTracker.getStatus();
            this.context.lastBuybackUpdate = new Date();

            await notifier.sendBuybackStatus(status, this.context.project.agent);
            getApiServer().updateBuyback(status);

            this.buybackTracker.checkStall();
        }
    }

    /**
     * DONE: 监控完成
     */
    private async handleDone(): Promise<void> {
        if (!this.context.project || !this.buybackTracker) {
            await this.cleanup();
            this.transition(State.DISCOVER);
            return;
        }

        const notifier = getTelegramNotifier();
        const status = this.buybackTracker.getStatus();
        getApiServer().updateBuyback(status);

        await notifier.sendComplete(this.context.project.agent, status);

        logger.info('Monitoring complete', {
            project: this.context.project.agent.symbol,
            spentTotal: status.spentTotal.toString(),
            progress: status.progress,
        });

        await this.cleanup();

        // 重置上下文，发现下一个项目
        this.context = {
            state: State.DISCOVER,
            project: null,
            t0: null,
            t1: null,
            taxTotal: 0n,
            startBalance: null,
            lastTaxUpdate: null,
            lastBuybackUpdate: null,
        };
    }

    /**
     * 状态转换
     */
    private transition(newState: State): void {
        logger.info('State transition', {
            from: this.context.state,
            to: newState,
        });
        this.context.state = newState;
        if (newState === State.DISCOVER) {
            this.context.startBalance = null;
        }

        // 立即更新健康状态
        this.updateHealthStatus();
        this.updateApiStatus();
    }

    /**
     * 清理资源
     */
    private async cleanup(): Promise<void> {
        if (this.whaleTrades) {
            await this.whaleTrades.stop();
            this.whaleTrades = null;
        }
        if (this.buybackTracker) {
            await this.buybackTracker.stop();
            this.buybackTracker = null;
        }
        this.taxTracker = null;
    }

    /**
     * 获取当前上下文（只读）
     */
    getContext(): Readonly<StateMachineContext> {
        return { ...this.context };
    }

    /**
     * 停止状态机
     */
    stop(): void {
        this.abortController.abort();
    }
}
