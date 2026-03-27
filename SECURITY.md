# 安全加固说明

## 已实施的安全措施

### 1. API Key 认证
- ✅ 常量时间比较（防时序攻击）
- ✅ 支持 `X-API-Key` 和 `Authorization: Bearer` 两种方式
- ✅ 启动时检查 API Key 是否配置

### 2. Rate Limiting
- ✅ 默认：每 IP 每分钟最多 100 次请求
- ✅ 返回标准 `Retry-After` 头
- ⚠️ 内存存储，重启丢失（生产环境建议用 Redis）

### 3. 安全 Headers
- ✅ X-Frame-Options: DENY
- ✅ X-Content-Type-Options: nosniff
- ✅ X-XSS-Protection
- ✅ Content-Security-Policy
- ✅ 隐藏 X-Powered-By

### 4. 防重放攻击（可选）
- ✅ X-Timestamp 验证（5 分钟容忍度）
- ✅ X-Nonce 去重

### 5. 审计日志
- ✅ 记录所有请求（IP、路径、状态码、耗时）
- ✅ 错误请求记录请求体

---

## 环境变量配置

```bash
# 必需：设置强 API Key
API_KEY=$(openssl rand -hex 32)

# 可选：IP 白名单（逗号分隔）
ALLOWED_IPS=192.168.1.100,10.0.0.0/24

# 可选：Rate Limit
RATE_LIMIT_WINDOW=60000      # 毫秒
RATE_LIMIT_MAX=100           # 最大请求数

# 可选：强制 HTTPS
FORCE_HTTPS=true

# 可选：CORS
CORS_ORIGIN=https://your-domain.com
CORS_ENABLED=true
```

---

## 生产部署建议

### 1. 使用 Nginx 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # 安全 Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2. 使用 systemd 管理服务

```ini
# /etc/systemd/system/web-search-mcp.service
[Unit]
Description=Claude Web Search MCP Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/claude-web-search-mcp
ExecStart=/usr/bin/node dist/mcp-http-server.js
Restart=on-failure
RestartSec=10

# 安全
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/

# 环境变量
EnvironmentFile=/opt/claude-web-search-mcp/.env

[Install]
WantedBy=multi-user.target
```

### 3. 防火墙配置

```bash
# 只允许本地访问（通过 Nginx 代理）
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 3001/tcp

# 或指定 IP 白名单
ufw allow from 192.168.1.100 to any port 3001
```

---

## 客户端调用示例

### 带 Timestamp 和 Nonce（防重放）

```bash
TIMESTAMP=$(date +%s%3N)
NONCE=$(openssl rand -hex 16)
API_KEY="your-api-key"

curl -X POST https://api.yourdomain.com/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Nonce: $NONCE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

---

## 安全检查清单

| 检查项 | 状态 |
|--------|------|
| API Key 已设置（非默认值） | ☐ |
| 使用 HTTPS | ☐ |
| Nginx 反向代理配置 | ☐ |
| 防火墙限制端口 | ☐ |
| Rate Limit 已启用 | ☐ |
| 日志审计启用 | ☐ |
| 定期轮换 API Key | ☐ |
