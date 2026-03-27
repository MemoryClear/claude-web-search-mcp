// Bing Search API Provider

import { SearchResult } from '../types';
import { BaseSearchProvider } from './base';
import { logger } from '../utils/logger';
import { getConfig } from '../config';

export class BingSearchProvider extends BaseSearchProvider {
  name = 'bing';
  private apiKey: string | null = null;

  constructor() {
    super();
    const config = getConfig();
    const provider = config.search.providers.find(p => p.name === 'bing');
    if (provider?.api_key) {
      this.apiKey = provider.api_key;
    }
  }

  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    if (!this.isEnabled()) {
      throw new Error('Bing API key not configured');
    }

    const encodedQuery = this.sanitizeQuery(query);
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodedQuery}&count=${numResults}&responseFilter=WebPages`;

    try {
      logger.info('bing', `Searching: ${query}`);
      
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey!,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('bing', `API error ${response.status}: ${errorText}`);
        throw new Error(`Bing API error: ${response.status}`);
      }

      const data = await response.json() as {
        webPages?: {
          value?: Array<{
            name: string;
            url: string;
            snippet: string;
          }>;
        };
      };

      const results: SearchResult[] = (data.webPages?.value || []).map(item => ({
        title: item.name,
        url: item.url,
        snippet: item.snippet,
        source: 'bing',
      }));

      logger.info('bing', `Found ${results.length} results`);
      return results;
    } catch (error) {
      this.handleError(error, 'search');
    }
  }
}
