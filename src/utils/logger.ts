/**
 * 结构化日志模块
 * 支持懒初始化和上下文管理
 */

import { State, LogLevel, LogEntry } from '../types.js';

const LOG_LEVELS: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

interface LoggerConfig {
    level: LogLevel;
}

class Logger {
    private minLevel: number = 1; // 默认 INFO
    private currentState: State = State.DISCOVER;
    private currentProjectId: number | null = null;
    private currentProjectSymbol: string | null = null;
    private initialized: boolean = false;

    /**
     * 初始化日志配置（懒加载）
     */
    init(config: LoggerConfig): void {
        this.minLevel = LOG_LEVELS[config.level.toUpperCase() as LogLevel] ?? 1;
        this.initialized = true;
    }

    /**
     * 设置上下文（状态机状态和当前项目）
     */
    setContext(state: State, projectId: number | null, projectSymbol: string | null): void {
        this.currentState = state;
        this.currentProjectId = projectId;
        this.currentProjectSymbol = projectSymbol;
    }

    /**
     * 核心日志方法
     */
    private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        if (LOG_LEVELS[level] < this.minLevel) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            state: this.currentState,
            projectId: this.currentProjectId,
            projectSymbol: this.currentProjectSymbol,
            message,
            data,
        };

        const output = JSON.stringify(entry);

        // 根据级别使用不同的输出
        switch (level) {
            case 'ERROR':
                console.error(output);
                break;
            case 'WARN':
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }

    debug(message: string, data?: Record<string, unknown>): void {
        this.log('DEBUG', message, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.log('INFO', message, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.log('WARN', message, data);
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.log('ERROR', message, data);
    }

    /**
     * 包装 Error 对象的便捷方法
     */
    logError(message: string, error: unknown, extra?: Record<string, unknown>): void {
        const errorData: Record<string, unknown> = {
            ...extra,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
        };
        this.error(message, errorData);
    }

    /**
     * 计时日志（用于性能监控）
     */
    time(label: string): () => void {
        const start = performance.now();
        return () => {
            const duration = performance.now() - start;
            this.debug(`${label} completed`, { durationMs: Math.round(duration) });
        };
    }
}

// 导出单例
export const logger = new Logger();
