/**
 * Virtuals API 封装
 * 支持项目发现、选择和详情查询
 */

import { logger, sleep, ApiError, withRetry, withTimeout } from '../utils/index.js';
import { getConfig } from '../config.js';
import type { VirtualsAgent, VirtualsApiResponse, SelectedProject } from '../types.js';

const REQUEST_TIMEOUT_MS = 10000;

export class VirtualsApi {
    private baseUrl: string;
    private pollInterval: number;
    private maxProjectAge: number;

    constructor() {
        const config = getConfig();
        this.baseUrl = config.virtuals.apiBase;
        this.pollInterval = config.virtuals.pollIntervalMs;
        this.maxProjectAge = config.virtuals.maxProjectAgeMinutes;
    }

    /**
     * 执行 API 请求（带重试）
     */
    private async request<T>(path: string): Promise<T> {
        const url = `${this.baseUrl}${path}`;

        return withRetry(
            async () => {
                const endTimer = logger.time(`API ${path}`);

                try {
                    const response = await withTimeout(
                        fetch(url, {
                            headers: {
                                'Accept': 'application/json',
                                'User-Agent': 'VirtualsLaunchWatcher/1.0',
                            },
                        }),
                        REQUEST_TIMEOUT_MS,
                        'API request timeout'
                    );

                    endTimer();

                    if (!response.ok) {
                        throw new ApiError(
                            `API request failed: ${response.statusText}`,
                            response.status,
                            url
                        );
                    }

                    return (await response.json()) as T;
                } catch (error) {
                    endTimer();
                    throw error;
                }
            },
            {
                maxAttempts: 3,
                initialDelayMs: 1000,
                maxDelayMs: 10000,
            }
        );
    }

    /**
     * 获取项目列表（按 LP 创建时间倒序）
     */
    async getLatestProjects(pageSize: number = 20): Promise<VirtualsAgent[]> {
        const path = `/api/virtuals?sort[0]=lpCreatedAt:desc&pagination[pageSize]=${pageSize}`;

        try {
            const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);

            logger.debug('Fetched projects from API', {
                count: response.data.length,
                total: response.meta.pagination.total,
            });

            return response.data;
        } catch (error) {
            logger.logError('Failed to fetch projects', error);
            throw error;
        }
    }

    /**
     * 按创建时间获取最新项目
     */
    async getNewestProjects(pageSize: number = 20): Promise<VirtualsAgent[]> {
        const path = `/api/virtuals?sort[0]=createdAt:desc&pagination[pageSize]=${pageSize}`;
        const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
        return response.data;
    }

    /**
     * 获取 60 Days 项目
     */
    async getVibesProjects(pageSize: number = 20): Promise<VirtualsAgent[]> {
        const path = `/api/virtuals?filters[factory][$eq]=VIBES_BONDING_V2&pagination[pageSize]=${pageSize}`;
        const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
        return response.data;
    }

    /**
     * 获取单个项目详情
     */
    async getProjectById(id: number): Promise<VirtualsAgent | null> {
        try {
            const response = await this.request<{ data: VirtualsAgent }>(`/api/virtuals/${id}`);
            return response.data;
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * 选择监控目标
     * 规则：
     * 1. 优先：AVAILABLE + lpAddress 非空 + age <= maxProjectAge
     * 2. 候补：最新 UNDERGRAD + preTokenPair 非空
     */
    selectProject(agents: VirtualsAgent[]): SelectedProject | null {
        if (!agents || agents.length === 0) {
            logger.debug('No agents to select from');
            return null;
        }

        const now = Date.now();

        // 按 lpCreatedAt 倒序排列
        const sorted = [...agents].sort((a, b) => {
            const timeA = a.lpCreatedAt ? new Date(a.lpCreatedAt).getTime() : 0;
            const timeB = b.lpCreatedAt ? new Date(b.lpCreatedAt).getTime() : 0;
            return timeB - timeA;
        });

        // 优先：最近上线的 AVAILABLE 项目
        for (const agent of sorted) {
            if (
                agent.status === 'AVAILABLE' &&
                agent.lpAddress &&
                agent.tokenAddress &&
                agent.lpCreatedAt
            ) {
                const lpTime = new Date(agent.lpCreatedAt).getTime();
                const ageMinutes = (now - lpTime) / (60 * 1000);

                if (ageMinutes <= this.maxProjectAge) {
                    logger.info('Selected AVAILABLE project', {
                        id: agent.id,
                        name: agent.name,
                        symbol: agent.symbol,
                        ageMinutes: ageMinutes.toFixed(1),
                        lpAddress: agent.lpAddress,
                    });

                    return {
                        agent,
                        poolAddress: agent.lpAddress,
                        poolType: 'uniswap_v2',
                        t0: new Date(agent.lpCreatedAt),
                    };
                }
            }
        }

        // 候补：最新的 UNDERGRAD 项目
        for (const agent of sorted) {
            if (agent.status === 'UNDERGRAD' && agent.preTokenPair) {
                logger.info('Selected UNDERGRAD project (fallback)', {
                    id: agent.id,
                    name: agent.name,
                    symbol: agent.symbol,
                    preTokenPair: agent.preTokenPair,
                });

                return {
                    agent,
                    poolAddress: agent.preTokenPair,
                    poolType: 'virtuals_curve',
                    t0: new Date(), // 需要链上确认
                };
            }
        }

        logger.debug('No suitable project found', {
            totalAgents: agents.length,
            availableCount: agents.filter(a => a.status === 'AVAILABLE').length,
            undergradCount: agents.filter(a => a.status === 'UNDERGRAD').length,
        });

        return null;
    }

    /**
     * 轮询发现项目
     */
    async discoverProject(
        onFound: (project: SelectedProject) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 10;

        while (!abortSignal?.aborted) {
            try {
                const agents = await this.getLatestProjects();
                const selected = this.selectProject(agents);

                if (selected) {
                    consecutiveErrors = 0;
                    onFound(selected);
                    return;
                }

                consecutiveErrors = 0;
                logger.debug('No project found, waiting for next poll', {
                    interval: this.pollInterval,
                });

                await sleep(this.pollInterval);
            } catch (error) {
                consecutiveErrors++;

                logger.warn('Discovery poll failed', {
                    consecutiveErrors,
                    maxConsecutiveErrors,
                    error: error instanceof Error ? error.message : String(error),
                });

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    throw new Error(`Too many consecutive API errors: ${consecutiveErrors}`);
                }

                // 指数退避
                const delay = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
                await sleep(delay);
            }
        }
    }

    /**
     * 监控项目状态变化
     */
    async watchProject(
        projectId: number,
        onChange: (agent: VirtualsAgent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        let lastStatus: string | null = null;

        while (!abortSignal?.aborted) {
            try {
                const agent = await this.getProjectById(projectId);

                if (agent && agent.status !== lastStatus) {
                    lastStatus = agent.status;
                    onChange(agent);
                }

                await sleep(this.pollInterval);
            } catch (error) {
                logger.warn('Project watch error', {
                    projectId,
                    error: error instanceof Error ? error.message : String(error),
                });
                await sleep(this.pollInterval * 2);
            }
        }
    }
}

// 单例
let virtualsApiInstance: VirtualsApi | null = null;

export function getVirtualsApi(): VirtualsApi {
    if (!virtualsApiInstance) {
        virtualsApiInstance = new VirtualsApi();
    }
    return virtualsApiInstance;
}
