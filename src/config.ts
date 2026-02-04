/**
 * 配置加载模块
 * 支持 yaml 文件 + 环境变量覆盖 + 默认值
 */

import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import type { Config } from './types.js';

const CONFIG_PATH = process.env.CONFIG_PATH || './config.yaml';

// 默认配置
const DEFAULT_CONFIG: Partial<Config> = {
    chain: {
        name: 'base',
        chainId: 8453,
        rpc: {
            http: ['https://mainnet.base.org'],
            wss: ['wss://base.publicnode.com'],
        },
    },
    virtuals: {
        apiBase: 'https://api.virtuals.io',
        pollIntervalMs: 5000,
        maxProjectAgeMinutes: 10,
    },
    addresses: {
        buybackAddr: '0x32487287c65f11d53bbCa89c2472171eB09bf337',
        virtualToken: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    },
    thresholds: {
        bigTradeVirtual: 1000,
        taxWindowMinutes: 100,
        buybackRateWindowMinutes: 20,
        stallAlertMinutes: 5,
    },
    logging: {
        level: 'info',
    },
};

/**
 * 替换字符串中的环境变量占位符
 * 格式: ${ENV_VAR_NAME}
 */
function replaceEnvVars(value: string): string {
    return value.replace(/\$\{(\w+)\}/g, (_, envVar) => {
        const envValue = process.env[envVar];
        if (!envValue) {
            throw new Error(`Environment variable ${envVar} is not set`);
        }
        return envValue;
    });
}

/**
 * 递归处理对象中的环境变量
 */
function processEnvVars(obj: unknown): unknown {
    if (typeof obj === 'string') {
        return replaceEnvVars(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(processEnvVars);
    }
    if (obj !== null && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = processEnvVars(value);
        }
        return result;
    }
    return obj;
}

/**
 * 深度合并对象
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key of Object.keys(source) as Array<keyof T>) {
        const sourceValue = source[key];
        const targetValue = target[key];

        if (
            sourceValue !== undefined &&
            typeof sourceValue === 'object' &&
            sourceValue !== null &&
            !Array.isArray(sourceValue) &&
            typeof targetValue === 'object' &&
            targetValue !== null &&
            !Array.isArray(targetValue)
        ) {
            result[key] = deepMerge(
                targetValue as Record<string, unknown>,
                sourceValue as Record<string, unknown>
            ) as T[keyof T];
        } else if (sourceValue !== undefined) {
            result[key] = sourceValue as T[keyof T];
        }
    }

    return result;
}

/**
 * 加载并验证配置
 */
export function loadConfig(): Config {
    let parsed: Record<string, unknown> = {};

    if (existsSync(CONFIG_PATH)) {
        const rawContent = readFileSync(CONFIG_PATH, 'utf-8');
        parsed = parse(rawContent) as Record<string, unknown>;
    } else {
        console.warn(`Config file not found: ${CONFIG_PATH}, using defaults`);
    }

    // 合并默认配置
    const merged = deepMerge(DEFAULT_CONFIG as Record<string, unknown>, parsed);

    // 处理环境变量
    const config = processEnvVars(merged) as Config;

    // 验证必填字段
    validateConfig(config);

    // 缓存配置
    configInstance = config;

    return config;
}

/**
 * 验证配置完整性
 */
function validateConfig(config: Config): void {
    const required = [
        ['chain.rpc.http', config.chain?.rpc?.http],
        ['chain.rpc.wss', config.chain?.rpc?.wss],
        ['virtuals.apiBase', config.virtuals?.apiBase],
        ['addresses.buybackAddr', config.addresses?.buybackAddr],
        ['addresses.virtualToken', config.addresses?.virtualToken],
        ['telegram.botToken', config.telegram?.botToken],
        ['telegram.chatId', config.telegram?.chatId],
    ];

    for (const [path, value] of required) {
        if (!value || (Array.isArray(value) && value.length === 0)) {
            throw new Error(`Missing required config: ${path}`);
        }
    }

    // 验证地址格式
    const addressPattern = /^0x[a-fA-F0-9]{40}$/;
    if (!addressPattern.test(config.addresses.buybackAddr)) {
        throw new Error('Invalid buybackAddr format');
    }
    if (!addressPattern.test(config.addresses.virtualToken)) {
        throw new Error('Invalid virtualToken format');
    }
}

// 导出单例配置
let configInstance: Config | null = null;

export function getConfig(): Config {
    if (!configInstance) {
        configInstance = loadConfig();
    }
    return configInstance;
}

/**
 * 重置配置（用于测试）
 */
export function resetConfig(): void {
    configInstance = null;
}
