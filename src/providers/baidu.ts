// Baidu Search Provider - 国内直接可用，无需 API Key

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { load } from 'cheerio';
import { getConfig } from '../config';

export class BaiduSearchProvider extends BaseSearchProvider {
  name = 'baidu';

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const encodedQuery = this.sanitizeQuery(query);
    const config = getConfig();
    const url = `https://www.baidu.com/s?wd=${encodedQuery}&rn=${numResults}&pn=0`;

    try {
      logger.info('baidu', `Searching: ${query}`);
      
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': config.scraping.user_agent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'utf-8',
        },
      }, config.scraping.timeout_ms * 2);

      if (!response.ok) {
        logger.error('baidu', `HTTP error: ${response.status}`);
        throw new Error(`Baidu HTTP error: ${response.status}`);
      }

      // 使用 arrayBuffer 获取原始字节，避免编码问题
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      const html = decoder.decode(buffer);

      const $ = load(html);

      const results: SearchResult[] = [];

      // 百度搜索结果 - 多种选择器兼容
      const selectors = [
        'div.result',           // 标准结果
        'div.c-container',      // 容器
        'div[tpl]',             // 模板结果
      ];

      for (const selector of selectors) {
        $(selector).each((_, element) => {
          const $el = $(element);
          
          // 跳过广告和特殊结果
          if ($el.find('.ec_wise_ad, .ec_youxuan').length > 0) return;
          
          // 标题
          const $title = $el.find('h3 a, h3');
          const title = $title.text().trim();
          
          // 链接 - 优先取 data-url 或 mu 属性（真实 URL）
          let href = $el.find('h3 a').attr('href') || 
                     $el.find('h3 a').attr('data-url') ||
                     $el.attr('mu') || '';
          
          // 摘要
          let snippet = $el.find('.c-abstract').text().trim() ||
                        $el.find('.c-color-text').first().text().trim() ||
                        $el.find('.c-span9').text().trim() ||
                        $el.find('.content-right_8Zs40').text().trim() || '';
          
          // 清理 snippet 中的 HTML 实体和多余空白
          snippet = snippet.replace(/\s+/g, ' ').trim();

          if (title && href) {
            // 去除百度跳转链接，尝试提取真实 URL
            const realUrl = this.cleanBaiduUrl(href);
            
            results.push({
              title,
              url: realUrl,
              snippet,
              source: 'baidu',
            });
          }
        });

        // 如果找到了结果就不再尝试其他选择器
        if (results.length > 0) break;
      }

      // 如果上面的方法没找到结果，用更宽松的方式
      if (results.length === 0) {
        $('h3 a').each((_, element) => {
          const $el = $(element);
          const title = $el.text().trim();
          const href = $el.attr('href') || '';
          const realUrl = this.cleanBaiduUrl(href);

          if (title && realUrl && realUrl.startsWith('http')) {
            results.push({
              title,
              url: realUrl,
              snippet: '',
              source: 'baidu',
            });
          }
        });
      }

      const limitedResults = results.slice(0, numResults);
      logger.info('baidu', `Found ${limitedResults.length} results`);
      return limitedResults;

    } catch (error) {
      this.handleError(error, 'search');
    }
  }

  private cleanBaiduUrl(href: string): string {
    if (!href) return '';
    
    // 如果是百度跳转链接，返回百度链接本身（scrape 时会跟随重定向）
    if (href.includes('baidu.com/link')) {
      return href;
    }
    
    // 清理多余参数
    try {
      const url = new URL(href);
      return url.origin + url.pathname;
    } catch {
      return href;
    }
  }
}
