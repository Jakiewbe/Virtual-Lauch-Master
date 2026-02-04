/**
 * 时间 → 区块号 转换工具
 * Base 链平均出块时间约 2 秒
 */

import { ethers } from 'ethers';
import { logger } from './logger.js';

const AVERAGE_BLOCK_TIME_MS = 2000;

/**
 * 将时间戳转换为区块号
 * 使用二分查找精确定位
 */
export async function timeToBlock(
    provider: ethers.Provider,
    timestamp: number
): Promise<number> {
    try {
        const latestBlock = await provider.getBlock('latest');
        if (!latestBlock) {
            throw new Error('Failed to get latest block');
        }

        const latestTime = latestBlock.timestamp * 1000;
        const targetTime = timestamp;

        // 如果目标时间在未来
        if (targetTime >= latestTime) {
            return latestBlock.number;
        }

        // 粗略估算
        const blockDiff = Math.floor((latestTime - targetTime) / AVERAGE_BLOCK_TIME_MS);
        let targetBlockNum = Math.max(0, latestBlock.number - blockDiff);

        // 二分查找精确定位
        let lo = Math.max(0, targetBlockNum - 500);
        let hi = Math.min(latestBlock.number, targetBlockNum + 500);

        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            const block = await provider.getBlock(mid);
            if (!block) {
                logger.warn('Failed to get block during binary search', { blockNumber: mid });
                break;
            }

            if (block.timestamp * 1000 < targetTime) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        logger.debug('Time to block conversion', {
            timestamp: new Date(timestamp).toISOString(),
            blockNumber: lo,
        });

        return lo;
    } catch (error) {
        logger.error('Failed to convert time to block', {
            error: error instanceof Error ? error.message : String(error),
            timestamp,
        });
        throw error;
    }
}

/**
 * 获取区块的时间戳
 */
export async function blockToTime(
    provider: ethers.Provider,
    blockNumber: number
): Promise<number> {
    const block = await provider.getBlock(blockNumber);
    if (!block) {
        throw new Error(`Block ${blockNumber} not found`);
    }
    return block.timestamp * 1000;
}
