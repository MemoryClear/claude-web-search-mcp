// Search provider exports and factory

import { SearchProvider } from '../types';
import { BingSearchProvider } from './bing';
import { BingCNProvider } from './bingCN';
import { DuckDuckGoSearchProvider } from './duckduckgo';
import { SerpApiSearchProvider } from './serpapi';
import { BaiduSearchProvider } from './baidu';
import { SogouProvider } from './sogou';
import { Zh360Provider } from './zh360';
import { logger } from '../utils/logger';
import { getConfig } from '../config';

// 导出所有 Provider
export { BingSearchProvider } from './bing';
export { BingCNProvider } from './bingCN';
export { DuckDuckGoSearchProvider } from './duckduckgo';
export { SerpApiSearchProvider } from './serpapi';
export { BaiduSearchProvider } from './baidu';
export { SogouProvider } from './sogou';
export { Zh360Provider } from './zh360';
export { BaseSearchProvider } from './base';

export type { SearchProvider };

// 根据 config.yaml 创建 providers
function createProvidersFromConfig(): SearchProvider[] {
  const config = getConfig();
  
  const providerMap: Record<string, () => SearchProvider> = {
    baidu: () => new BaiduSearchProvider(),
    duckduckgo: () => new DuckDuckGoSearchProvider(),
    bing: () => new BingSearchProvider(),
    bingCN: () => new BingCNProvider(),
    serpapi: () => new SerpApiSearchProvider(),
    sogou: () => new SogouProvider(),
    zh360: () => new Zh360Provider(),
  };

  const providers: SearchProvider[] = [];

  for (const p of config.search.providers) {
    const factory = providerMap[p.name];
    if (factory && p.enabled) {
      const provider = factory();
      providers.push(provider);
      logger.info('providers', `Registered: ${p.name} (enabled)`);
    }
  }

  // 如果没有任何启用的 provider，使用默认
  if (providers.length === 0) {
    logger.warn('providers', 'No providers enabled in config, using defaults');
    providers.push(new BaiduSearchProvider());
    providers.push(new DuckDuckGoSearchProvider());
  }

  return providers;
}

let providerInstances: SearchProvider[] | null = null;

export function getSearchProviders(): SearchProvider[] {
  if (providerInstances) {
    return providerInstances;
  }

  providerInstances = createProvidersFromConfig();
  return providerInstances;
}

export function getFirstAvailableProvider(): SearchProvider | null {
  const providers = getSearchProviders();
  
  for (const provider of providers) {
    if (provider.isEnabled()) {
      logger.info('providers', `Selected provider: ${provider.name}`);
      return provider;
    }
  }
  
  return null;
}

export async function searchWithFallback(
  query: string,
  numResults: number
): Promise<{ results: any[]; provider: string }> {
  const providers = getSearchProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.isEnabled()) {
      logger.debug('providers', `${provider.name} is disabled or not configured`);
      continue;
    }

    try {
      logger.info('providers', `Trying provider: ${provider.name}`);
      const results = await provider.search(query, numResults);
      
      if (results.length > 0) {
        return { results, provider: provider.name };
      }
      
      logger.warn('providers', `${provider.name} returned empty results`);
      errors.push(`${provider.name}: empty results`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('providers', `${provider.name} failed: ${msg}`);
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  throw new Error(`All search providers failed: ${errors.join('; ')}`);
}

export function resetProviderCache(): void {
  providerInstances = null;
}
