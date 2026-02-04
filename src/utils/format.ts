/**
 * 格式化工具
 * 用于数值和地址的显示格式化
 */

import { ethers } from 'ethers';

/**
 * 格式化 VIRTUAL 数量
 */
export function formatVirtual(value: bigint, decimals: number = 2): string {
    const num = parseFloat(ethers.formatEther(value));
    return num.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
}

/**
 * 缩写地址
 */
export function shortenAddress(address: string, chars: number = 4): string {
    if (!address || address.length < chars * 2 + 2) {
        return address;
    }
    return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/**
 * 格式化时间差
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }
    if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, decimals: number = 1): string {
    return `${value.toFixed(decimals)}%`;
}

/**
 * 格式化 ETA
 */
export function formatEta(hours: number): string {
    if (!isFinite(hours)) {
        return '∞';
    }
    if (hours < 1) {
        return `${Math.round(hours * 60)}m`;
    }
    if (hours < 24) {
        return `${hours.toFixed(1)}h`;
    }
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
}

/**
 * 格式化大数字（如 1.5K, 2.3M）
 */
export function formatCompact(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toLocaleString();
}

/**
 * 安全解析 JSON
 */
export function safeJsonParse<T>(json: string, defaultValue: T): T {
    try {
        return JSON.parse(json) as T;
    } catch {
        return defaultValue;
    }
}
