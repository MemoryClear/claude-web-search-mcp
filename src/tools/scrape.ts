// Web Scrape Tool implementation

import { ToolDefinition } from '../types';
import { scrapeUrl } from '../utils/html';
import { logger } from '../utils/logger';

export const webScrapeTool: ToolDefinition = {
  name: 'web_scrape',
  description: 'Fetch and extract the main content from a web page. Returns the page title, cleaned text content, links, images, and metadata. Use this to read articles, extract information from specific URLs, or get detailed content from web pages.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL of the web page to scrape (must start with http:// or https://)',
      },
      extract_links: {
        type: 'boolean',
        description: 'Whether to extract links from the page (default: true)',
        default: true,
      },
      extract_images: {
        type: 'boolean',
        description: 'Whether to extract image URLs from the page (default: true)',
        default: true,
      },
    },
    required: ['url'],
  },
};

export async function handleWebScrape(
  args: { url: string; extract_links?: boolean; extract_images?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { url, extract_links = true, extract_images = true } = args;
  
  logger.info('tool', `web_scrape called: "${url}"`);

  // Validate URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid URL: "${url}". URLs must start with http:// or https://`,
        },
      ],
    };
  }

  try {
    const result = await scrapeUrl(url, {
      extractLinks: extract_links,
      extractImages: extract_images,
    });

    const formattedResult = formatScrapeResult(result);
    
    return {
      content: [
        {
          type: 'text',
          text: formattedResult,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('tool', `web_scrape failed: ${message}`);
    
    return {
      content: [
        {
          type: 'text',
          text: `Failed to scrape "${url}": ${message}`,
        },
      ],
    };
  }
}

function formatScrapeResult(result: {
  url: string;
  title: string;
  content: string;
  links: string[];
  images: string[];
  metadata: { description?: string; author?: string; published?: string };
}): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push('');
  lines.push(`**Source:** ${result.url}`);
  lines.push('');

  // Metadata
  if (result.metadata.description || result.metadata.author || result.metadata.published) {
    lines.push('**Metadata:**');
    if (result.metadata.description) {
      lines.push(`- Description: ${result.metadata.description}`);
    }
    if (result.metadata.author) {
      lines.push(`- Author: ${result.metadata.author}`);
    }
    if (result.metadata.published) {
      lines.push(`- Published: ${result.metadata.published}`);
    }
    lines.push('');
  }

  // Content
  lines.push('## Content');
  lines.push('');
  lines.push(result.content);
  lines.push('');

  // Links (if any)
  if (result.links.length > 0) {
    lines.push(`## Links (${result.links.length})`);
    lines.push('');
    result.links.slice(0, 10).forEach(link => {
      lines.push(`- ${link}`);
    });
    if (result.links.length > 10) {
      lines.push(`- ... and ${result.links.length - 10} more`);
    }
    lines.push('');
  }

  // Images (if any)
  if (result.images.length > 0) {
    lines.push(`## Images (${result.images.length})`);
    lines.push('');
    result.images.slice(0, 5).forEach(img => {
      lines.push(`- ${img}`);
    });
    if (result.images.length > 5) {
      lines.push(`- ... and ${result.images.length - 5} more`);
    }
  }

  return lines.join('\n');
}
