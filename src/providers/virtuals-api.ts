/**
 * Virtuals API 封装
 * 支持项目发现、选择和详情查询
 */

import { logger, sleep, ApiError, withRetry, withTimeout } from '../utils/index.js';
import { getConfig } from '../config.js';
import type { VirtualsAgent, VirtualsApiResponse, SelectedProject, FactoryType } from '../types.js';

function getTaxWindowMs(): number {
    return getConfig().thresholds.taxWindowMinutes * 60 * 1000;
}

const REQUEST_TIMEOUT_MS = 10000;

export class VirtualsApi {
    private baseUrl: string;
    private pollInterval: number;
    private maxProjectAge: number;
    private readonly discoveryPage = 1;
    private readonly discoveryPageSize = 200;
    private upcomingCache: { ts: number; data: VirtualsAgent[] } | null = null;
    private upcomingInFlight: Promise<VirtualsAgent[]> | null = null;

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
     * 获取项目列表（按创建时间倒序）
     */
    async getLatestProjects(page: number = 1, pageSize: number = this.discoveryPageSize): Promise<VirtualsAgent[]> {
        return this.getProjectsBySort('createdAt:desc', page, pageSize);
    }

    async getProjectsBySort(
        sort: 'createdAt:desc' | 'lpCreatedAt:desc' | 'launchedAt:desc',
        page: number,
        pageSize: number
    ): Promise<VirtualsAgent[]> {
        const path = this.buildProjectsQuery({ sort, page, pageSize });
        try {
            const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
            logger.debug('Fetched projects from API', {
                sort,
                count: response.data.length,
                total: response.meta.pagination.total,
            });
            return response.data;
        } catch (error) {
            if (sort !== 'createdAt:desc') {
                logger.debug('Fallback sort failed', { sort, error: String(error) });
                return [];
            }
            logger.logError('Failed to fetch projects', error);
            throw error;
        }
    }

    /**
     * 按创建时间获取最新项目
     */
    async getNewestProjects(page: number = 1, pageSize: number = this.discoveryPageSize): Promise<VirtualsAgent[]> {
        const path = this.buildProjectsQuery({
            sort: 'createdAt:desc',
            page,
            pageSize,
        });
        const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
        return response.data;
    }

    /**
     * 获取 60 Days 项目
     */
    async getVibesProjects(page: number = 1, pageSize: number = this.discoveryPageSize): Promise<VirtualsAgent[]> {
        const path = this.buildProjectsQuery({
            sort: 'createdAt:desc',
            page,
            pageSize,
            factory: 'VIBES_BONDING_V2',
        });
        const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
        return response.data;
    }

    async getProjectsByFactory(
        factory: FactoryType,
        page: number = 1,
        pageSize: number = this.discoveryPageSize
    ): Promise<VirtualsAgent[]> {
        const path = this.buildProjectsQuery({
            sort: 'createdAt:desc',
            page,
            pageSize,
            factory,
        });
        const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
        return response.data;
    }

    private async getAllProjectsByFactory(factory: FactoryType, pageSize: number = 100): Promise<VirtualsAgent[]> {
        let page = 1;
        let pageCount = 1;
        const all: VirtualsAgent[] = [];

        do {
            const path = this.buildProjectsQuery({
                sort: 'createdAt:desc',
                page,
                pageSize,
                factory,
            });
            const response = await this.request<VirtualsApiResponse<VirtualsAgent>>(path);
            all.push(...response.data);
            pageCount = response.meta.pagination.pageCount;
            page++;
        } while (page <= pageCount);

        return all;
    }

    async getUpcomingLaunches(pageSize: number = 100): Promise<VirtualsAgent[]> {
        const now = Date.now();
        const cacheTtlMs = 30_000;
        if (this.upcomingCache && now - this.upcomingCache.ts < cacheTtlMs) {
            return this.upcomingCache.data;
        }
        if (this.upcomingInFlight) {
            return this.upcomingInFlight;
        }

        this.upcomingInFlight = (async () => {
            const [vibes, unicorn, unicornV2] = await Promise.all([
                this.getAllProjectsByFactory('VIBES_BONDING_V2', pageSize),
                this.getAllProjectsByFactory('BONDING_V4', pageSize),
                this.getAllProjectsByFactory('BONDING_V2', pageSize),
            ]);
            const merged = [...vibes, ...unicorn, ...unicornV2];
            const deduped = new Map<number, VirtualsAgent>();
            for (const agent of merged) {
                deduped.set(agent.id, agent);
            }

            const result = [...deduped.values()]
                .filter((agent) =>
                    agent.status === 'INITIALIZED' &&
                    Boolean(agent.preTokenPair) &&
                    !agent.lpCreatedAt
                )
                .filter((agent) => {
                    const launchTs = this.parseTimestamp(agent.launchedAt);
                    if (launchTs === null) {
                        return false;
                    }
                    const nowTs = Date.now();
                    const maxTs = nowTs + 10 * 24 * 60 * 60 * 1000;
                    return launchTs >= nowTs && launchTs <= maxTs;
                })
                .sort((a, b) => {
                    const at = this.parseTimestamp(a.launchedAt) ?? 0;
                    const bt = this.parseTimestamp(b.launchedAt) ?? 0;
                    return at - bt;
                });

            this.upcomingCache = { ts: Date.now(), data: result };
            return result;
        })();

        try {
            return await this.upcomingInFlight;
        } finally {
            this.upcomingInFlight = null;
        }
    }

