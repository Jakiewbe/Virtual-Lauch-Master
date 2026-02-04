/**
 * 自定义错误类型
 * 用于更精确的错误处理
 */

/**
 * 基础应用错误
 */
export class AppError extends Error {
    public readonly code: string;
    public readonly recoverable: boolean;
    public readonly context?: Record<string, unknown>;

    constructor(
        message: string,
        code: string,
        options?: {
            recoverable?: boolean;
            context?: Record<string, unknown>;
            cause?: Error;
        }
    ) {
        super(message, { cause: options?.cause });
        this.name = 'AppError';
        this.code = code;
        this.recoverable = options?.recoverable ?? true;
        this.context = options?.context;
    }
}

/**
 * 配置错误（不可恢复）
 */
export class ConfigError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'CONFIG_ERROR', { recoverable: false, context });
        this.name = 'ConfigError';
    }
}

/**
 * RPC 连接错误（可恢复）
 */
export class RpcError extends AppError {
    public readonly endpoint: string;

    constructor(message: string, endpoint: string, cause?: Error) {
        super(message, 'RPC_ERROR', { recoverable: true, context: { endpoint }, cause });
        this.name = 'RpcError';
        this.endpoint = endpoint;
    }
}

/**
 * API 请求错误（可恢复）
 */
export class ApiError extends AppError {
    public readonly status: number;
    public readonly url: string;

    constructor(message: string, status: number, url: string) {
        super(message, 'API_ERROR', { recoverable: true, context: { status, url } });
        this.name = 'ApiError';
        this.status = status;
        this.url = url;
    }
}

/**
 * Telegram 推送错误（可恢复）
 */
export class TelegramError extends AppError {
    constructor(message: string, cause?: Error) {
        super(message, 'TELEGRAM_ERROR', { recoverable: true, cause });
        this.name = 'TelegramError';
    }
}

/**
 * 判断错误是否可恢复
 */
export function isRecoverable(error: unknown): boolean {
    if (error instanceof AppError) {
        return error.recoverable;
    }
    // 未知错误默认尝试恢复
    return true;
}

/**
 * 安全地提取错误信息
 */
export function extractErrorInfo(error: unknown): {
    message: string;
    code: string;
    stack?: string;
    context?: Record<string, unknown>;
} {
    if (error instanceof AppError) {
        return {
            message: error.message,
            code: error.code,
            stack: error.stack,
            context: error.context,
        };
    }

    if (error instanceof Error) {
        return {
            message: error.message,
            code: 'UNKNOWN_ERROR',
            stack: error.stack,
        };
    }

    return {
        message: String(error),
        code: 'UNKNOWN_ERROR',
    };
}
