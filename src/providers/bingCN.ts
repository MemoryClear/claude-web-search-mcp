import { SearchResult, SearchProvider as SearchProviderInterface } from '../types';
import { logger } from '../utils/logger';

export class BingCNProvider implements SearchProviderInterface {
  name = 'bingCN';
  
  async search(query: string, numResults: number = 10): Promise<SearchResult[]> {
    try {
      const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN&count=${numResults}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const html = await response.text();
      const results: SearchResult[] = [];
      
      // Bing 中文结果提取
      const sections = html.split('class="b_algo"');
      
      for (let i = 1; i < sections.length && i <= numResults; i++) {
        const section = sections[i];
        
        const titleMatch = section.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([^<]*)</i);
        const snippetMatch = section.match(/class="["']*b_caption["']*[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
        
        if (titleMatch) {
          const snippet = snippetMatch 
            ? snippetMatch[1].replace(/<[^>]*>/g, '').trim().substring(0, 200)
            : '';
          
          results.push({
            title: titleMatch[2].trim(),
            url: titleMatch[1],
            snippet: snippet,
            source: 'bingCN'
          });
        }
      }

      logger.info('bingCN', `Found ${results.length} results for "${query}"`);
      return results;
      
    } catch (error) {
      logger.error('bingCN', `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  isEnabled(): boolean {
    return true;
  }
}
