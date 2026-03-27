// Web Search Tool implementation (对标 Firecrawl)
// 支持两种模式：基础搜索（URL列表）和搜索+抓取（完整文章内容）

import { SearchResult, ToolDefinition } from '../types';
import { searchWithFallback } from '../providers';
import { scrapeUrl } from '../utils/html';
import { logger } from '../utils/logger';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web and optionally retrieve full page content from results. Similar to Firecrawl search API. Returns search results with titles, URLs, descriptions. When fetch_content is true, also scrapes and returns full markdown content from top results. Use this when you need current information, facts, or to read articles from the web.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific and include key terms for better results.',
      },
      num_results: {
        type: 'number',
        description: 'Number of search results to return (default: 5, max: 10). When fetch_content is true, only top results are scraped.',
        default: 5,
      },
      fetch_content: {
        type: 'boolean',
        description: 'If true, scrape and return full markdown content from the top search results (default: false). Equivalent to Firecrawl scrapeOptions.formats:["markdown"].',
        default: false,
      },
      scrape_limit: {
        type: 'number',
        description: 'When fetch_content is true, how many top results to scrape (default: 3, max: 5). Controls how many pages are fetched for full content.',
        default: 3,
      },
    },
    required: ['query'],
  },
};

export async function handleWebSearch(
  args: {
    query: string;
    num_results?: number;
    fetch_content?: boolean;
    scrape_limit?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { query, num_results = 5, fetch_content = false, scrape_limit = 3 } = args;

  logger.info('tool', `web_search called: "${query}" (fetch_content=${fetch_content})`);

  try {
    // 1. 搜索
    const searchLimit = Math.min(Math.max(1, Number(num_results)), 10);
    const { results, provider } = await searchWithFallback(query, searchLimit);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No results found for "${query}". Try a different query.` }],
      };
    }

    // 2. 如果不需要抓取内容，直接返回搜索结果
    if (!fetch_content) {
      const formatted = formatSearchResults(results, provider);
      return {
        content: [{ type: 'text', text: formatted }],
      };
    }

    // 3. 搜索 + 抓取模式：对前 N 个结果抓取完整内容
    const limit = Math.min(Math.max(1, Number(scrape_limit)), 5);
    const topResults = results.slice(0, limit);

    logger.info('tool', `Scraping content from ${topResults.length} results...`);

    const scrapedResults = [];
    for (const result of topResults) {
      try {
        logger.info('tool', `Scraping: ${result.url}`);
        const scraped = await scrapeUrl(result.url, {
          extractLinks: false,
          extractImages: false,
        });
        scrapedResults.push({
          title: scraped.title,
          url: scraped.url,
          description: scraped.metadata.description || result.snippet,
          content: scraped.content,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Scrape failed';
        logger.warn('tool', `Failed to scrape ${result.url}: ${msg}`);
        scrapedResults.push({
          title: result.title,
          url: result.url,
          description: result.snippet,
          content: '',
          error: msg,
        });
      }
    }

    // 4. 格式化完整输出（对标 Firecrawl 格式）
    const formatted = formatSearchWithContent(results, scrapedResults, provider);
    return {
      content: [{ type: 'text', text: formatted }],
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('tool', `web_search failed: ${message}`);
    return {
      content: [{ type: 'text', text: `Search failed: ${message}. Please try again.` }],
    };
  }
}

function formatSearchResults(results: SearchResult[], provider: string): string {
  const lines = [
    `## Search Results (via ${provider})`,
    '',
    ...results.map((r, i) => [
      `${i + 1}. **${r.title}**`,
      `   URL: ${r.url}`,
      r.snippet ? `   ${r.snippet}` : '',
      '',
    ].filter(Boolean).flat()),
  ];
  return lines.join('\n');
}

function formatSearchWithContent(
  allResults: SearchResult[],
  scrapedResults: Array<{
    title: string;
    url: string;
    description: string;
    content: string;
    error?: string;
  }>,
  provider: string
): string {
  const lines: string[] = [];

  // 摘要
  lines.push(`## Search + Scrape Results (via ${provider})`);
  lines.push(`Query returned ${allResults.length} results, ${scrapedResults.length} scraped for full content.`);
  lines.push('');

  // 有内容的搜索结果
  for (let i = 0; i < scrapedResults.length; i++) {
    const r = scrapedResults[i];
    lines.push(`---`);
    lines.push(`### ${i + 1}. ${r.title}`);
    lines.push(`**URL:** ${r.url}`);
    if (r.description) lines.push(`**Description:** ${r.description}`);
    if (r.error) {
      lines.push(`**⚠️ Scrape Error:** ${r.error}`);
      lines.push('');
    } else if (r.content) {
      lines.push('');
      lines.push(r.content);
      lines.push('');
    }
  }

  // 剩余的未抓取结果
  const remaining = allResults.slice(scrapedResults.length);
  if (remaining.length > 0) {
    lines.push(`---`);
    lines.push(`### Additional Results (not scraped)`);
    lines.push('');
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      lines.push(`${scrapedResults.length + i + 1}. **${r.title}**`);
      lines.push(`   URL: ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
