import { SearchResult, SearchProvider as SearchProviderInterface } from '../types';
import { logger } from '../utils/logger';

export class Zh360Provider implements SearchProviderInterface {
  name = 'zh360';
  
  async search(query: string, numResults: number = 10): Promise<SearchResult[]> {
    try {
      const url = `https://www.so.com/s?ie=utf8&q=${encodeURIComponent(query)}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const html = await response.text();
      const results: SearchResult[] = [];
      
      // 360搜索结果提取
      const sections = html.split('class="res-list"');
      
      for (let i = 1; i < sections.length && i <= numResults; i++) {
        const section = sections[i];
        
        const titleMatch = section.match(/class="["']*res-title["']*[^>]*>([^<]*)</i);
        const urlMatch = section.match(/href="([^"]*)"[^>]*class=/i);
        const snippetMatch = section.match(/class="["']*res-desc["']*[^>]*>([^<]*)</i);
        
        if (titleMatch && urlMatch) {
          results.push({
            title: titleMatch[1].trim(),
            url: urlMatch[1],
            snippet: snippetMatch ? snippetMatch[1].trim().substring(0, 200) : '',
            source: 'zh360'
          });
        }
      }

      logger.info('zh360', `Found ${results.length} results for "${query}"`);
      return results;
      
    } catch (error) {
      logger.error('zh360', `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  isEnabled(): boolean {
    return true;
  }
}