    private buildProjectsQuery(params: {
        sort: 'createdAt:desc' | 'lpCreatedAt:desc' | 'launchedAt:desc';
        page: number;
        pageSize: number;
        factory?: string;
    }): string {
        const safePage = Number.isFinite(params.page) ? Math.max(1, Math.floor(params.page)) : 1;
        const safePageSize = Number.isFinite(params.pageSize) ? Math.min(200, Math.max(1, Math.floor(params.pageSize))) : this.discoveryPageSize;
        const base = `/api/virtuals?sort[0]=${params.sort}&pagination[page]=${safePage}&pagination[pageSize]=${safePageSize}`;

        if (!params.factory) {
            return base;
        }
        return `${base}&filters[factory][$eq]=${params.factory}`;
    }

    private parseTimestamp(value: string | null | undefined): number | null {
        if (!value) {
            return null;
        }
        const ts = Date.parse(value);
        return Number.isNaN(ts) ? null : ts;
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
     * 选择监控目标：当前在打的 UNDERGRAD（如 ORION）
     * 优先选「在税收窗口内」的（T0<=now<=T1）；若无则选「最近开打」的一个（T0 倒序）。T0=launchedAt ?? lpCreatedAt ?? createdAt
     */
    selectProject(agents: VirtualsAgent[]): SelectedProject | null {
        if (!agents || agents.length === 0) {
            logger.debug('No agents to select from');
            return null;
        }

        const now = Date.now();
        const windowMs = getTaxWindowMs();

        const undergrads = agents.filter(
            (agent) =>
                (agent.status?.toUpperCase?.() ?? '') === 'UNDERGRAD' &&
                Boolean(agent.preTokenPair) &&
                !agent.lpAddress
        );

        const createdTs = (a: VirtualsAgent) => this.parseTimestamp(a.createdAt) ?? 0;
        const lpCreatedTs = (a: VirtualsAgent) => this.parseTimestamp(a.lpCreatedAt);
        const launchedTs = (a: VirtualsAgent) => this.parseTimestamp(a.launchedAt);
        const t0For = (a: VirtualsAgent) => launchedTs(a) ?? lpCreatedTs(a) ?? createdTs(a);

        const withT0: { agent: VirtualsAgent; t0: number }[] = [];
        for (const agent of undergrads) {
            const t0 = t0For(agent);
            if (t0 <= 0) continue;
            withT0.push({ agent, t0 });
        }

        if (withT0.length === 0) {
            logger.debug('No UNDERGRAD with valid T0', { totalAgents: agents.length, undergradCount: undergrads.length });
            return null;
        }

        const inWindow = withT0.filter(({ t0 }) => t0 <= now && now <= t0 + windowMs);
        const list = inWindow.length > 0
            ? inWindow.sort((a, b) => b.t0 - a.t0)
            : withT0.sort((a, b) => b.t0 - a.t0);
        const orion = list.find(({ agent }) => (agent.symbol?.toUpperCase?.() ?? '') === 'ORION');
        const picked = orion ?? list[0];
        const { agent: undergrad, t0 } = picked;

        logger.info('Selected UNDERGRAD', {
            id: undergrad.id,
            name: undergrad.name,
            symbol: undergrad.symbol,
            inWindow: inWindow.length > 0,
            t0: new Date(t0).toISOString(),
        });

        return {
            agent: undergrad,
            poolAddress: undergrad.preTokenPair!,
            poolType: 'virtuals_curve',
            t0: new Date(t0),
        };
    }

    /**
     * 轮询发现项目：拉取两种排序并合并，确保当前在打的（如 ORION）能进列表
     */
    async discoverProject(
        onFound: (project: SelectedProject) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 10;

        while (!abortSignal?.aborted) {
            try {
                logger.debug('Discover poll request', {
                    endpoint: '/api/virtuals',
                    page: this.discoveryPage,
                    pageSize: this.discoveryPageSize,
                });

                const [byCreated, byLaunched] = await Promise.all([
                    this.getLatestProjects(this.discoveryPage, this.discoveryPageSize),
                    this.getProjectsBySort('launchedAt:desc', this.discoveryPage, this.discoveryPageSize),
                ]);
                const byId = new Map<number, VirtualsAgent>();
                for (const a of [...byLaunched, ...byCreated]) {
                    if (!byId.has(a.id)) byId.set(a.id, a);
                }
                const agents = Array.from(byId.values());
                const selected = this.selectProject(agents);

                if (selected) {
                    consecutiveErrors = 0;
                    logger.info('Discover poll selected project', {
                        projectId: selected.agent.id,
                        symbol: selected.agent.symbol,
                        status: selected.agent.status,
                        poolType: selected.poolType,
                        selectedT0: selected.t0.toISOString(),
                        createdAt: selected.agent.createdAt,
                        lpCreatedAt: selected.agent.lpCreatedAt,
                    });
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
