// SerpAPI Provider (Google Search via SerpAPI)

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { getConfig } from '../config';

export class SerpApiSearchProvider extends BaseSearchProvider {
  name = 'serpapi';
  private apiKey: string | null = null;

  constructor() {
    super();
    const config = getConfig();
    const provider = config.search.providers.find(p => p.name === 'serpapi');
    if (provider?.api_key) {
      this.apiKey = provider.api_key;
    }
  }

  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    if (!this.isEnabled()) {
      throw new Error('SerpAPI key not configured');
    }

    const encodedQuery = this.sanitizeQuery(query);
    const url = `https://serpapi.com/search.json?q=${encodedQuery}&api_key=${this.apiKey}&num=${numResults}`;

    try {
      logger.info('serpapi', `Searching: ${query}`);
      
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('serpapi', `API error ${response.status}: ${errorText}`);
        throw new Error(`SerpAPI error: ${response.status}`);
      }

      const data = await response.json() as {
        organic_results?: Array<{
          title: string;
          link: string;
          snippet: string;
        }>;
      };

      const results: SearchResult[] = (data.organic_results || []).map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: 'serpapi',
      }));

      logger.info('serpapi', `Found ${results.length} results`);
      return results;
    } catch (error) {
      this.handleError(error, 'search');
    }
  }
}
