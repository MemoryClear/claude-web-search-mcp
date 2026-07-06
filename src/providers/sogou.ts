// Sogou Search Provider - 使用 Cheerio 稳定解析

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { load, CheerioAPI } from 'cheerio';
import { getConfig } from '../config';

export class SogouProvider extends BaseSearchProvider {
  name = 'sogou';

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const encodedQuery = this.sanitizeQuery(query);
    const config = getConfig();
    const url = `https://www.sogou.com/web?query=${encodedQuery}&num=${numResults}`;

    try {
      logger.info('sogou', `Searching: ${query}`);

      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': config.scraping.user_agent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }, config.scraping.timeout_ms * 2);

      if (!response.ok) {
        logger.error('sogou', `HTTP error: ${response.status}`);
        throw new Error(`Sogou HTTP error: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      const html = decoder.decode(buffer);
      const $ = load(html);

      const results: SearchResult[] = [];

      // 方法1：标准搜索结果（vrTitle 类标题）
      // 结构: <ul class="vrwrap"> ... <h3 class="vrTitle"><a href="...">标题</a></h3> ... <span class="str_info">摘要</span> ...
      const vrResults = $('ul.vrwrap').not('.sitelinks').not('.img-results');
      vrResults.each((_, el) => {
        const $el = $(el);
        const $link = $el.find('h3.vrTitle a, h3 a');
        const title = $link.text().trim();
        let href = $link.attr('href') || '';

        // 尝试多种方式获取摘要
        let snippet = '';
        const snippetSelectors = [
          '.str_info',
          '.space_txt',
          '.comment-a',
          '.rvr-text',
          '[id^="cacheresult"]',
        ];
        for (const sel of snippetSelectors) {
          const text = $el.find(sel).first().text().trim();
          if (text) {
            snippet = text;
            break;
          }
        }

        if (title && href) {
          href = this.cleanSogouUrl(href);
          if (href.startsWith('http')) {
            results.push({
              title,
              url: href,
              snippet: snippet.substring(0, 300),
              source: 'sogou',
            });
          }
        }
      });

      // 方法2：备选结构 - 用 h3 a 兜底
      if (results.length === 0) {
        $('h3 a[href]').each((_, el) => {
          const $el = $(el);
          let href = $el.attr('href') || '';
          const title = $el.text().trim();

          // 跳过导航/推广链接
          if (!title || title.length < 5) return;
          if (href.includes('help.sogou') || href.includes('weixin.sogou')) return;

          href = this.cleanSogouUrl(href);
          if (href.startsWith('http')) {
            // 找相邻的摘要
            let snippet = '';
            const $parent = $el.closest('li, div').first();
            const snippetSelectors = ['.str_info', '.space_txt', '.comment-a'];
            for (const sel of snippetSelectors) {
              const text = $parent.find(sel).first().text().trim();
              if (text) {
                snippet = text;
                break;
              }
            }

            // 去重
            if (!results.some(r => r.url === href)) {
              results.push({
                title,
                url: href,
                snippet: snippet.substring(0, 300),
                source: 'sogou',
              });
            }
          }
        });
      }

      const limitedResults = results.slice(0, numResults);
      logger.info('sogou', `Found ${limitedResults.length} results`);
      return limitedResults;

    } catch (error) {
      this.handleError(error, 'search');
    }
  }

  private cleanSogouUrl(href: string): string {
    if (!href) return '';

    // 搜狗内部跳转链接，不处理（scrape 阶段会跟随重定向）
    if (href.startsWith('/') || href.includes('sogou.com')) {
      return href.startsWith('http') ? href : `https://www.sogou.com${href}`;
    }

    // 已经是完整 URL
    if (href.startsWith('http')) {
      return href;
    }

    return `https:${href}`;
  }
}
