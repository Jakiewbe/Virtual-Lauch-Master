/**
 * Virtuals Launch Watcher - 入口文件
 * 
 * 单项目打新监控器：
 * - 大额交易告警
 * - 税收统计
 * - 回购 ETA 追踪
 * - Web 仪表盘
 */

import { loadConfig, getConfig } from './config.js';
import { logger } from './utils/index.js';
import { getRpcPool, getHealthServer, getApiServer, resetRpcPool } from './providers/index.js';
import { getTelegramNotifier } from './notifiers/index.js';
import { StateMachine } from './state-machine.js';
import { State } from './types.js';

async function main(): Promise<void> {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   Virtuals Launch Watcher v1.0.0           ║');
    console.log('║   Base Chain Monitor + Web Dashboard       ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');

    // 加载配置
    try {
        loadConfig();
        const config = getConfig();

        // 初始化日志
        logger.init({ level: config.logging.level.toUpperCase() as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' });
        logger.setContext(State.DISCOVER, null, null);
        logger.info('Configuration loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load configuration:', error instanceof Error ? error.message : error);
        process.exit(1);
    }

    // 初始化 RPC 连接池
    try {
        const rpcPool = getRpcPool();

        // 选择最快的 RPC
        logger.info('Testing RPC endpoints...');
        await rpcPool.selectFastest();

        logger.info('RPC pool initialized');
    } catch (error) {
        logger.error('Failed to initialize RPC pool', {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }

    // 测试 Telegram 连接
    try {
        const notifier = getTelegramNotifier();
        const telegramOk = await notifier.testConnection();

        if (telegramOk) {
            logger.info('Telegram connection verified');
        } else {
            logger.warn('Telegram connection test failed, notifications may not work');
        }
    } catch (error) {
        logger.warn('Telegram test error', {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    // 启动健康检查服务器
    const healthPort = parseInt(process.env.HEALTH_PORT || '3000', 10);
    const healthServer = getHealthServer(healthPort);
    healthServer.start();

    // 启动 API 服务器（前端用）
    const apiPort = parseInt(process.env.API_PORT || '4000', 10);
    const apiServer = getApiServer(apiPort);
    apiServer.start();

    // 创建状态机
    const stateMachine = new StateMachine();

    // 优雅退出处理
    let isShuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
        if (isShuttingDown) {
            logger.warn('Shutdown already in progress');
            return;
        }
        isShuttingDown = true;

        logger.info('Shutdown signal received', { signal });

        // 停止状态机
        stateMachine.stop();

        // 等待清理
        logger.info('Waiting for cleanup...');
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 停止服务器
        await healthServer.stop();
        await apiServer.stop();

        // 关闭 RPC 连接
        resetRpcPool();

        logger.info('Shutdown complete');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // 未捕获异常处理
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', {
            error: error.message,
            stack: error.stack,
        });

        // 尝试发送错误通知
        const notifier = getTelegramNotifier();
        notifier.sendError('Uncaught Exception', error.message).catch(() => { });

        // 延迟退出，给日志和通知时间
        setTimeout(() => process.exit(1), 1000);
    });

    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled rejection', {
            reason: String(reason),
        });
    });

    // 启动状态机
    logger.info('Starting state machine...');
    console.log('');
    console.log(`📊 Web Dashboard: http://localhost:${apiPort}`);
    console.log(`🏥 Health Check:  http://localhost:${healthPort}/health`);
    console.log('');

    try {
        await stateMachine.start();
    } catch (error) {
        logger.error('State machine fatal error', {
            error: error instanceof Error ? error.message : String(error),
        });
        await shutdown('ERROR');
    }
}

// 启动
main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
