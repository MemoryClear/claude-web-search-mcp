// 360 搜索 Provider - 使用 Cheerio 稳定解析

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { load } from 'cheerio';
import { getConfig } from '../config';

export class Zh360Provider extends BaseSearchProvider {
  name = 'zh360';

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const encodedQuery = this.sanitizeQuery(query);
    const config = getConfig();
    const url = `https://www.so.com/s?ie=utf8&q=${encodedQuery}`;

    try {
      logger.info('zh360', `Searching: ${query}`);

      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': config.scraping.user_agent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }, config.scraping.timeout_ms * 2);

      if (!response.ok) {
        logger.error('zh360', `HTTP error: ${response.status}`);
        throw new Error(`360 HTTP error: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      const html = decoder.decode(buffer);
      const $ = load(html);

      const results: SearchResult[] = [];
      const seenUrls = new Set<string>();

      // 方法1：标准搜索结果列表
      // 结构: <li class="res-list"> ... <h3 class="res-title"><a href="...">标题</a></h3> ... <p class="res-desc">摘要</p> ...
      const selectors = [
        'li.res-list',           // 标准列表项
        'div.res-list',          // div 变体
        'li.js-gap',             // 新版结构
        'div.js-related',        // 相关搜索区
        'ul.result li',          // 通用列表结构
      ];

      for (const selector of selectors) {
        $(selector).each((_, el) => {
          const $el = $(el);

          // 跳过广告/推广
          if ($el.find('.ec_wise_ad, .ec_youxuan, .ad').length > 0) return;

          // 标题
          const $link = $el.find('h3.res-title a, h3 a, .res-title a, a.res-title');
          const title = $link.text().trim();

          // URL
          let href = $link.attr('href') || '';

          // 摘要
          let snippet = '';
          const snippetSelectors = [
            'p.res-desc',
            '.res-desc',
            'p.description',
            '.description',
            '.abstract',
            '.summary',
            'p',
          ];
          for (const sel of snippetSelectors) {
            const text = $el.find(sel).first().text().trim();
            if (text && text.length > 10) {
              snippet = text;
              break;
            }
          }

          if (title && href) {
            href = this.cleanZh360Url(href);
            if (href.startsWith('http') && !seenUrls.has(href)) {
              seenUrls.add(href);
              results.push({
                title,
                url: href,
                snippet: snippet.substring(0, 300),
                source: 'zh360',
              });
            }
          }
        });

        if (results.length > 0) break;
      }

      // 方法2：备选 - 直接找 h3 a 兜底（应对页面结构变化）
      if (results.length === 0) {
        $('h3 a[href], h2 a[href]').each((_, el) => {
          const $el = $(el);
          let href = $el.attr('href') || '';
          const title = $el.text().trim();

          // 过滤掉导航链接
          if (!title || title.length < 5) return;
          if (href.includes('so.com/') && !href.startsWith('http')) return;

          href = this.cleanZh360Url(href);
          if (href.startsWith('http') && !seenUrls.has(href)) {
            seenUrls.add(href);

            // 尝试从父元素找摘要
            let snippet = '';
            const $parent = $el.closest('li, div').first();
            const text = $parent.find('.res-desc, .description, p').first().text().trim();
            if (text) snippet = text;

            results.push({
              title,
              url: href,
              snippet: snippet.substring(0, 300),
              source: 'zh360',
            });
          }
        });
      }

      const limitedResults = results.slice(0, numResults);
      logger.info('zh360', `Found ${limitedResults.length} results`);
      return limitedResults;

    } catch (error) {
      this.handleError(error, 'search');
    }
  }

  private cleanZh360Url(href: string): string {
    if (!href) return '';

    // 360 内部跳转，scrape 时跟随重定向即可
    if (href.includes('so.com/link') || href.startsWith('/')) {
      return href.startsWith('http') ? href : `https://www.so.com${href}`;
    }

    return href;
  }
}
