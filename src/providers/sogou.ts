import { SearchResult, SearchProvider as SearchProviderInterface } from '../types';
import { logger } from '../utils/logger';

export class SogouProvider implements SearchProviderInterface {
  name = 'sogou';
  
  async search(query: string, numResults: number = 10): Promise<SearchResult[]> {
    try {
      const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&num=${numResults}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      const results: SearchResult[] = [];
      
      // 提取搜索结果
      const titleMatches = html.match(/<a[^>]*class="["']*vrTitle["']*[^>]*href="([^"]*)"[^>]*>([^<]*)</gi);
      const snippetMatches = html.match(/<span class="["']*s3["']*[^>]*>([^<]*)</gi);
      
      if (titleMatches) {
        for (let i = 0; i < titleMatches.length && i < numResults; i++) {
          const titleMatch = titleMatches[i];
          const urlMatch = titleMatch.match(/href="([^"]*)"/);
          const textMatch = titleMatch.match(/>([^<]*)</);
          
          const snippet = snippetMatches && snippetMatches[i] ? 
            snippetMatches[i].replace(/<[^>]*>/g, '').trim() : '';
          
          if (urlMatch && textMatch) {
            results.push({
              title: textMatch[1].trim(),
              url: urlMatch[1].startsWith('http') ? urlMatch[1] : `https:${urlMatch[1]}`,
              snippet: snippet.substring(0, 200),
              source: 'sogou'
            });
          }
        }
      }

      logger.info('sogou', `Found ${results.length} results for "${query}"`);
      return results;
      
    } catch (error) {
      logger.error('sogou', `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  isEnabled(): boolean {
    return true;
  }
}
