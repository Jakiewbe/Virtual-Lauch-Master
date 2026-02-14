/**
 * 合约 ABI 常量
 * 统一管理所有合约接口
 */

// ERC20 基础 ABI
export const ERC20_ABI = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
] as const;

// Uniswap V2 Pair ABI
export const UNISWAP_V2_PAIR_ABI = [
    'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Mint(address indexed sender, uint amount0, uint amount1)',
    'event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function price0CumulativeLast() view returns (uint)',
    'function price1CumulativeLast() view returns (uint)',
    'function kLast() view returns (uint)',
] as const;

// Uniswap V2 Factory ABI
export const UNISWAP_V2_FACTORY_ABI = [
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
    'function getPair(address tokenA, address tokenB) view returns (address pair)',
    'function allPairs(uint) view returns (address pair)',
    'function allPairsLength() view returns (uint)',
] as const;

// Virtuals Curve Pool ABI (简化版，含备用方法名)
export const VIRTUALS_CURVE_ABI = [
    'event Trade(address indexed trader, uint256 amountIn, uint256 amountOut, bool isBuy)',
    'function buy(uint256 tokenAmount) payable',
    'function sell(uint256 tokenAmount)',
    'function getTokenPrice() view returns (uint256)',
    'function getPrice() view returns (uint256)',
    'function token() view returns (address)',
    'function agentToken() view returns (address)',
] as const;

// 常用地址
export const ADDRESSES = {
    // Base 链
    BASE: {
        VIRTUAL_TOKEN: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
        BUYBACK_ADDR: '0x32487287c65f11d53bbCa89c2472171eB09bf337',
        WETH: '0x4200000000000000000000000000000000000006',
        UNISWAP_V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    },
} as const;

// 事件签名 (Topic0)
export const EVENT_TOPICS = {
    // ERC20 Transfer: Transfer(address,address,uint256)
    ERC20_TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    // Uniswap V2 Swap: Swap(address,uint256,uint256,uint256,uint256,address)
    UNISWAP_V2_SWAP: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
} as const;
