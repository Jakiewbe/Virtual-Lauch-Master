/**
 * 重试工具
 * 支持指数退避和自定义策略
 */

import { logger } from './logger.js';
import { sleep } from './sleep.js';

export interface RetryOptions {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
};

/**
 * 带重试的异步函数执行
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: unknown;
    let delay = opts.initialDelayMs;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // 检查是否应该重试
            if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) {
                throw error;
            }

            // 最后一次尝试失败，不再重试
            if (attempt >= opts.maxAttempts) {
                throw error;
            }

            // 触发重试回调
            if (opts.onRetry) {
                opts.onRetry(error, attempt, delay);
            } else {
                logger.warn('Operation failed, retrying', {
                    attempt,
                    maxAttempts: opts.maxAttempts,
                    delayMs: delay,
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            // 等待后重试
            await sleep(delay);

            // 指数退避
            delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
        }
    }

    throw lastError;
}

/**
 * 创建带超时的 Promise
 */
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string = 'Operation timed out'
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);

        promise
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

/**
 * 并行执行多个 Promise，返回第一个成功的结果
 */
export async function raceToSuccess<T>(
    promises: Array<() => Promise<T>>,
    errorMessage: string = 'All operations failed'
): Promise<T> {
    const errors: unknown[] = [];

    for (const promiseFn of promises) {
        try {
            return await promiseFn();
        } catch (error) {
            errors.push(error);
        }
    }

    throw new AggregateError(errors, errorMessage);
}
