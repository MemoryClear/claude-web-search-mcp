// Claude Web Search MCP Server - HTTP Transport Mode (安全加固版)
// 通过 Streamable HTTP 传输 MCP 协议，供 Claude Code 等客户端通过网络连接

import * as crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { loadConfig, Config } from './config';
import { webSearchTool, handleWebSearch } from './tools/search';
import { webScrapeTool, handleWebScrape } from './tools/scrape';
import { searchWithFallback } from './providers';
import { scrapeUrl } from './utils/html';
import {
  logger,
  logStartup,
  logSecurityWarning,
  startRequestTrace,
  endRequestTrace,
  logAuthFailure,
} from './utils/logger';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';

// ============ 加载配置 ============

const config: Config = loadConfig();

// ============ 安全中间件 ============

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Rate Limiter
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = config.security.rate_limit.window_ms;
  const maxRequests = config.security.rate_limit.max_requests;

  let entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + windowMs };
    rateLimitStore.set(ip, entry);
    return next();
  }

  entry.count++;

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
    });
  }

  next();
}

// 安全 Headers
function securityHeaders(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
}

// 审计日志
function auditMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const trace = startRequestTrace(getClientIp(req), req.method, req.path, req.headers['user-agent']);

  res.on('finish', () => {
    const body = res.statusCode >= 400 ? JSON.stringify(req.body) : undefined;
    endRequestTrace(trace, res.statusCode, body);
  });

  next();
}

// API Key 认证
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expectedKey = config.server.api_key;

  const providedKey = req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query['api_key'];

  if (!providedKey) {
    logAuthFailure(getClientIp(req), 'No API key provided');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Use X-API-Key header or Authorization: Bearer <key>',
    });
  }

  if (!timingSafeEqual(String(providedKey), expectedKey)) {
    logAuthFailure(getClientIp(req), 'Invalid API key');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
  }

  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============ Express 应用 ============

const app = express();

// 安全中间件
app.use(securityHeaders);
app.use(rateLimiter);

// CORS
if (config.security.cors.enabled) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.security.cors.origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, MCP-Session-ID');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
}

app.use(express.json({ limit: '1mb' }));

// 审计中间件（在认证之后）
app.use(auditMiddleware);

// ============ MCP Server 逻辑 ============

const TOOLS = [webSearchTool, webScrapeTool];

function createMcpServer(): Server {
  const server = new Server(
    { name: 'claude-web-search', version: '1.2.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'web_search':
          return await handleWebSearch(args as { query: string; num_results?: number; fetch_content?: boolean });
        case 'web_scrape':
          return await handleWebScrape(args as { url: string; extract_links?: boolean; extract_images?: boolean });
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  return server;
}

// ============ MCP 路由 ============

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post('/mcp', authMiddleware, async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
      await transport.handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid: string) => {
          logger.info('mcp', `Session initialized: ${sid}`);
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          logger.info('mcp', `Session closed: ${sid}`);
          delete transports[sid];
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID' },
        id: null,
      });
    }
  } catch (error) {
    logger.error('mcp', `POST error:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', authMiddleware, async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.delete('/mcp', authMiddleware, async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  try {
    await transports[sessionId].handleRequest(req, res);
  } catch {
    if (!res.headersSent) res.status(500).send('Error');
  }
});

// ============ REST API ============

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'claude-web-search-mcp',
    version: '1.2.0',
    mode: 'mcp-http',
    sessions: Object.keys(transports).length,
  });
});

app.post('/api/search', authMiddleware, async (req, res) => {
  try {
    const { query, num_results = 5, fetch_content = false, scrape_limit = 3 } = req.body;
    if (!query) return res.status(400).json({ success: false, error: 'Missing query' });

    const { results, provider } = await searchWithFallback(query, Math.min(num_results, 20));

    if (!fetch_content) {
      return res.json({
        success: true,
        data: { results, query, count: results.length },
        metadata: { source: provider },
      });
    }

    const topN = Math.min(scrape_limit, 5);
    const scraped = [];
    for (const r of results.slice(0, topN)) {
      try {
        const content = await scrapeUrl(r.url, { extractLinks: false, extractImages: false });
        scraped.push({ ...r, markdown: content.content });
      } catch {
        scraped.push({ ...r, markdown: null, error: 'Scrape failed' });
      }
    }

    res.json({ success: true, data: { results: scraped, query }, metadata: { source: provider } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed';
    res.status(500).json({ success: false, error: msg });
  }
});

app.post('/api/scrape', authMiddleware, async (req, res) => {
  try {
    const { url, extract_links = true, extract_images = false } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url' });
    const result = await scrapeUrl(url, { extractLinks: extract_links, extractImages: extract_images });
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Scrape failed';
    res.status(500).json({ success: false, error: msg });
  }
});

// ============ 错误处理 ============

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('server', `Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ 启动 ============

const apiKeySet: boolean = !!(config.server.api_key && config.server.api_key !== 'your-secret-api-key');
if (!apiKeySet) {
  logSecurityWarning('API_KEY is using default value! Set a strong key in config.yaml for production.');
}

app.listen(config.server.port, config.server.host, () => {
  logStartup({
    host: config.server.host,
    port: config.server.port,
    apiKeySet,
    corsOrigin: config.security.cors.enabled ? config.security.cors.origin : 'Disabled',
    rateLimit: `${config.security.rate_limit.max_requests} req/${config.security.rate_limit.window_ms / 1000}s`,
    forceHttps: config.security.force_https,
  });
});

export { app };
