# 🚀 Virtuals Launch Watcher

<p align="center">
  <strong>Base 链上 Virtuals 项目的智能打新监控器</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-18-61dafb" alt="React">
  <img src="https://img.shields.io/badge/Chain-Base-0052ff" alt="Base">
</p>

---

## 📋 目录

- [功能特性](#-功能特性)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
- [配置说明](#️-配置说明)
- [API 接口](#-api-接口)
- [状态机流程](#-状态机流程)
- [Web 仪表盘](#-web-仪表盘)
- [Docker 部署](#-docker-部署)
- [项目结构](#-项目结构)
- [开发指南](#-开发指南)
- [常见问题](#-常见问题)

---

## ✨ 功能特性

### 核心监控

| 功能 | 描述 |
|------|------|
| 🐋 **大额交易监控** | 实时监控 Uniswap V2 池子，单笔 \|ΔVIRTUAL\| ≥ 1000 即时推送 |
| 🧾 **税收统计** | 开盘 100 分钟内统计 BUYBACK 地址的 VIRTUAL 净流入 |
| 🔁 **回购 ETA** | 基于滑窗速率估算回购完成时间 |
| 📊 **Web 仪表盘** | 实时查看状态、交易记录、进度图表 |

### 技术特性

- **多 RPC 支持** - 自动切换、延迟测试、故障转移
- **自恢复 WebSocket** - 指数退避重连机制
- **结构化日志** - JSON 格式，支持 ELK 栈
- **健康检查** - HTTP 端点，支持 Docker/K8s 探针
- **Telegram 推送** - 实时通知，消息队列，去重机制

---

## 🏗 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Virtuals Launch Watcher                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Virtuals   │    │   Base RPC   │    │   Telegram   │       │
│  │     API      │    │   (HTTP/WSS) │    │     Bot      │       │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     Providers Layer                      │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │    │
│  │  │ Virtuals │  │ RPC Pool │  │ Resilient│  │ Telegram │ │    │
│  │  │   API    │  │          │  │    WS    │  │ Notifier │ │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     State Machine                        │    │
│  │                                                          │    │
│  │   DISCOVER → WAIT_T0 → LAUNCH_WINDOW → BUYBACK → DONE   │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                      Monitors Layer                      │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │    │
│  │  │   Tax    │  │ Buyback  │  │  Whale   │               │    │
│  │  │ Tracker  │  │ Tracker  │  │  Trades  │               │    │
│  │  └──────────┘  └──────────┘  └──────────┘               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                      API Server                          │    │
│  │           REST API + WebSocket (Real-time)               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │               Web Dashboard (Vite + React)               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm (推荐) 或 npm
- Telegram Bot Token（用于推送通知）

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd virtuals-launch-watcher

# 2. 安装后端依赖
pnpm install

# 3. 安装前端依赖
cd web && pnpm install && cd ..

# 4. 复制配置文件
cp config.example.yaml config.yaml

# 5. 编辑配置（设置 RPC 端点等）
# 参考下方配置说明

# 6. 设置环境变量
# Windows (CMD)
set TELEGRAM_BOT_TOKEN=你的Bot Token
set TELEGRAM_CHAT_ID=你的Chat ID

# Windows (PowerShell)
$env:TELEGRAM_BOT_TOKEN = "你的Bot Token"
$env:TELEGRAM_CHAT_ID = "你的Chat ID"

# Linux/macOS
export TELEGRAM_BOT_TOKEN="你的Bot Token"
export TELEGRAM_CHAT_ID="你的Chat ID"

# 7. 启动应用
pnpm run dev:all    # 同时启动后端和前端
```

### 访问地址

| 服务 | 地址 |
|------|------|
| Web 仪表盘 | http://localhost:5173 |
| API 服务 | http://localhost:4000 |
| 健康检查 | http://localhost:3000/health |

---

## ⚙️ 配置说明

配置文件 `config.yaml` 支持环境变量占位符 `${ENV_VAR}`：

```yaml
# 链配置
chain:
  name: base
  chainId: 8453
  rpc:
    http:
      - https://mainnet.base.org           # 公共节点
      - https://base.llamarpc.com          # 备用节点
      - https://base.drpc.org
    wss:
      - wss://base.publicnode.com
      - wss://base.gateway.tenderly.co

# Virtuals API 配置
virtuals:
  apiBase: https://api.virtuals.io
  pollIntervalMs: 5000                     # 轮询间隔
  maxProjectAgeMinutes: 10                 # 最大项目年龄

# 固定地址
addresses:
  buybackAddr: "0x32487287c65f11d53bbCa89c2472171eB09bf337"
  virtualToken: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"

# 阈值配置
thresholds:
  bigTradeVirtual: 1000                    # 大额交易阈值 (VIRTUAL)
  taxWindowMinutes: 100                    # 税收窗口时长
  buybackRateWindowMinutes: 20             # 回购速率滑窗
  stallAlertMinutes: 5                     # 停滞告警阈值

# Telegram 配置（使用环境变量）
telegram:
  botToken: ${TELEGRAM_BOT_TOKEN}
  chatId: ${TELEGRAM_CHAT_ID}

# 日志配置
logging:
  level: info    # debug | info | warn | error
```

### 配置项说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `chain.rpc.http` | HTTP RPC 端点列表，支持多个备用 | Base 公共节点 |
| `chain.rpc.wss` | WSS RPC 端点列表，用于实时事件 | Base 公共节点 |
| `virtuals.pollIntervalMs` | Virtuals API 轮询间隔 | 5000ms |
| `virtuals.maxProjectAgeMinutes` | 项目最大年龄（超过不监控） | 10 分钟 |
| `thresholds.bigTradeVirtual` | 大额交易阈值 | 1000 VIRTUAL |
| `thresholds.taxWindowMinutes` | 税收统计窗口时长 | 100 分钟 |
| `thresholds.buybackRateWindowMinutes` | 回购速率计算滑窗 | 20 分钟 |
| `thresholds.stallAlertMinutes` | 回购停滞告警阈值 | 5 分钟 |

---

## 🔌 API 接口

### REST API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/state` | GET | 获取当前状态（项目、税收、回购） |
| `/api/trades` | GET | 获取大额交易历史 |
| `/api/events` | GET | 获取事件历史 |
| `/api/config` | GET | 获取配置（敏感信息隐藏） |
| `/api/health` | GET | 获取 RPC 健康状态 |

### WebSocket

连接 `ws://localhost:4000` 接收实时事件：

```typescript
// 事件类型
type EventType =
  | 'state_change'      // 状态变化
  | 'whale_trade'       // 大额交易
  | 'tax_update'        // 税收更新
  | 'buyback_update'    // 回购更新
  | 'project_start'     // 项目开始监控
  | 'project_complete'  // 监控完成
  | 'error';            // 错误

// 事件格式
interface Event {
  type: EventType;
  timestamp: string;
  data: unknown;
}
```

### 健康检查

| 端点 | 用途 |
|------|------|
| `GET /health` | 完整健康状态 (JSON) |
| `GET /live` | 存活探针 (K8s liveness) |
| `GET /ready` | 就绪探针 (K8s readiness) |

---

## 🔄 状态机流程

```
┌──────────┐     ┌──────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────┐
│ DISCOVER │────▶│ WAIT_T0  │────▶│ LAUNCH_WINDOW │────▶│ BUYBACK_PHASE│────▶│ DONE │
└──────────┘     └──────────┘     └───────────────┘     └──────────────┘     └──────┘
     │                │                   │                    │                 │
     │                │                   │                    │                 │
     ▼                ▼                   ▼                    ▼                 ▼
  轮询 API        确认 T0            统计税收              追踪回购         发送完成
  发现项目        初始化               大额交易             大额交易         通知
                 监控器                监控                 停滞告警
```

### 状态说明

| 状态 | 描述 | 行为 |
|------|------|------|
| `DISCOVER` | 发现项目 | 轮询 Virtuals API，筛选最新 AVAILABLE 项目 |
| `WAIT_T0` | 等待开盘 | 确认 T0 时间，初始化税收和大额交易监控器 |
| `LAUNCH_WINDOW` | 税收窗口 [T0, T1] | 统计 BUYBACK 地址净流入，监控大额交易 |
| `BUYBACK_PHASE` | 回购阶段 [T1, ∞) | 追踪回购花费速率，估算 ETA |
| `DONE` | 完成 | 发送完成通知，重置状态，发现下一个项目 |

---

## 📊 Web 仪表盘

### 功能页面

| 页面 | 功能 |
|------|------|
| 📊 **仪表盘** | 当前状态、项目信息、税收/回购进度条、最近 5 笔交易 |
| 🐋 **交易记录** | 完整的大额交易历史表格，支持时间、方向、数量筛选 |
| ⚙️ **设置** | RPC 连接状态、健康检查信息、版本信息 |

### 技术栈

- **构建工具**: Vite 5
- **UI 框架**: React 18
- **语言**: TypeScript
- **样式**: 纯 CSS（深色主题、渐变、动画）

### 实时更新

前端通过 WebSocket 接收后端推送，无需手动刷新：

- 状态变化自动更新仪表盘
- 新交易自动添加到列表
- 税收/回购进度实时刷新

---

## 🐳 Docker 部署

### 使用 Docker Compose

```bash
# 1. 创建环境变量文件
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
EOF

# 2. 构建并启动
docker-compose up -d --build

# 3. 查看日志
docker-compose logs -f watcher

# 4. 停止服务
docker-compose down
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  watcher:
    build: .
    container_name: virtuals-launch-watcher
    restart: unless-stopped
    ports:
      - "3000:3000"    # 健康检查
      - "4000:4000"    # API + WebSocket
    volumes:
      - ./config.yaml:/app/config.yaml:ro
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## 📂 项目结构

```
virtuals-launch-watcher/
├── src/                          # 后端源码
│   ├── index.ts                  # 入口文件
│   ├── config.ts                 # 配置加载（YAML + 环境变量）
│   ├── state-machine.ts          # 状态机实现
│   ├── types.ts                  # TypeScript 类型定义
│   │
│   ├── constants/                # 常量
│   │   └── abi.ts                # 合约 ABI（ERC20、UniswapV2）
│   │
│   ├── providers/                # 数据源提供者
│   │   ├── rpc-pool.ts           # RPC 连接池（多端点、自动切换）
│   │   ├── resilient-ws.ts       # 自恢复 WebSocket
│   │   ├── virtuals-api.ts       # Virtuals API 客户端
│   │   ├── health-server.ts      # HTTP 健康检查服务
│   │   └── api-server.ts         # REST + WebSocket API
│   │
│   ├── monitors/                 # 监控器
│   │   ├── tax-tracker.ts        # 税收统计（Transfer 事件）
│   │   ├── buyback-tracker.ts    # 回购追踪（滑窗速率）
│   │   └── whale-trades.ts       # 大额交易（Swap 事件）
│   │
│   ├── notifiers/                # 通知器
│   │   └── telegram.ts           # Telegram 推送（队列、去重）
│   │
│   └── utils/                    # 工具函数
│       ├── logger.ts             # 结构化日志
│       ├── errors.ts             # 自定义错误类型
│       ├── retry.ts              # 重试工具
│       ├── format.ts             # 格式化工具
│       ├── lru-cache.ts          # LRU 缓存
│       ├── time-to-block.ts      # 时间↔区块转换
│       └── sleep.ts              # 异步等待
│
├── web/                          # 前端源码 (Vite + React)
│   ├── src/
│   │   ├── main.tsx              # React 入口
│   │   ├── App.tsx               # 主组件（仪表盘、交易、设置）
│   │   ├── api.ts                # API 封装
│   │   ├── types.ts              # 前端类型定义
│   │   ├── index.css             # 深色主题样式
│   │   └── hooks/
│   │       └── useWebSocket.ts   # WebSocket Hook
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── config.example.yaml           # 配置模板
├── package.json                  # 后端依赖
├── tsconfig.json                 # TypeScript 配置
├── Dockerfile                    # Docker 构建
├── docker-compose.yml            # Docker Compose
└── README.md                     # 本文档
```

---

## 🛠 开发指南

### 常用命令

```bash
# 开发模式（后端 + 前端）
pnpm run dev:all

# 仅后端开发
pnpm run dev

# 仅前端开发
pnpm run dev:web

# 构建生产版本
pnpm run build:all

# 代码检查
pnpm run lint

# 代码格式化
pnpm run format
```

### 添加新的监控器

1. 在 `src/monitors/` 创建新文件
2. 实现 `start()` 和 `stop()` 方法
3. 在 `src/monitors/index.ts` 导出
4. 在 `src/state-machine.ts` 中集成

### 添加新的 API 端点

1. 在 `src/providers/api-server.ts` 的 `handleRequest` 方法中添加
2. 更新前端 `web/src/api.ts`

### 日志格式

```json
{
  "timestamp": "2026-02-04T12:00:00.000Z",
  "level": "INFO",
  "state": "LAUNCH_WINDOW",
  "projectId": 123,
  "projectSymbol": "TEST",
  "message": "Tax update",
  "data": {
    "netInflow": "1000.5",
    "blocksProcessed": 50
  }
}
```

---

## ❓ 常见问题

### Q: 如何获取 Telegram Bot Token？

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot` 创建新机器人
3. 按提示设置名称和用户名
4. 获取 Token（格式：`123456:ABC-DEF...`）

### Q: 如何获取 Chat ID？

1. 将 Bot 添加到目标群组或与 Bot 私聊
2. 访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. 发送一条消息后刷新页面
4. 在返回的 JSON 中找到 `chat.id`

### Q: RPC 连接失败怎么办？

- 检查 `config.yaml` 中的 RPC 端点是否正确
- 尝试添加更多备用 RPC 端点
- 使用付费 RPC 服务（如 Alchemy、QuickNode）

### Q: 如何修改大额交易阈值？

编辑 `config.yaml`：

```yaml
thresholds:
  bigTradeVirtual: 500    # 改为 500 VIRTUAL
```

### Q: 前端无法连接后端？

- 确保后端在 4000 端口运行
- 检查 Vite 代理配置 `web/vite.config.ts`
- 确认防火墙未阻止本地端口

---

## 📜 License

MIT License

---

<p align="center">
  Made with ❤️ for Virtuals Protocol
</p>
