// DuckDuckGo HTML Search Provider (free, no API key required)

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { load } from 'cheerio';
import { getConfig } from '../config';

export class DuckDuckGoSearchProvider extends BaseSearchProvider {
  name = 'duckduckgo';

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const encodedQuery = this.sanitizeQuery(query);
    const config = getConfig();
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=wt-wt`;

    try {
      logger.info('duckduckgo', `Searching: ${query}`);
      
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': config.scraping.user_agent,
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, config.scraping.timeout_ms);

      if (!response.ok) {
        logger.error('duckduckgo', `HTTP error: ${response.status}`);
        throw new Error(`DuckDuckGo HTTP error: ${response.status}`);
      }

      const html = await response.text();
      const $ = load(html);

      const results: SearchResult[] = [];
      
      // DuckDuckGo HTML results structure
      $('.result').each((_, element) => {
        const $el = $(element);
        const title = $el.find('.result__a').text().trim();
        const url = $el.find('.result__a').attr('href') || '';
        const snippet = $el.find('.result__snippet').text().trim();
        
        if (title && url) {
          results.push({
            title,
            url,
            snippet,
            source: 'duckduckgo',
          });
        }
      });

      // If no results from .result class, try alternative selectors
      if (results.length === 0) {
        $('a[href^="http"]').each((_, element) => {
          const $el = $(element);
          const href = $el.attr('href') || '';
          const text = $el.text().trim();
          
          // Filter out navigation links
          if (href.startsWith('http') && text.length > 10 && !href.includes('duckduckgo')) {
            results.push({
              title: text.substring(0, 100),
              url: href,
              snippet: '',
              source: 'duckduckgo',
            });
          }
        });
      }

      const limitedResults = results.slice(0, numResults);
      logger.info('duckduckgo', `Found ${limitedResults.length} results`);
      return limitedResults;

    } catch (error) {
      this.handleError(error, 'search');
    }
  }
}
