# Virtual-Lauch-Master 项目上下文（压缩版）

## 项目定位
Base 链上 Virtuals 协议的单项目打新监控器：发现当前在打的 UNDERGRAD 项目 → 税收窗口统计 BUYBACK 净流入 → 回购阶段监控 → 链上实测 FDV + 官网估值降级。

## 技术栈
- 后端：Node + TypeScript、ethers、Virtuals API、RPC 池、状态机、ApiServer(HTTP+WS)
- 前端：React、WebSocket 拉 state、仪表盘/交易记录/即将发射/设置

## 核心逻辑（简要）
1. **发现**：`virtuals-api` 拉 `createdAt:desc` / `launchedAt:desc`，客户端 `selectProject()` 只选 UNDERGRAD、有 `preTokenPair`、无 `lpAddress`；优先 ORION(symbol)；T0 = launchedAt ?? lpCreatedAt ?? createdAt；税收窗口内按 T0 取最近开打。
2. **状态机**：DISCOVER → WAIT_T0 → LAUNCH_WINDOW(100min) → BUYBACK_PHASE → DONE。LAUNCH_WINDOW 每 5min 更新税收；每 60s 校验项目是否毕业，毕业则 DONE 并重新发现。
3. **净流入**：TaxTracker 从 T0 区块扫 VIRTUAL Transfer 进出 BUYBACK，累加 inflow/outflow → netInflow。晚接入：init(t0) 用 timeToBlock+balanceOf(blockTag)，首轮税收更新时若落后>2000 块则循环 update 追上；init 历史区块失败则 startBalance=0n。
4. **链上 FDV**：fdv-calculator 用 preTokenPair 曲线 getTokenPrice/getPrice、token/agentToken、totalSupply → fdvInVirtual；乘 CoinGecko VIRTUAL/USD → fdvUsd。链上失败则用 API mcapInVirtual×VIRTUAL 单价 → apiFdvUsd，前端标「官网估值」。
5. **回购**：BuybackTracker 用 taxTotal 作预算，链上统计回购支出，ratePerHour、lastTxAmount、etaHours；结束时间 = T1 + etaHours。
6. **即将发射**：getUpcomingLaunches 并行拉 VIBES_BONDING_V2(60d) + BONDING_V4(unicorn)，过滤 INITIALIZED/UNDERGRAD、preTokenPair 非空、lpCreatedAt 空，createdAt desc；/api/upcoming-launches 返回精简名单；前端 Tab 列表+刷新。

## 关键文件
- `src/providers/virtuals-api.ts`：API 封装、selectProject、discoverProject、getUpcomingLaunches
- `src/state-machine.ts`：状态机、LAUNCH_WINDOW 税收+FDV+毕业校验
- `src/services/fdv-calculator.ts`：getVirtualPriceUsd、getTokenFromCurve、computeCurveFdv
- `src/monitors/tax-tracker.ts`：init(t0)、update()、getProgress、首轮追上逻辑
- `src/providers/api-server.ts`：updateContext、updateOnchainFdv、updateApiFdv、getStateSnapshot、/api/state、/api/upcoming-launches
- `web/src/App.tsx`：仪表盘(链上/API 市值、税率、税后可得、打新数据、回购)、即将发射、交易记录

## 配置与运行
- 配置：`config/default.yaml`（RPC、Virtuals API、BUYBACK 地址、税收窗口 100min 等）
- 后端：`pnpm run dev` 或 `pnpm start`；API 默认 4000，健康 4001
- 前端：`cd web && pnpm run dev`
- Telegram 可选；无则跳过通知

## 已知约束
- Virtuals API 的 status 过滤无效，筛选在客户端做。
- 链上 FDV 依赖曲线合约 ABI（getTokenPrice/token 等），若合约接口不同需改 abi.ts/fdv-calculator。
- RPC 异常时仪表盘会显示「异常」、链上市值可能一直「获取中」；可依赖 API 市值降级。
