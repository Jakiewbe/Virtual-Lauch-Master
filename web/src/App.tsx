/**
 * Virtuals Launch Watcher - Dashboard
 */

import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks';
import { getState, getTrades, getHealth } from './api';
import type { ApiState, Trade, RpcHealth } from './types';

// 格式化 VIRTUAL 数量
function formatVirtual(value: string): string {
    const num = parseFloat(value) / 1e18;
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// 格式化地址
function shortenAddress(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// 格式化时间
function formatTime(minutes: number): string {
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
}

// 状态颜色
function getStateColor(state: string): string {
    switch (state) {
        case 'LAUNCH_WINDOW': return 'active';
        case 'BUYBACK_PHASE': return 'active';
        case 'DISCOVER': return 'waiting';
        case 'WAIT_T0': return 'waiting';
        default: return 'idle';
    }
}

// 状态中文
function getStateLabel(state: string): string {
    switch (state) {
        case 'DISCOVER': return '发现项目';
        case 'WAIT_T0': return '等待开盘';
        case 'LAUNCH_WINDOW': return '税收窗口';
        case 'BUYBACK_PHASE': return '回购阶段';
        case 'DONE': return '已完成';
        default: return state;
    }
}

export default function App() {
    const { isConnected, state: wsState, reconnect } = useWebSocket();
    const [state, setState] = useState<ApiState | null>(null);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [health, setHealth] = useState<RpcHealth | null>(null);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'trades' | 'settings'>('dashboard');

    // 初始加载
    useEffect(() => {
        async function load() {
            try {
                const [stateData, tradesData, healthData] = await Promise.all([
                    getState(),
                    getTrades(),
                    getHealth(),
                ]);
                setState(stateData);
                setTrades(tradesData);
                setHealth(healthData);
            } catch (e) {
                console.error('Failed to load initial data', e);
            }
        }
        load();
    }, []);

    // WebSocket 更新
    useEffect(() => {
        if (wsState) {
            setState(wsState);
        }
    }, [wsState]);

    // 定期刷新
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const tradesData = await getTrades();
                setTrades(tradesData);
            } catch (e) {
                console.error('Failed to refresh trades', e);
            }
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="app">
            {/* 侧边栏 */}
            <aside className="sidebar">
                <div className="sidebar-logo">
                    <div className="logo-icon">🚀</div>
                    <span className="logo-text">Virtuals Watcher</span>
                </div>

                <ul className="nav-menu">
                    <li className="nav-item">
                        <a
                            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setActiveTab('dashboard')}
                        >
                            📊 仪表盘
                        </a>
                    </li>
                    <li className="nav-item">
                        <a
                            className={`nav-link ${activeTab === 'trades' ? 'active' : ''}`}
                            onClick={() => setActiveTab('trades')}
                        >
                            🐋 交易记录
                        </a>
                    </li>
                    <li className="nav-item">
                        <a
                            className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('settings')}
                        >
                            ⚙️ 设置
                        </a>
                    </li>
                </ul>

                <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    <span className={`status-dot ${isConnected ? 'active' : 'idle'}`}></span>
                    <span>{isConnected ? '已连接' : '已断开'}</span>
                    {!isConnected && (
                        <button className="btn btn-secondary" onClick={reconnect} style={{ marginLeft: 'auto', padding: '4px 8px' }}>
                            重连
                        </button>
                    )}
                </div>
            </aside>

            {/* 主内容 */}
            <main className="main-content">
                {activeTab === 'dashboard' && (
                    <Dashboard state={state} health={health} trades={trades} />
                )}
                {activeTab === 'trades' && (
                    <TradesTable trades={trades} />
                )}
                {activeTab === 'settings' && (
                    <Settings health={health} />
                )}
            </main>
        </div>
    );
}

