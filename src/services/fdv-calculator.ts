import { ethers } from 'ethers';
import { getRpcPool } from '../providers/rpc-pool.js';
import { getConfig } from '../config.js';
import { logger } from '../utils/index.js';
import { VIRTUALS_CURVE_ABI, ERC20_ABI } from '../constants/abi.js';

const VIRTUAL_COINGECKO_ID = 'virtual-protocol';
const VIRTUAL_PRICE_CACHE_MS = 10_000;
let virtualPriceUsdCache: { value: number; ts: number } | null = null;

export interface CurveFdvResult {
    fdvInVirtual: string;
    fdvUsd: string | null;
}

export async function getVirtualPriceUsd(): Promise<number | null> {
    const now = Date.now();
    if (virtualPriceUsdCache && now - virtualPriceUsdCache.ts < VIRTUAL_PRICE_CACHE_MS) {
        return virtualPriceUsdCache.value;
    }
    try {
        const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${VIRTUAL_COINGECKO_ID}&vs_currencies=usd`,
            { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, { usd?: number }>;
        const usd = data[VIRTUAL_COINGECKO_ID]?.usd;
        if (usd == null || usd <= 0) return null;
        virtualPriceUsdCache = { value: usd, ts: now };
        return usd;
    } catch (e) {
        logger.debug('getVirtualPriceUsd failed', { error: String(e) });
        return virtualPriceUsdCache?.value ?? null;
    }
}

export async function getTokenFromCurve(curveAddress: string): Promise<string | null> {
    const provider = getRpcPool().getHttpProvider();
    const curve = new ethers.Contract(curveAddress, VIRTUALS_CURVE_ABI, provider);
    for (const method of ['token', 'agentToken']) {
        try {
            const addr = (await (curve as Record<string, () => Promise<string>>)[method]()) as string;
            if (addr && addr !== ethers.ZeroAddress) return addr;
        } catch {
            continue;
        }
    }
    return null;
}

export async function computeCurveFdv(
    curveAddress: string,
    tokenAddress: string | null
): Promise<CurveFdvResult | null> {
    const provider = getRpcPool().getHttpProvider();
    let tokenAddr = tokenAddress;
    if (!tokenAddr) {
        tokenAddr = await getTokenFromCurve(curveAddress);
        if (!tokenAddr) {
            logger.debug('computeCurveFdv: no token address (API and curve.token() both null)');
            return null;
        }
    }
    try {
        const curve = new ethers.Contract(curveAddress, VIRTUALS_CURVE_ABI, provider);
        const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        let priceWei: bigint;
        try {
            priceWei = await curve.getTokenPrice() as bigint;
        } catch {
            priceWei = await (curve as { getPrice: () => Promise<bigint> }).getPrice();
        }
        const supplyWei = await token.totalSupply() as bigint;
        const fdvWei = (priceWei * supplyWei) / (10n ** 18n);
        const fdvInVirtual = ethers.formatEther(fdvWei);

        const usdPerVirtual = await getVirtualPriceUsd();
        let fdvUsd: string | null = null;
        if (usdPerVirtual != null && usdPerVirtual > 0) {
            const fdvNum = Number(fdvInVirtual);
            fdvUsd = (fdvNum * usdPerVirtual).toFixed(2);
        }

        return { fdvInVirtual, fdvUsd };
    } catch (e) {
        logger.warn('computeCurveFdv failed', {
            curveAddress,
            tokenAddress: tokenAddr,
            error: String(e),
        });
        return null;
    }
}
