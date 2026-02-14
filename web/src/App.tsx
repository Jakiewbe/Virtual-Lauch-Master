import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks';
import { getState, getTrades, getHealth, getUpcomingLaunches } from './api';
import type { ApiState, Trade, RpcHealth, UpcomingLaunch } from './types';

function fmtV(value: string): string {
    const num = parseFloat(value) / 1e18;
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function short(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtMin(minutes: number): string {
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
}

function stateLabel(s: string): string {
    const m: Record<string, string> = {
        DISCOVER: '发现项目',
        WAIT_T0: '等待开盘',
        LAUNCH_WINDOW: '税收窗口',
        BUYBACK_PHASE: '回购中',
        DONE: '已完成',
    };
    return m[s] || s;
}

function countdown(launchedAt: string | null): string {
    if (!launchedAt) return '—';
    const t = new Date(launchedAt).getTime();
    const now = Date.now();
    if (t <= now) return '已发射';
    const d = Math.floor((t - now) / 86400000);
    const h = Math.floor(((t - now) % 86400000) / 3600000);
    const m = Math.floor(((t - now) % 3600000) / 60000);
    if (d > 0) return `${d}天${h}时${m}分`;
    if (h > 0) return `${h}时${m}分`;
    return `${m}分`;
}

function buybackEndTime(t1Iso: string | null, etaHours: number | null | undefined): string {
    if (!t1Iso || etaHours == null || !Number.isFinite(etaHours) || etaHours < 0) return '—';
    const t1 = new Date(t1Iso).getTime();
    const end = new Date(t1 + etaHours * 3600 * 1000);
    return end.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function stateDot(s: string): string {
    if (s === 'LAUNCH_WINDOW' || s === 'BUYBACK_PHASE') return 'live';
    if (s === 'DISCOVER' || s === 'WAIT_T0') return 'wait';
    return 'idle';
}

const ICO_DASH = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
);

const ICO_TRADE = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 13L7 7L10 10L15 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 4H15V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const ICO_ROCKET = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2L9 16M9 2L5 6M9 2L13 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const ICO_GEAR = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M9 2V4M9 14V16M2 9H4M14 9H16M4.2 4.2L5.6 5.6M12.4 12.4L13.8 13.8M13.8 4.2L12.4 5.6M5.6 12.4L4.2 13.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
);

type Tab = 'dashboard' | 'trades' | 'upcoming' | 'settings';

const navTitles: Record<Tab, string> = {
    dashboard: '仪表盘',
    trades: '交易记录',
    upcoming: '即将发射',
    settings: '设置',
};

export default function App() {
    const { isConnected, state: wsState, reconnect } = useWebSocket();
    const [state, setState] = useState<ApiState | null>(null);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [upcoming, setUpcoming] = useState<UpcomingLaunch[]>([]);
    const [health, setHealth] = useState<RpcHealth | null>(null);
    const [tab, setTab] = useState<Tab>('dashboard');

    useEffect(() => {
        (async () => {
            const [s, t, h] = await Promise.allSettled([getState(), getTrades(), getHealth()]);
            const u = await getUpcomingLaunches().then(
                d => ({ status: 'fulfilled' as const, value: d }),
                () => ({ status: 'rejected' as const }),
            );
            if (s.status === 'fulfilled') setState(s.value);
            if (t.status === 'fulfilled') setTrades(t.value);
            if (h.status === 'fulfilled') setHealth(h.value);
            if (u.status === 'fulfilled') setUpcoming(u.value);
        })();
    }, []);

    useEffect(() => { if (wsState) setState(wsState); }, [wsState]);

    useEffect(() => {
        const id = setInterval(async () => {
            try {
                const [t, h, s] = await Promise.allSettled([
                    getTrades(), getHealth(),
                    isConnected ? Promise.resolve(null) : getState(),
                ]);
                const u = await getUpcomingLaunches().then(
                    d => ({ status: 'fulfilled' as const, value: d }),
                    () => ({ status: 'rejected' as const }),
                );
                if (t.status === 'fulfilled') setTrades(t.value);
                if (h.status === 'fulfilled') setHealth(h.value);
                if (s.status === 'fulfilled' && s.value) setState(s.value);
                if (u.status === 'fulfilled') setUpcoming(u.value);
            } catch {}
        }, 10000);
        return () => clearInterval(id);
    }, [isConnected]);

    const navItems: { id: Tab; icon: JSX.Element }[] = [
        { id: 'dashboard', icon: ICO_DASH },
        { id: 'trades', icon: ICO_TRADE },
        { id: 'upcoming', icon: ICO_ROCKET },
        { id: 'settings', icon: ICO_GEAR },
    ];

    return (
        <div className="shell">
            <nav className="rail">
                <div className="rail-logo">
                    <img src="/virtuals-logo.svg" alt="Virtuals" />
                </div>
                {navItems.map(n => (
                    <button
                        key={n.id}
                        className={`rail-btn ${tab === n.id ? 'active' : ''}`}
                        onClick={() => setTab(n.id)}
                        title={navTitles[n.id]}
                        aria-label={navTitles[n.id]}
                    >
                        {n.icon}
                    </button>
                ))}
                <div className="rail-spacer" />
                <div className={`rail-status ${isConnected ? 'on' : 'off'}`} />
            </nav>

            <header className="topbar">
                <span className="topbar-title">Virtuals 监控</span>
                <div className="topbar-sep" />
                {state && (
                    <div className="topbar-state">
                        <span className={`topbar-dot ${stateDot(state.state)}`} />
                        {stateLabel(state.state)}
                    </div>
                )}
                <div className="topbar-push" />
                {!isConnected && (
                    <button className="btn-reconnect" onClick={reconnect}>重连</button>
                )}
                <span className={`topbar-conn ${isConnected ? 'ok' : 'err'}`}>
                    {isConnected ? '已连接' : '未连接'}
                </span>
            </header>

            <main className="content">
                {tab === 'dashboard' && <Dashboard state={state} health={health} trades={trades} />}
                {tab === 'trades' && <TradesView trades={trades} />}
                {tab === 'upcoming' && <UpcomingView launches={upcoming} />}
                {tab === 'settings' && <SettingsView health={health} />}
            </main>
        </div>
    );
}

function taxRatePercent(elapsedMinutes: number): number {
    return Math.max(1, Math.min(99, 99 - Math.floor(elapsedMinutes)));
}

function Dashboard({ state, health, trades }: { state: ApiState | null; health: RpcHealth | null; trades: Trade[] }) {
    if (!state) return <div className="empty"><div className="empty-icon">◌</div><p>加载中…</p></div>;

    const taxPct = state.tax ? Math.min(100, (state.elapsedMinutes / 100) * 100) : 0;
    const bbPct = state.buyback?.progress ?? 0;
    const startBalance = state.startBalance ?? null;
    const ratePerHour = state.buyback?.ratePerHour ?? 0;
    const lastTxAmount = state.buyback?.lastTxAmount ?? null;
    const buyTaxPct = state.state === 'LAUNCH_WINDOW' ? taxRatePercent(state.elapsedMinutes) : null;
    const fdvUsd = state.onchainFdvUsd ?? null;
    const fdvVirtual = state.onchainFdvVirtual ?? null;
    const apiFdvUsd = state.apiFdvUsd ?? null;
    const apiFdvVirtual = state.apiFdvVirtual ?? null;
    const hasOnchain = fdvUsd != null && fdvUsd !== '' || fdvVirtual != null && fdvVirtual !== '';
    const hasApi = apiFdvUsd != null && apiFdvUsd !== '' || apiFdvVirtual != null && apiFdvVirtual !== '';

    return (
        <>
            <div className="sec-head">
                <h1 className="sec-title">仪表盘</h1>
            </div>

            {state.state === 'DISCOVER' && !state.project && (
                <div className="settings-block" style={{ marginBottom: 16 }}>
                    <div className="settings-title">当前无打新项目</div>
                    <div className="launch-row">
                        <span className="launch-row-value c-dim">持续轮询中，有 UNDERGRAD 项目开打时会自动接入</span>
                    </div>
                </div>
            )}

            {(state.state === 'LAUNCH_WINDOW' && state.project) || hasOnchain || hasApi ? (
                <div className="settings-block fdv-block" style={{ marginBottom: 16 }}>
                    <div className="settings-title">链上实测市值（较官网预估更实时）</div>
                    {hasOnchain ? (
                        <div className="fdv-value">
                            {fdvUsd != null && fdvUsd !== ''
                                ? `$${Number(fdvUsd).toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`
                                : `${Number(fdvVirtual).toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} V`}
                        </div>
                    ) : hasApi ? (
                        <>
                            <div className="fdv-value">
                                {apiFdvUsd != null && apiFdvUsd !== ''
                                    ? `$${Number(apiFdvUsd).toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`
                                    : `${Number(apiFdvVirtual).toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} V`}
                            </div>
                            <div className="metric-sub" style={{ marginTop: 4 }}>官网估值</div>
                        </>
                    ) : (
                        <div className="fdv-value">获取中…</div>
                    )}
                </div>
            ) : null}

            {buyTaxPct != null && (
                <div className="settings-block" style={{ marginBottom: 16 }}>
                    <div className="settings-title">当前买入税率</div>
                    <div className="launch-row" style={{ marginBottom: 6 }}>
                        <span className="launch-row-label">税率</span>
                        <span className="launch-row-value c-accent">{buyTaxPct}%</span>
                    </div>
                    <div className="launch-row">
                        <span className="launch-row-label">税后可得</span>
                        <span className="launch-row-value">投入 100 VIRTUAL 税后约 {100 - buyTaxPct} VIRTUAL 用于买币</span>
                    </div>
                </div>
            )}

            {state.project && (
                <div className="project-banner">
                    <div>
                        <div className="project-symbol">${state.project.symbol}</div>
                        <div className="project-name">{state.project.name}</div>
                    </div>
                    <div className="project-meta">
                        {state.project.lpAddress && (
                            <div className="project-meta-item">
                                <div className="project-meta-label">池地址</div>
                                <div className="project-meta-value">{short(state.project.lpAddress)}</div>
                            </div>
                        )}
                        {state.project.tokenAddress && (
                            <div className="project-meta-item">
                                <div className="project-meta-label">代币地址</div>
                                <div className="project-meta-value">{short(state.project.tokenAddress)}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {(startBalance !== null || state.taxTotal || state.tax) && (
                <div className="settings-block" style={{ marginBottom: 20 }}>
                    <div className="settings-title">打新数据</div>
                    <div className="launch-row" style={{ marginBottom: 8 }}>
                        <span className="launch-row-label">打新开始 VIRTUAL</span>
                        <span className="launch-row-value">{startBalance !== null ? fmtV(startBalance) : '—'}</span>
                    </div>
                    <div className="launch-row" style={{ marginBottom: 8 }}>
                        <span className="launch-row-label">打新开始 价值 (USDC)</span>
                        <span className="launch-row-value c-dim">暂无报价</span>
                    </div>
                    <div className="launch-row" style={{ marginBottom: 8 }}>
                        <span className="launch-row-label">税收窗口净流入</span>
                        <span className="launch-row-value">{state.tax ? fmtV(state.tax.netInflow) : state.taxTotal ? fmtV(state.taxTotal) : '—'}</span>
                    </div>
                    <div className="launch-row">
                        <span className="launch-row-label">税收窗口 价值 (USDC)</span>
                        <span className="launch-row-value c-dim">暂无报价</span>
                    </div>
                </div>
            )}

            <div className="metrics">
                <div className="metric">
                    <div className="metric-label">税收流入</div>
                    <div className="metric-value">{state.tax ? fmtV(state.tax.netInflow) : '—'}</div>
                    <div className="metric-sub">{state.t0 ? `${fmtMin(state.elapsedMinutes)} / 100m` : '等待中'}</div>
                    <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${taxPct}%` }} /></div>
                </div>

                <div className="metric">
                    <div className="metric-label">回购进度</div>
                    <div className="metric-value">{state.buyback ? `${bbPct.toFixed(1)}%` : '—'}</div>
                    <div className="metric-sub">
                        {state.buyback
                            ? `速率 ${ratePerHour.toLocaleString(undefined, { maximumFractionDigits: 2 })} V/h · 最近一笔 ${lastTxAmount != null ? fmtV(lastTxAmount) : '—'} V`
                            : '等待税收窗口结束'}
                    </div>
                    <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${bbPct}%` }} /></div>
                </div>

                <div className="metric">
                    <div className="metric-label">回购持续至</div>
                    <div className="metric-value" style={{ fontSize: 16 }}>
                        {state.buyback ? buybackEndTime(state.t1, state.buyback.etaHours) : '—'}
                    </div>
                    <div className="metric-sub">从发射时刻起算</div>
                </div>

                <div className="metric">
                    <div className="metric-label">大额交易</div>
                    <div className="metric-value">{trades.length}</div>
                    <div className="metric-sub">
                        {trades.length > 0
                            ? `最近: ${trades[0].direction === 'BUY' ? '买入' : '卖出'} ${fmtV(trades[0].amountVirtual)}`
                            : '暂无'}
                    </div>
                </div>

                <div className="metric">
                    <div className="metric-label">RPC</div>
                    <div className="metric-value">{health?.http.healthy ? '正常' : '—'}</div>
                    <div className="metric-sub">{health?.http.latencyMs != null ? `${health.http.latencyMs}ms` : '—'}</div>
                </div>
            </div>

            {trades.length > 0 && (
                <div className="tbl-wrap">
                    <div className="tbl-head">
                        <span className="tbl-title">最近大额交易</span>
                        <span className="sec-count">{trades.length}</span>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>方向</th>
                                <th>数量</th>
                                <th>交易者</th>
                                <th>区块</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.slice(0, 5).map(t => (
                                <tr key={t.txHash}>
                                    <td>
                                        <span className={`dir-dot ${t.direction === 'BUY' ? 'buy' : 'sell'}`} />
                                        <span className={t.direction === 'BUY' ? 'c-green' : 'c-red'}>
                                            {t.direction === 'BUY' ? '买入' : '卖出'}
                                        </span>
                                    </td>
                                    <td className="mono">{fmtV(t.amountVirtual)}</td>
                                    <td>
                                        <a href={`https://basescan.org/address/${t.trader}`} target="_blank" rel="noopener noreferrer" className="link">
                                            {short(t.trader)}
                                        </a>
                                    </td>
                                    <td>
                                        <a href={`https://basescan.org/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer" className="link">
                                            {t.blockNumber}
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function TradesView({ trades }: { trades: Trade[] }) {
    return (
        <>
            <div className="sec-head">
                <h1 className="sec-title">交易记录</h1>
                <span className="sec-count">{trades.length}</span>
            </div>
            {trades.length === 0 ? (
                <div className="empty"><div className="empty-icon">◌</div><p>暂无大额交易记录</p></div>
            ) : (
                <div className="tbl-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>时间</th>
                                <th>方向</th>
                                <th>数量</th>
                                <th>交易者</th>
                                <th>交易</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map(t => (
                                <tr key={t.txHash}>
                                    <td className="mono c-muted">{new Date(t.timestamp).toLocaleString('zh-CN')}</td>
                                    <td>
                                        <span className={`dir-dot ${t.direction === 'BUY' ? 'buy' : 'sell'}`} />
                                        <span className={t.direction === 'BUY' ? 'c-green' : 'c-red'}>{t.direction === 'BUY' ? '买入' : '卖出'}</span>
                                    </td>
                                    <td className="mono">{fmtV(t.amountVirtual)}</td>
                                    <td>
                                        <a href={`https://basescan.org/address/${t.trader}`} target="_blank" rel="noopener noreferrer" className="link">
                                            {short(t.trader)}
                                        </a>
                                    </td>
                                    <td>
                                        <a href={`https://basescan.org/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer" className="link">
                                            {short(t.txHash)}
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function UpcomingView({ launches }: { launches: UpcomingLaunch[] }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 10000);
        return () => clearInterval(id);
    }, []);
    return (
        <>
            <div className="sec-head">
                <h1 className="sec-title">即将发射</h1>
                <span className="sec-count">{launches.length}</span>
            </div>
            {launches.length === 0 ? (
                <div className="empty"><div className="empty-icon">◌</div><p>暂无即将发射项目</p></div>
            ) : (
                <div className="launch-grid">
                    {launches.map(item => (
                        <div className="launch-card" key={item.id}>
                            <div className="launch-top">
                                <div>
                                    <div className="launch-symbol">${item.symbol}</div>
                                    <div className="launch-name">{item.name}</div>
                                </div>
                                <span className={`pill ${item.source === '60_days' ? 'pill-amber' : 'pill-green'}`}>
                                    {item.source === '60_days' ? '60天' : 'Unicorn'}
                                </span>
                            </div>
                            <div className="launch-row">
                                <span className="launch-row-label">发射倒计时</span>
                                <span className="launch-row-value c-accent">{countdown(item.launchedAt)}</span>
                            </div>
                            {(item.liquidityUsd != null && item.liquidityUsd > 0) || (item.mcapInVirtual != null && item.mcapInVirtual > 0) ? (
                                <div className="launch-row">
                                    <span className="launch-row-label">市值</span>
                                    <span className="launch-row-value">
                                        {item.liquidityUsd != null && item.liquidityUsd > 0
                                            ? `$${item.liquidityUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                            : item.mcapInVirtual != null && item.mcapInVirtual > 0
                                                ? `${item.mcapInVirtual.toLocaleString(undefined, { maximumFractionDigits: 0 })} V`
                                                : '—'}
                                    </span>
                                </div>
                            ) : null}
                            <div className="launch-row">
                                <span className="launch-row-label">状态</span>
                                <span className={`pill ${item.status === 'INITIALIZED' ? 'pill-neutral' : 'pill-amber'}`}>
                                    {item.status === 'INITIALIZED' ? '待启动' : item.status === 'UNDERGRAD' ? '预热中' : item.status}
                                </span>
                            </div>
                            <div className="launch-row">
                                <span className="launch-row-label">创建时间</span>
                                <span className="launch-row-value">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                            </div>
                            {item.preTokenPair && (
                                <div className="launch-row">
                                    <span className="launch-row-label">池地址</span>
                                    <span className="launch-row-value c-accent">{short(item.preTokenPair)}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

function SettingsView({ health }: { health: RpcHealth | null }) {
    return (
        <>
            <div className="sec-head">
                <h1 className="sec-title">设置</h1>
            </div>

            <div className="settings-block">
                <div className="settings-title">RPC 连接</div>
                <div className="settings-row">
                    <span className="settings-label">HTTP</span>
                    <span className="settings-val">{health?.http.current || '—'}</span>
                    <span className="settings-status">
                        <span className={`pill ${health?.http.healthy ? 'pill-green' : 'pill-red'}`}>
                            {health?.http.healthy ? '正常' : '异常'}
                        </span>
                    </span>
                </div>
                <div className="settings-row">
                    <span className="settings-label">WSS</span>
                    <span className="settings-val">{health?.wss.current || '—'}</span>
                    <span className="settings-status">
                        <span className={`pill ${health?.wss.connected ? 'pill-green' : 'pill-red'}`}>
                            {health?.wss.connected ? '已连接' : '未连接'}
                        </span>
                    </span>
                </div>
            </div>

            <div className="settings-block">
                <div className="settings-title">关于</div>
                <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.8 }}>
                    Virtuals Launch Watcher v1.0<br />
                    Base 链打新监控
                </p>
            </div>
        </>
    );
}
