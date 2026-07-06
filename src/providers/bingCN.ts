// Bing CN Provider - 使用 Cheerio 稳定解析

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { load } from 'cheerio';
import { getConfig } from '../config';

export class BingCNProvider extends BaseSearchProvider {
  name = 'bingCN';

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const encodedQuery = this.sanitizeQuery(query);
    const config = getConfig();
    const url = `https://cn.bing.com/search?q=${encodedQuery}&mkt=zh-CN&count=${numResults}`;

    try {
      logger.info('bingCN', `Searching: ${query}`);

      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': config.scraping.user_agent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }, config.scraping.timeout_ms * 2);

      if (!response.ok) {
        logger.error('bingCN', `HTTP error: ${response.status}`);
        throw new Error(`Bing CN HTTP error: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      const html = decoder.decode(buffer);
      const $ = load(html);

      const results: SearchResult[] = [];
      const seenUrls = new Set<string>();

      // Bing 搜索结果标准结构：<li class="b_algo"> ... <h2><a href="...">标题</a></h2> ... <p>摘要</p> ...
      const selectors = [
        'li.b_algo',          // 标准结果
        'div.b_algo',         // div 变体
        'li[data-view-result]', // 新版结构
      ];

      for (const selector of selectors) {
        $(selector).each((_, el) => {
          const $el = $(el);

          // 跳过广告
          if ($el.hasClass('b_ad') || $el.find('.b_ad').length > 0) return;

          // 标题 + URL
          const $link = $el.find('h2 a, h3 a').first();
          const title = $link.text().trim();
          const href = $link.attr('href') || '';

          // 摘要
          let snippet = '';
          const snippetSelectors = [
            '.b_paractl',
            '.b_caption p',
            '.c-abstract',
            'p',
          ];
          for (const sel of snippetSelectors) {
            const text = $el.find(sel).first().text().trim();
            if (text && text.length > 10) {
              snippet = text;
              break;
            }
          }

          if (title && href && href.startsWith('http') && !seenUrls.has(href)) {
            seenUrls.add(href);
            results.push({
              title,
              url: href,
              snippet: snippet.substring(0, 300),
              source: 'bingCN',
            });
          }
        });

        if (results.length > 0) break;
      }

      // 备选：直接用 h2 a 兜底
      if (results.length === 0) {
        $('h2 a[href^="http"], h3 a[href^="http"]').each((_, el) => {
          const $el = $(el);
          const href = $el.attr('href') || '';
          const title = $el.text().trim();

          if (!title || title.length < 5) return;
          if (!seenUrls.has(href)) {
            seenUrls.add(href);

            // 尝试找摘要
            let snippet = '';
            const $parent = $el.closest('li, div').first();
            const text = $parent.find('.b_paractl, p').first().text().trim();
            if (text) snippet = text;

            results.push({
              title,
              url: href,
              snippet: snippet.substring(0, 300),
              source: 'bingCN',
            });
          }
        });
      }

      const limitedResults = results.slice(0, numResults);
      logger.info('bingCN', `Found ${limitedResults.length} results`);
      return limitedResults;

    } catch (error) {
      this.handleError(error, 'search');
    }
  }
}
