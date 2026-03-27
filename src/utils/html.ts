// Web scraping utility

import { ScrapeResult } from '../types';
import { logger } from '../utils/logger';
import { load, CheerioAPI } from 'cheerio';
import { getConfig } from '../config';

export async function scrapeUrl(
  url: string,
  options: { extractLinks?: boolean; extractImages?: boolean } = {}
): Promise<ScrapeResult> {
  const config = getConfig();
  const { extractLinks = true, extractImages = true } = options;

  logger.info('scrape', `Fetching: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.scraping.timeout_ms);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.scraping.user_agent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Remove noise elements
    for (const selector of config.scraping.remove_selectors) {
      try {
        $(selector).remove();
      } catch {
        // Ignore invalid selectors
      }
    }

    // Extract title
    const title = $('title').text().trim() || 
                  $('h1').first().text().trim() || 
                  'Untitled';

    // Extract main content
    const content = extractMainContent($);

    // Extract links
    const links: string[] = [];
    if (extractLinks) {
      $('a[href^="http"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && !href.includes('javascript:') && !href.includes('#')) {
          links.push(href);
        }
      });
    }

    // Extract images
    const images: string[] = [];
    if (extractImages) {
      $('img[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src && src.startsWith('http')) {
          images.push(src);
        }
      });
    }

    // Extract metadata
    const metadata = extractMetadata($);

    const result: ScrapeResult = {
      url,
      title,
      content,
      links: [...new Set(links)].slice(0, 50), // Dedupe and limit
      images: [...new Set(images)].slice(0, 20),
      metadata,
    };

    logger.info('scrape', `Successfully scraped: ${title}`);
    return result;

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('scrape', `Timeout fetching: ${url}`);
      throw new Error(`Timeout fetching: ${url}`);
    }
    logger.error('scrape', `Failed to scrape ${url}:`, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractMainContent($: CheerioAPI): string {
  // Try to find main content area
  const contentSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#content',
    '.post',
    '.article',
  ];

  for (const selector of contentSelectors) {
    const content = $(selector).first();
    if (content.length > 0) {
      const text = content.text().trim();
      const config = getConfig();
      if (text.length > 100) {
        return truncateText(text, config.scraping.max_content_length);
      }
    }
  }

  // Fallback: body content
  const bodyText = $('body').text().trim();
  const config = getConfig();
  return truncateText(bodyText, config.scraping.max_content_length);
}

function extractMetadata($: CheerioAPI): ScrapeResult['metadata'] {
  const metadata: ScrapeResult['metadata'] = {};

  // Meta tags
  const metaDescription = $('meta[name="description"]').attr('content') ||
                          $('meta[property="og:description"]').attr('content');
  if (metaDescription) {
    metadata.description = metaDescription.trim();
  }

  const author = $('meta[name="author"]').attr('content') ||
                 $('meta[property="article:author"]').attr('content');
  if (author) {
    metadata.author = author.trim();
  }

  const published = $('meta[property="article:published_time"]').attr('content') ||
                    $('time[datetime]').attr('datetime');
  if (published) {
    metadata.published = published.trim();
  }

  return metadata;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...[truncated]';
}
