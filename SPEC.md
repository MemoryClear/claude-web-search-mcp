# Claude Web Search MCP Server — 工程规格说明书

## 1. 项目概述

**项目名称**: claude-web-search-mcp  
**项目类型**: MCP Server + REST API 双模式  
**核心功能**: 为 Claude 提供多源 web search + scrape 能力，支持 fallback 优先级排序  
**目标用户**: 
- MCP 模式：Claude Desktop / Claude Code / Claude API
- REST API 模式：任意 HTTP 客户端

---

## 2. 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **运行时** | Node.js 18+ | TypeScript 编译目标，已安装 v22.21.1 ✅ |
| **语言** | TypeScript | 类型安全，MCP 官方 SDK 首选 |
| **MCP SDK** | `@modelcontextprotocol/sdk` | 官方 TypeScript SDK |
| **HTTP 框架** | Express.js 5.x | REST API 服务端 |
| **搜索客户端** | 自实现 | 多源搜索支持 |
| **页面抓取** | `cheerio` + `node-fetch` | 轻量 HTML 解析 |
| **构建工具** | `tsc` | TypeScript 编译 |

---

## 3. 功能规格

### 3.1 多源搜索 + 优先级 Fallback

**支持的搜索源（按优先级）**:

| 优先级 | 数据源 | 免费额度 | 说明 |
|-------|--------|---------|------|
| 1 | Bing Search API | 1000次/月 | 需 API Key |
| 2 | DuckDuckGo HTML | 无限制 | 非官方，免费但需防封 |
| 3 | Google SerpAPI | 100次/月 | 需 API Key，兜底方案 |

**Fallback 逻辑**:
```
请求搜索
  ├─ 尝试 Bing（优先）
  │   ├─ 成功 → 返回结果 ✅
  │   └─ 失败/额度用尽 → 记录日志，尝试下一个
  ├─ 尝试 DuckDuckGo
  │   ├─ 成功 → 返回结果 ✅
  │   └─ 失败/被封 → 记录日志，尝试下一个
  └─ 尝试 SerpAPI（兜底）
      ├─ 成功 → 返回结果 ✅
      └─ 全部失败 → 返回错误
```

### 3.2 页面抓取（Scrape）

**功能**:
- 根据 URL 获取页面内容
- 使用 Cheerio 解析 HTML，提取文本/链接/图片
- 支持去除广告、导航栏、脚本等噪音内容
- 可选：提取 structured data（JSON-LD）

**输出格式**:
```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "content": "Cleaned text content...",
  "links": ["https://..."],
  "images": ["https://..."],
  "metadata": {
    "description": "...",
    "author": "...",
    "published": "..."
  }
}
```

### 3.3 MCP 工具定义（本地模式）

**暴露给 Claude 的工具**:

| 工具名 | 参数 | 说明 |
|-------|------|------|
| `web_search` | `query: string`, `num_results?: number` | 搜索，返回链接列表 |
| `web_scrape` | `url: string`, `options?: ScrapeOptions` | 抓取页面内容 |

### 3.4 REST API 接口（网络模式）

参考 Firecrawl 风格，统一的响应格式：

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "metadata": {
    "source": "duckduckgo",
    "duration": 1234
  }
}
```

**接口列表**:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/info` | 服务信息 |
| POST | `/api/search` | 搜索 |
| POST | `/api/scrape` | 抓取单个 URL |
| POST | `/api/search-scrape` | 搜索 + 抓取一站式 |

**认证方式**：
- Header: `X-API-Key: your-api-key`
- 或 Bearer Token: `Authorization: Bearer your-api-key`

### 3.5 配置管理

**配置文件**: `config.yaml`

```yaml
search:
  providers:
    - name: bing
      enabled: true
      api_key: "YOUR_BING_API_KEY"
    - name: duckduckgo
      enabled: true
    - name: serpapi
      enabled: false
      api_key: "YOUR_SERPAPI_KEY"

scraping:
  user_agent: "Mozilla/5.0 ..."
  timeout_ms: 10000
  max_content_length: 100000
  remove_selectors: [...]
```

**环境变量**:
- `API_KEY` - REST API 访问密钥
- `PORT` - REST API 端口（默认 3000）
- `CONFIG_PATH` - 配置文件路径

---

## 4. 项目结构

```
claude-web-search-mcp/
├── src/
│   ├── index.ts              # MCP Server 入口（stdio 模式）
│   ├── server.ts             # REST API 服务器（网络模式）
│   ├── config.ts             # 配置加载
│   ├── tools/                # MCP 工具
│   │   ├── search.ts
│   │   ├── scrape.ts
│   │   └── index.ts
│   ├── providers/            # 搜索服务提供商
│   │   ├── base.ts
│   │   ├── bing.ts
│   │   ├── duckduckgo.ts
│   │   ├── serpapi.ts
│   │   └── index.ts
│   ├── utils/                # 工具函数
│   │   ├── html.ts
│   │   └── logger.ts
│   └── types/
│       └── index.ts
├── config.yaml               # 配置文件
├── package.json
├── tsconfig.json
├── SPEC.md
└── README.md
```

---

## 5. 部署模式

### 5.1 本地模式（MCP over stdio）

适用于：Claude Desktop 本地使用

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["D:/Users/Administrator/Desktop/claude-web-search-mcp/dist/index.js"]
    }
  }
}
```

### 5.2 网络模式（REST API）

适用于：局域网/云服务器部署，任意客户端调用

**启动方式**:
```bash
# 设置 API Key
set API_KEY=your-secure-key

# 启动服务器
npm run start:server
```

**局域网访问**:
```
http://192.168.x.x:3000/api/search
```

**使用示例**:
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"query": "TypeScript best practices", "num_results": 5}'
```

---

## 6. 风险与限制

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| DuckDuckGo 被封 | 搜索失败 | 限速 + User-Agent 配置 |
| Bing API 额度用尽 | 自动切换 | Fallback 机制 |
| 页面抓取失败 | 内容缺失 | 返回错误信息，不阻塞 |
| API Key 泄露 | 未授权访问 | 使用强密钥，生产环境启用 HTTPS |

---

*规格版本: v1.1*  
*创建时间: 2026-03-26*  
*更新时间: 2026-03-26*
