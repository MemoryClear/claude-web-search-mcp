// Search provider exports and factory

import { SearchResult, SearchProvider } from '../types';
import { BingSearchProvider } from './bing';
import { BingCNProvider } from './bingCN';
import { DuckDuckGoSearchProvider } from './duckduckgo';
import { SerpApiSearchProvider } from './serpapi';
import { BaiduSearchProvider } from './baidu';
import { SogouProvider } from './sogou';
import { Zh360Provider } from './zh360';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
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

// ============ Provider 工厂 ============

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

  if (providers.length === 0) {
    logger.warn('providers', 'No providers enabled in config, using defaults');
    providers.push(new BaiduSearchProvider());
    providers.push(new DuckDuckGoSearchProvider());
  }

  return providers;
}

let providerInstances: SearchProvider[] | null = null;

export function getSearchProviders(): SearchProvider[] {
  if (providerInstances) return providerInstances;
  providerInstances = createProvidersFromConfig();
  return providerInstances;
}

export function resetProviderCache(): void {
  providerInstances = null;
}

// ============ 搜索策略分发 ============

export async function searchWithFallback(
  query: string,
  numResults: number
): Promise<{ results: SearchResult[]; provider: string; mode: string }> {
  const config = getConfig();
  const mode = config.search.strategy?.mode ?? 'priority';

  if (mode === 'parallel') {
    return { ...await searchParallel(query, numResults), mode };
  }
  return { ...await searchPriority(query, numResults), mode };
}

// ============ 策略1: 顺序 Priority (原有逻辑) ============

async function searchPriority(
  query: string,
  numResults: number
): Promise<{ results: SearchResult[]; provider: string }> {
  const providers = getSearchProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.isEnabled()) {
      logger.debug('providers', `${provider.name} is disabled`);
      continue;
    }

    try {
      logger.info('providers', `Trying provider: ${provider.name}`);
      const results = await provider.search(query, numResults);

      if (results.length > 0) {
        metrics.incCounter('search_requests_total', { name: 'search', status: 'ok', mode: 'priority', provider: provider.name });
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

  metrics.incCounter('search_requests_total', { name: 'search', status: 'error', mode: 'priority' });
  throw new Error(`All search providers failed: ${errors.join('; ')}`);
}

// ============ 策略2: 并行 Parallel (新增) ============

async function searchParallel(
  query: string,
  numResults: number
): Promise<{ results: SearchResult[]; provider: string }> {
  const config = getConfig();
  const providers = getSearchProviders().filter(p => p.isEnabled());
  const timeout = config.search.strategy?.timeout_ms ?? 15000;

  if (providers.length === 0) {
    throw new Error('No enabled search providers');
  }

  logger.info('providers', `Parallel mode: launching ${providers.length} providers`);

  // 用 Promise.allSettled 并行执行所有 provider
  const settled = await Promise.allSettled(
    providers.map(p => p.search(query, numResults))
  );

  // 收集成功结果
  const allResults: Array<{ result: SearchResult; provider: string }> = [];
  const failedProviders: string[] = [];

  settled.forEach((outcome, i) => {
    const provider = providers[i];
    if (outcome.status === 'fulfilled' && outcome.value.length > 0) {
      for (const r of outcome.value) {
        allResults.push({ result: r, provider: provider.name });
      }
      logger.info('providers', `${provider.name}: ${outcome.value.length} results`);
    } else if (outcome.status === 'rejected') {
      failedProviders.push(`${provider.name}: ${outcome.reason}`);
      logger.warn('providers', `${provider.name} failed: ${outcome.reason}`);
    } else {
      failedProviders.push(`${provider.name}: empty results`);
    }
  });

  if (allResults.length === 0) {
    metrics.incCounter('search_requests_total', { name: 'search', status: 'error', mode: 'parallel' });
    throw new Error(`All providers failed: ${failedProviders.join('; ')}`);
  }

  // 结果去重 + 排序
  const deduplicated = deduplicateResults(allResults);
  const limited = deduplicated.slice(0, numResults);

  // 汇总使用的 provider 信息
  const usedProviders = [...new Set(allResults.map(r => r.provider))];
  const providerTag = usedProviders.length > 1
    ? `parallel:${usedProviders.join('+')}`
    : usedProviders[0];

  metrics.incCounter('search_requests_total', { name: 'search', status: 'ok', mode: 'parallel', providers: usedProviders.join('+') });
  logger.info('providers', `Parallel done: ${limited.length}/${allResults.length} unique results from ${usedProviders.length} provider(s)`);

  return { results: limited, provider: providerTag };
}

// ============ 去重逻辑 ============

function deduplicateResults(
  ranked: Array<{ result: SearchResult; provider: string }>
): SearchResult[] {
  const config = getConfig();
  if (!config.search.strategy?.deduplication) {
    return ranked.map(r => r.result);
  }

  const seen = new Set<string>();
  const out: SearchResult[] = [];

  for (const { result } of ranked) {
    // 主键: 规范化后的 URL
    const normalizedUrl = normalizeUrl(result.url);
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    out.push(result);
  }

  return out;
}

// 简单 URL 规范化：去除 utm_ 参数、尾部斜杠
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // 去除跟踪参数
    const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source'];
    for (const p of stripParams) u.searchParams.delete(p);
    // 去除尾部斜杠
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