// 仪表盘组件
function Dashboard({ state, health, trades }: { state: ApiState | null; health: RpcHealth | null; trades: Trade[] }) {
    if (!state) {
        return (
            <div className="empty-state">
                <div className="empty-icon">⏳</div>
                <p>正在加载数据...</p>
            </div>
        );
    }

    const taxProgress = state.tax
        ? Math.min(100, (state.elapsedMinutes / 100) * 100)
        : 0;

    const buybackProgress = state.buyback?.progress || 0;

    return (
        <>
            <header className="header">
                <h1 className="page-title">监控仪表盘</h1>
                <div className="status-badge">
                    <span className={`status-dot ${getStateColor(state.state)}`}></span>
                    {getStateLabel(state.state)}
                </div>
            </header>

            {/* 项目信息 */}
            {state.project && (
                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header">
                        <span className="card-title">当前项目</span>
                        <span className="card-icon blue">📌</span>
                    </div>
                    <div className="card-value">${state.project.symbol}</div>
                    <div className="card-subtitle">{state.project.name}</div>
                </div>
            )}

            {/* 统计卡片 */}
            <div className="cards-grid">
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">税收窗口</span>
                        <span className="card-icon orange">🧾</span>
                    </div>
                    <div className="card-value">
                        {state.tax ? formatVirtual(state.tax.netInflow) : '—'}
                    </div>
                    <div className="card-subtitle">
                        {state.t0 ? `${formatTime(state.elapsedMinutes)} / 100m` : '等待开始'}
                    </div>
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${taxProgress}%` }}></div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-title">回购进度</span>
                        <span className="card-icon purple">🔁</span>
                    </div>
                    <div className="card-value">
                        {state.buyback ? `${buybackProgress.toFixed(1)}%` : '—'}
                    </div>
                    <div className="card-subtitle">
                        {state.buyback
                            ? `ETA: ${state.buyback.etaHours === Infinity ? '∞' : `${state.buyback.etaHours.toFixed(1)}h`}`
                            : '等待税收窗口结束'
                        }
                    </div>
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${buybackProgress}%` }}></div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-title">大额交易</span>
                        <span className="card-icon green">🐋</span>
                    </div>
                    <div className="card-value">{trades.length}</div>
                    <div className="card-subtitle">
                        {trades.length > 0
                            ? `最近: ${trades[0].direction === 'BUY' ? '买入' : '卖出'} ${formatVirtual(trades[0].amountVirtual)}`
                            : '暂无记录'
                        }
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-title">RPC 状态</span>
                        <span className="card-icon blue">🌐</span>
                    </div>
                    <div className="card-value">
                        {health?.http.healthy ? '正常' : '异常'}
                    </div>
                    <div className="card-subtitle">
                        延迟: {health?.http.latencyMs || '—'}ms
                    </div>
                </div>
            </div>

            {/* 最近交易 */}
            {trades.length > 0 && (
                <div className="table-container">
                    <div className="table-header">
                        <h3 className="table-title">最近大额交易</h3>
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
                            {trades.slice(0, 5).map((trade) => (
                                <tr key={trade.txHash}>
                                    <td className={trade.direction === 'BUY' ? 'trade-buy' : 'trade-sell'}>
                                        {trade.direction === 'BUY' ? '🟢 买入' : '🔴 卖出'}
                                    </td>
                                    <td>{formatVirtual(trade.amountVirtual)} VIRTUAL</td>
                                    <td>
                                        <a
                                            href={`https://basescan.org/address/${trade.trader}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="tx-link"
                                        >
                                            {shortenAddress(trade.trader)}
                                        </a>
                                    </td>
                                    <td>
                                        <a
                                            href={`https://basescan.org/tx/${trade.txHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="tx-link"
                                        >
                                            {trade.blockNumber}
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

// 交易记录表格
function TradesTable({ trades }: { trades: Trade[] }) {
    return (
        <>
            <header className="header">
                <h1 className="page-title">交易记录</h1>
                <div className="status-badge">共 {trades.length} 条</div>
            </header>

            {trades.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">🐋</div>
                    <p>暂无大额交易记录</p>
                </div>
            ) : (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>时间</th>
                                <th>方向</th>
                                <th>数量</th>
                                <th>交易者</th>
                                <th>交易哈希</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map((trade) => (
                                <tr key={trade.txHash}>
                                    <td>{new Date(trade.timestamp).toLocaleString()}</td>
                                    <td className={trade.direction === 'BUY' ? 'trade-buy' : 'trade-sell'}>
                                        {trade.direction === 'BUY' ? '🟢 买入' : '🔴 卖出'}
                                    </td>
                                    <td>{formatVirtual(trade.amountVirtual)} VIRTUAL</td>
                                    <td>
                                        <a
                                            href={`https://basescan.org/address/${trade.trader}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="tx-link"
                                        >
                                            {shortenAddress(trade.trader)}
                                        </a>
                                    </td>
                                    <td>
                                        <a
                                            href={`https://basescan.org/tx/${trade.txHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="tx-link"
                                        >
                                            {shortenAddress(trade.txHash)}
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

// 设置页面
function Settings({ health }: { health: RpcHealth | null }) {
    return (
        <>
            <header className="header">
                <h1 className="page-title">设置</h1>
            </header>

            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header">
                    <span className="card-title">RPC 连接状态</span>
                </div>
                <table style={{ width: '100%' }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: '12px 0', color: 'var(--text-muted)' }}>HTTP</td>
                            <td style={{ padding: '12px 0' }}>
                                {health?.http.current || '—'}
                            </td>
                            <td style={{ padding: '12px 0', textAlign: 'right' }}>
                                <span style={{ color: health?.http.healthy ? 'var(--success)' : 'var(--danger)' }}>
                                    {health?.http.healthy ? '✓ 正常' : '✗ 异常'}
                                </span>
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: '12px 0', color: 'var(--text-muted)' }}>WSS</td>
                            <td style={{ padding: '12px 0' }}>
                                {health?.wss.current || '—'}
                            </td>
                            <td style={{ padding: '12px 0', textAlign: 'right' }}>
                                <span style={{ color: health?.wss.connected ? 'var(--success)' : 'var(--danger)' }}>
                                    {health?.wss.connected ? '✓ 已连接' : '✗ 未连接'}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">关于</span>
                </div>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Virtuals Launch Watcher v1.0.0<br />
                    Base 链上 Virtuals 项目的打新监控器<br /><br />
                    功能：大额交易监控 | 税收统计 | 回购 ETA
                </p>
            </div>
        </>
    );
}
