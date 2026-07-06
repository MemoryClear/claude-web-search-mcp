# Claude Web Search MCP Server 🔍

为 Claude 提供 web search 和 scraping 能力的 MCP Server，**中国极致版** - 支持多个国产搜索引擎、并行搜索、智能去重。

## ✨ 功能特性

- 🇨🇳 **国产搜索引擎** - 百度、搜狗、360、必应中文
- 🌐 **国际搜索引擎** - DuckDuckGo、Bing、SerpAPI
- 🔄 **智能 Fallback** - 主源失败自动切换备源
- ⚡ **并行搜索** - 支持多引擎并行查询
- 📝 **搜索+抓取** - 一步返回完整文章内容（对标 Firecrawl）
- ⚙️ **YAML 配置** - 所有配置集中管理
- 🔐 **安全加固** - Rate Limit、API Key、审计日志
- 🖥️ **跨平台脚本** - 支持 Windows 和 Linux

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd claude-web-search-mcp
npm install
npm run build
```

### 2. 配置

编辑 `config.yaml`：

```yaml
server:
  port: 3001
  api_key: "your-strong-api-key"

search:
  providers:
    - name: baidu
      enabled: true
    - name: sogou
      enabled: true
    - name: zh360
      enabled: true
    - name: duckduckgo
      enabled: true

  strategy:
    mode: "priority"      # priority（顺序）或 parallel（并行）
    deduplication: true   # 结果去重
```

### 3. 启动服务

**Windows:**
```powershell
.\server.bat start     # 启动（无黑窗口）
.\server.bat stop      # 停止
.\server.bat restart   # 重启
.\server.bat status    # 状态
.\server.bat logs      # 日志
```

**Linux:**
```bash
chmod +x server.sh
./server.sh start
./server.sh stop
./server.sh restart
./server.sh status
./server.sh logs
```

---

## 🔍 支持的搜索引擎

| 引擎 | 类型 | 说明 |
|------|------|------|
| **百度** | 国产 | 国内直接可用，无需 API Key |
| **搜狗** | 国产 | 国内直接可用 |
| **360** | 国产 | 国内直接可用 |
| **必应中文** | 国产 | cn.bing.com，备用 |
| **DuckDuckGo** | 国际 | HTML 搜索，免费 |
| **Bing** | 国际 | 需要 API Key |
| **SerpAPI** | 国际 | 需要 API Key |

---

## 📡 使用方式

### 方式一：Claude Code (MCP)

```bash
claude mcp add -t http -H "x-api-key:your-api-key" -s user web-search http://127.0.0.1:3001/mcp
```

在 Claude Code 中：
```
搜索最新的 AI 新闻
搜索 Python 教程并返回文章内容
```

### 方式二：REST API

**基础搜索**：
```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"query": "AI news", "num_results": 5}'
```

**搜索 + 抓取内容**：
```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"query": "Python教程", "fetch_content": true}'
```

---

## 📋 API 参考

### POST /api/search

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| query | string | 必填 | 搜索关键词 |
| num_results | number | 5 | 返回结果数 (max 20) |
| fetch_content | boolean | false | 是否抓取完整内容 |
| scrape_limit | number | 3 | 抓取前 N 个结果的内容 (max 5) |

### POST /api/scrape

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| url | string | 必填 | 要抓取的 URL |
| extract_links | boolean | true | 是否提取链接 |
| extract_images | boolean | false | 是否提取图片 |

---

## 🔧 配置说明

### config.yaml 完整配置

```yaml
server:
  port: 3001
  host: "0.0.0.0"
  api_key: "your-api-key"

security:
  rate_limit:
    window_ms: 60000
    max_requests: 1000
  cors:
    enabled: true
    origin: "*"

search:
  providers:
    - name: baidu
      enabled: true
    - name: sogou
      enabled: true
    - name: zh360
      enabled: true
    - name: duckduckgo
      enabled: true
  strategy:
    mode: "priority"      # priority | parallel
    timeout_ms: 15000
    deduplication: true

scraping:
  user_agent: "Mozilla/5.0 ..."
  timeout_ms: 10000
  max_content_length: 100000

logging:
  level: "info"
  file:
    enabled: true
    path: "./logs/app.log"
  audit:
    enabled: true
```

---

## 📁 项目结构

```
claude-web-search-mcp/
├── src/
│   ├── mcp-http-server.ts  # MCP HTTP 服务器
│   ├── config.ts           # 配置加载
│   ├── tools/              # MCP 工具
│   ├── providers/          # 搜索引擎
│   │   ├── baidu.ts
│   │   ├── sogou.ts        # 搜狗
│   │   ├── zh360.ts        # 360搜索
│   │   ├── bingCN.ts       # 必应中文
│   │   ├── duckduckgo.ts
│   │   └── ...
│   └── utils/
│       ├── html.ts
│       └── logger.ts
├── config.yaml
├── server.bat
├── server.ps1
├── server.sh
└── README.md
```

---

## 📝 更新日志

### v1.3.0 (2026-07-06)
- ✅ 搜狗/360/必应中文：字符串解析全面替换为 Cheerio 解析
- ✅ 错误处理：7 个 provider 全部统一使用 `handleError`
- ✅ 百度搜索：URL 清理保留百度跳转链接 + 白名单去除外部跟踪参数（utm_* 等）
- ✅ 抓取结果：改用 `response.url`（重定向后最终 URL）
- ✅ DuckDuckGo：新增 `region`/`language` 配置项，默认 cn-zh
- ✅ 页面抓取：新增指数退避重试机制（`retry_count`/`retry_delay_ms` 可配置）
- ✅ 内容提取：段落级提取 + link-density 过滤 + 噪音关键词过滤
- ✅ Rate Limiter：重构为 sliding-window 无内存泄漏实现
- ✅ 可观测性：新增 Prometheus metrics 端点 `/metrics`，支持 `search_requests_total` 计数器 + `search_duration_ms`/`scrape_duration_ms` 直方图
- ✅ DuckDuckGo 反爬页面检测
- ✅ 配置文件：`config.yaml` 补充 `region`/`language`/`retry_count`/`retry_delay_ms` 字段

### v1.2.0 (2026-03-27)

### v1.1.0
- ✅ 新增 `fetch_content` 参数
- ✅ 配置迁移到 `config.yaml`
- ✅ 安全加固

### v1.0.0
- 初始版本

---

## 📄 License

MIT
