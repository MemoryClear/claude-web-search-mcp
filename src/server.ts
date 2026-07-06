// REST API Server for Claude Web Search
// 暴露 HTTP 接口，参考 Firecrawl 风格

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { loadConfig } from './config';
import { searchWithFallback } from './providers';
import { scrapeUrl } from './utils/html';
import { logger } from './utils/logger';
import { createRateLimiter } from './utils/rateLimiter';
import { metrics } from './utils/metrics';

const rateLimiter = createRateLimiter();

// 加载配置
const config = loadConfig();

const app = express();
app.set('trust proxy', 1);  // 支持 X-Forwarded-For 头
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'your-secret-api-key';

// ============ 中间件 ============

app.use(cors());
app.use(express.json());

// Rate Limit 中间件（按 IP）
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
  const { allowed, remaining, resetMs } = rateLimiter.isAllowed(ip);

  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + resetMs) / 1000)));

  if (!allowed) {
    return res.status(429).json({
      success: false,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${Math.ceil(resetMs / 1000)}s.`,
    });
  }
  next();
}

// API Key 认证中间件
function authenticate(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (key !== API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key',
    });
  }
  next();
}

// 请求日志中间件
function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('api', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
}

// ============ 响应格式（参考 Firecrawl）============

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    source: string;
    duration: number;
  };
}

function successResponse<T>(data: T, source: string, duration: number): ApiResponse<T> {
  return {
    success: true,
    data,
    metadata: {
      source,
      duration,
    },
  };
}

function errorResponse(error: string): ApiResponse<null> {
  return {
    success: false,
    error,
  };
}

// ============ API 路由 ============

// Prometheus metrics 端点
app.get('/metrics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.toPrometheus());
});

// 健康检查
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'claude-web-search-api',
    version: '1.0.0',
  });
});

// 搜索接口（对标 Firecrawl：支持 fetch_content 参数返回完整文章内容）
app.post('/api/search', rateLimit, authenticate, requestLogger, async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { query, num_results = 5, fetch_content = false, scrape_limit = 3 } = req.body;
    const startMs = Date.now();

    if (!query || typeof query !== 'string') {
      return res.status(400).json(errorResponse('Missing or invalid "query" parameter'));
    }

    const limit = Math.min(Math.max(1, Number(num_results)), 20);
    const { results, provider, mode } = await searchWithFallback(query, limit);
    metrics.observeHistogram('search_duration_ms', Date.now() - startMs, { name: 'search', mode });

    // 如果不需要抓取内容，直接返回搜索结果（Firecrawl 基础模式）
    if (!fetch_content) {
      const duration = Date.now() - startTime;
      return res.json(successResponse({
        results: results.map(r => ({
          url: r.url,
          title: r.title,
          description: r.snippet,
          source: r.source,
        })),
        query,
        count: results.length,
      }, provider, duration));
    }

    // 搜索 + 抓取模式（Firecrawl scrapeOptions 模式）
    const topN = Math.min(Math.max(1, Number(scrape_limit)), 5);
    const topResults = results.slice(0, topN);
    const scrapedResults = [];

    for (const result of topResults) {
      try {
        const scraped = await scrapeUrl(result.url, { extractLinks: false, extractImages: false });
        scrapedResults.push({
          url: scraped.url,
          title: scraped.title,
          description: scraped.metadata.description || result.snippet,
          markdown: scraped.content,
          metadata: scraped.metadata,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Scrape failed';
        scrapedResults.push({
          url: result.url,
          title: result.title,
          description: result.snippet,
          markdown: null,
          error: msg,
        });
      }
    }

    const duration = Date.now() - startTime;
    res.json(successResponse({
      results: scrapedResults,
      query,
      count: results.length,
      scraped: scrapedResults.length,
    }, provider, duration));
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed';
    logger.error('api', `Search error: ${message}`);
    res.status(500).json(errorResponse(message));
  }
});

// 抓取接口（单个 URL）
app.post('/api/scrape', rateLimit, authenticate, requestLogger, async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { url, extract_links = true, extract_images = false } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json(errorResponse('Missing or invalid "url" parameter'));
    }
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json(errorResponse('URL must start with http:// or https://'));
    }
    
    const result = await scrapeUrl(url, {
      extractLinks: extract_links,
      extractImages: extract_images,
    });

    const duration = Date.now() - startTime;
    metrics.observeHistogram('scrape_duration_ms', duration, { name: 'scrape', status: 'ok' });
    res.json(successResponse(result, 'direct', duration));
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scrape failed';
    logger.error('api', `Scrape error: ${message}`);
    metrics.observeHistogram('scrape_duration_ms', Date.now() - startTime, { name: 'scrape', status: 'error' });
    res.status(500).json(errorResponse(message));
  }
});

// 搜索 + 抓取一站式接口（类似 Firecrawl 的 /scrape）
app.post('/api/search-scrape', rateLimit, authenticate, requestLogger, async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { query, num_results = 3, extract_links = true, extract_images = false } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json(errorResponse('Missing or invalid "query" parameter'));
    }
    
    // 1. 先搜索
    const limit = Math.min(Math.max(1, Number(num_results)), 10);
    const { results, provider, mode } = await searchWithFallback(query, limit);
    metrics.observeHistogram('search_duration_ms', Date.now() - startTime, { name: 'search', mode });

    // 2. 对第一个结果抓取内容
    if (results.length > 0) {
      const topResult = results[0];
      const scrapeStart = Date.now();

      try {
        const scrapeResult = await scrapeUrl(topResult.url, {
          extractLinks: extract_links,
          extractImages: extract_images,
        });

        const duration = Date.now() - startTime;
        metrics.observeHistogram('scrape_duration_ms', Date.now() - scrapeStart, { name: 'scrape', status: 'ok' });
        res.json(successResponse({
          query,
          search_results: results,
          scraped_content: scrapeResult,
          provider,
          mode,
        }, provider, duration));

      } catch {
        // 抓取失败也返回搜索结果
        const duration = Date.now() - startTime;
        metrics.observeHistogram('scrape_duration_ms', Date.now() - scrapeStart, { name: 'scrape', status: 'error' });
        res.json(successResponse({
          query,
          search_results: results,
          scraped_content: null,
          scrape_error: 'Failed to scrape the top result',
          provider,
          mode,
        }, provider, duration));
      }
    } else {
      const duration = Date.now() - startTime;
      res.json(successResponse({
        query,
        search_results: [],
        scraped_content: null,
        provider,
        mode,
      }, provider, duration));
    }
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search-scrape failed';
    logger.error('api', `Search-scrape error: ${message}`);
    metrics.observeHistogram('search_duration_ms', Date.now() - startTime, { name: 'search', mode: 'unknown' });
    res.status(500).json(errorResponse(message));
  }
});

// 获取服务器信息
app.get('/api/info', authenticate, (req: Request, res: Response) => {
  res.json({
    service: 'Claude Web Search API',
    version: '1.0.0',
    endpoints: [
      'POST /api/search - Search the web',
      'POST /api/scrape - Scrape a URL',
      'POST /api/search-scrape - Search and scrape top result',
      'GET /api/info - This info',
      'GET /health - Health check',
    ],
    providers: {
      bing: config.search.providers.find(p => p.name === 'bing')?.enabled && !!config.search.providers.find(p => p.name === 'bing')?.api_key,
      duckduckgo: config.search.providers.find(p => p.name === 'duckduckgo')?.enabled,
      serpapi: config.search.providers.find(p => p.name === 'serpapi')?.enabled && !!config.search.providers.find(p => p.name === 'serpapi')?.api_key,
    },
  });
});

// 404 处理
app.use((req: Request, res: Response) => {
  res.status(404).json(errorResponse(`Endpoint not found: ${req.method} ${req.path}`));
});

// 错误处理
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('api', `Unhandled error: ${err.message}`);
  res.status(500).json(errorResponse('Internal server error'));
});

// ============ 启动 ============

const HOST = process.env.HOST || '0.0.0.0';

app.listen(Number(PORT), HOST, () => {
  logger.info('api', `🚀 Server running on http://${HOST}:${PORT}`);
  logger.info('api', `📍 Health check: http://${HOST}:${PORT}/health`);
  logger.info('api', `🔐 API Key: ${API_KEY === 'your-secret-api-key' ? '(default - change in production!)' : '***'}`);
  logger.info('api', `📡 Endpoints:`);
  logger.info('api', `   POST /api/search`);
  logger.info('api', `   POST /api/scrape`);
  logger.info('api', `   POST /api/search-scrape`);
});

export { app };
