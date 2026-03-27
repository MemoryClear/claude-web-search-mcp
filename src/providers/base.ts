// Base class for search providers

import { SearchResult, SearchProvider as SearchProviderType } from '../types';
import { logger } from '../utils/logger';

export abstract class BaseSearchProvider implements SearchProviderType {
  abstract name: string;
  
  abstract search(query: string, numResults: number): Promise<SearchResult[]>;
  
  isEnabled(): boolean {
    return true;
  }
  
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 10000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
  
  protected sanitizeQuery(query: string): string {
    // Remove special characters that might break search URLs
    return encodeURIComponent(query.trim());
  }
  
  protected handleError(error: unknown, context: string): never {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        logger.warn(`${this.name}`, `Request timeout in ${context}`);
        throw new Error(`${this.name} request timeout`);
      }
      logger.error(`${this.name}`, `Error in ${context}:`, error.message);
      throw new Error(`${this.name} failed: ${error.message}`);
    }
    logger.error(`${this.name}`, `Unknown error in ${context}`);
    throw new Error(`${this.name} failed: Unknown error`);
  }
}
