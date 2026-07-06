// Web scraping utility

import { ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { load, CheerioAPI } from 'cheerio';
import { getConfig } from '../config';

export async function scrapeUrl(
  url: string,
  options: { extractLinks?: boolean; extractImages?: boolean } = {}
): Promise<ScrapeResult> {
  const config = getConfig();
  const { extractLinks = true, extractImages = true } = options;
  const { retry_count = 2, retry_delay_ms = 500 } = config.scraping;

  logger.info('scrape', `Fetching: ${url}`);

  let lastError: unknown;

  // 重试循环：指数退避
  for (let attempt = 0; attempt <= retry_count; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.scraping.timeout_ms);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': config.scraping.user_agent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
        // Node 18+ 支持
        redirect: 'follow',
      });

      // 5xx + 网络超时 → 重试；4xx 立即失败（不重试客户端错误）
      if (!response.ok) {
        if (response.status >= 500 && attempt < retry_count) {
          clearTimeout(timeout);
          const delay = retry_delay_ms * Math.pow(2, attempt);
          logger.warn('scrape', `HTTP ${response.status}, retrying in ${delay}ms (${attempt + 1}/${retry_count})`);
          await sleep(delay);
          continue;
        }
        clearTimeout(timeout);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      clearTimeout(timeout);

      const $ = load(html);

      // Remove noise elements
      for (const selector of config.scraping.remove_selectors) {
        try { $(selector).remove(); } catch { /* skip invalid selector */ }
      }

      // Extract title
      const title = $('title').text().trim() ||
                    $('h1').first().text().trim() ||
                    'Untitled';

      // Extract main content
      const content = extractMainContent($);

      // Extract links
      const links: string[] = [];
      if (extractLinks) {
        $('a[href^="http"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href && !href.includes('javascript:') && !href.includes('#')) {
            links.push(href);
          }
        });
      }

      // Extract images
      const images: string[] = [];
      if (extractImages) {
        $('img[src]').each((_, el) => {
          const src = $(el).attr('src');
          if (src && src.startsWith('http')) {
            images.push(src);
          }
        });
      }

      // Extract metadata
      const metadata = extractMetadata($);

      const result: ScrapeResult = {
        url: response.url || url,
        title,
        content,
        links: [...new Set(links)].slice(0, 50),
        images: [...new Set(images)].slice(0, 20),
        metadata,
      };

      logger.info('scrape', `Successfully scraped: ${title}`);
      return result;

    } catch (error) {
      lastError = error;
      clearTimeout(timeout);

      const isAbort = error instanceof Error && error.name === 'AbortError';
      const isNetError = error instanceof TypeError; // 网络错误（DNS、ECONNREFUSED 等）

      if ((isAbort || isNetError) && attempt < retry_count) {
        const delay = retry_delay_ms * Math.pow(2, attempt);
        logger.warn('scrape', `${isAbort ? 'Timeout' : 'Network error'}, retrying in ${delay}ms (${attempt + 1}/${retry_count})`);
        await sleep(delay);
        continue;
      }

      if (isAbort) {
        logger.error('scrape', `Timeout after ${retry_count + 1} attempt(s): ${url}`);
        throw new Error(`Timeout after ${retry_count + 1} attempts: ${url}`);
      }

      logger.error('scrape', `Failed after ${attempt + 1} attempt(s): ${url}`);
      throw error;
    }
  }

  // 所有重试耗尽
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to scrape ${url} after ${retry_count + 1} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractMainContent($: CheerioAPI): string {
  const config = getConfig();
  const maxLength = config.scraping.max_content_length;

  // ========== Step 1: 去除已知噪音块 ==========
  const noiseSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
    'nav', 'header', 'footer', 'aside',
    '.sidebar', '.widget', '.advertisement', '.ad', '.ads',
    '.related', '.recommended', '.share-buttons', '.social-share',
    '.comment', '.comments', '#comments', '.footer', '.nav',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.breadcrumb', '.breadcrumbs', '.pagination', '.pager',
    '.newsletter', '.subscribe', '.subscription', '.popup',
  ];
  for (const sel of noiseSelectors) {
    try { $(sel).remove(); } catch { /* skip bad selector */ }
  }

  // ========== Step 2: 预过滤 body 中的噪音段落 ==========
  const noiseParagraphs = [
    'Copyright', '©', 'All Rights Reserved', '沪ICP备',
    '登录', '注册', '发表评论', '相关推荐', '热门文章',
    '上一篇', '下一篇', '返回首页', '查看更多',
    'Copyright ©', 'Privacy Policy', 'Terms of Use',
  ];

  // ========== Step 3: 段落级内容提取 ==========
  const paragraphs: string[] = [];
  const minLen = 50;  // 最短有效段落长度

  $('p, li, td, th, div').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();

    if (text.length < minLen) return;

    // 跳过含有大量链接的段落（导航类）
    const linkDensity = $el.find('a').length > 0
      ? $el.find('a').text().length / text.length
      : 0;
    if (linkDensity > 0.5) return;

    // 跳过含噪音关键词的段落
    if (noiseParagraphs.some(n => text.includes(n))) return;

    // 跳过非中文页面中过短的英文段落
    if (/^[a-zA-Z\s]{3,20}$/.test(text)) return;

    paragraphs.push(text);
  });

  // ========== Step 4: 段落排序 + 截断 ==========
  // 按长度降序，优先返回信息密度最高的段落
  paragraphs.sort((a, b) => b.length - a.length);

  // 取前 N 段完整内容，再按长度截断
  let result = '';
  const maxParagraphs = 30;
  for (let i = 0; i < Math.min(paragraphs.length, maxParagraphs); i++) {
    result += paragraphs[i] + '\n\n';
  }

  // 如果没有段落，用结构化容器兜底
  if (!result.trim()) {
    const contentSelectors = [
      'article', 'main', '[role="main"]',
      '.post-content', '.article-content', '.entry-content',
      '.post', '.article', '#content',
    ];
    for (const sel of contentSelectors) {
      const el = $(sel).first();
      if (el.length > 0) {
        result = el.text().trim();
        if (result.length > 100) break;
      }
    }
    if (!result) {
      result = $('body').text().trim();
    }
  }

  return truncateText(result.trim(), maxLength);
}

function extractMetadata($: CheerioAPI): ScrapeResult['metadata'] {
  const metadata: ScrapeResult['metadata'] = {};

  // Meta tags
  const metaDescription = $('meta[name="description"]').attr('content') ||
                          $('meta[property="og:description"]').attr('content');
  if (metaDescription) {
    metadata.description = metaDescription.trim();
  }

  const author = $('meta[name="author"]').attr('content') ||
                 $('meta[property="article:author"]').attr('content');
  if (author) {
    metadata.author = author.trim();
  }

  const published = $('meta[property="article:published_time"]').attr('content') ||
                    $('time[datetime]').attr('datetime');
  if (published) {
    metadata.published = published.trim();
  }

  return metadata;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...[truncated]';
}
