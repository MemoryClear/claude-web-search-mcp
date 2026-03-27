// 配置加载模块 - 支持 YAML 配置文件

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// ============ 配置类型定义 ============

export interface ServerConfig {
  port: number;
  host: string;
  api_key: string;
}

export interface SecurityConfig {
  rate_limit: {
    window_ms: number;
    max_requests: number;
  };
  allowed_ips: string[];
  force_https: boolean;
  cors: {
    enabled: boolean;
    origin: string;
  };
}

export interface SearchProviderConfig {
  name: string;
  enabled: boolean;
  api_key?: string;
}

export interface SearchStrategyConfig {
  mode: 'priority' | 'parallel';
  timeout_ms: number;
  deduplication: boolean;
}

export interface SearchConfig {
  providers: SearchProviderConfig[];
  strategy?: SearchStrategyConfig;
}

export interface ScrapingConfig {
  user_agent: string;
  timeout_ms: number;
  max_content_length: number;
  remove_selectors: string[];
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file: {
    enabled: boolean;
    path: string;
  };
  audit: {
    enabled: boolean;
    log_body_on_error: boolean;
  };
}

export interface Config {
  server: ServerConfig;
  security: SecurityConfig;
  search: SearchConfig;
  scraping: ScrapingConfig;
  logging: LoggingConfig;
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: Config = {
  server: {
    port: 3001,
    host: '0.0.0.0',
    api_key: 'your-secret-api-key',
  },
  security: {
    rate_limit: {
      window_ms: 60000,
      max_requests: 100,
    },
    allowed_ips: [],
    force_https: false,
    cors: {
      enabled: true,
      origin: '*',
    },
  },
  search: {
    providers: [
      { name: 'baidu', enabled: true },
      { name: 'sogou', enabled: true },
      { name: 'zh360', enabled: true },
      { name: 'duckduckgo', enabled: true },
    ],
    strategy: {
      mode: 'priority',
      timeout_ms: 15000,
      deduplication: true,
    },
  },
  scraping: {
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    timeout_ms: 10000,
    max_content_length: 100000,
    remove_selectors: ['script', 'style', 'nav', 'footer'],
  },
  logging: {
    level: 'info',
    file: {
      enabled: true,
      path: './logs/app.log',
    },
    audit: {
      enabled: true,
      log_body_on_error: true,
    },
  },
};

// ============ 配置加载逻辑 ============

let configCache: Config | null = null;

function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key], source[key] as Partial<T[Extract<keyof T, string>]>) as T[Extract<keyof T, string>];
      } else {
        result[key] = source[key] as T[Extract<keyof T, string>];
      }
    }
  }
  return result;
}

function findConfigFile(): string | null {
  const searchPaths = [
    process.env.CONFIG_PATH,
    path.join(process.cwd(), 'config.yaml'),
    path.join(__dirname, '..', 'config.yaml'),
    path.join(__dirname, '..', '..', 'config.yaml'),
  ].filter(Boolean) as string[];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function loadFromFile(filePath: string): Partial<Config> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.parse(content);
    return parsed || {};
  } catch (err) {
    console.error(`[config] Failed to parse ${filePath}:`, err);
    return {};
  }
}

export function loadConfig(configPath?: string): Config {
  if (configCache !== null) {
    return configCache;
  }

  const configFile = configPath || findConfigFile();

  if (configFile) {
    console.log(`[config] Loaded from: ${configFile}`);
    const userConfig = loadFromFile(configFile);
    configCache = deepMerge(DEFAULT_CONFIG, userConfig);
  } else {
    console.log('[config] Using default config (no config file found)');
    configCache = DEFAULT_CONFIG;
  }

  // 环境变量覆盖
  if (process.env.PORT) {
    configCache.server.port = parseInt(process.env.PORT, 10);
  }
  if (process.env.HOST) {
    configCache.server.host = process.env.HOST;
  }
  if (process.env.API_KEY) {
    configCache.server.api_key = process.env.API_KEY;
  }
  if (process.env.RATE_LIMIT_MAX) {
    configCache.security.rate_limit.max_requests = parseInt(process.env.RATE_LIMIT_MAX, 10);
  }
  if (process.env.ALLOWED_IPS) {
    configCache.security.allowed_ips = process.env.ALLOWED_IPS.split(',').map(ip => ip.trim());
  }

  return configCache;
}

export function getConfig(): Config {
  if (configCache === null) {
    return loadConfig();
  }
  return configCache;
}

export function reloadConfig(configPath?: string): Config {
  configCache = null;
  return loadConfig(configPath);
}

// 向后兼容
export function getSearchProviders() {
  return getConfig().search.providers;
}

export function getScrapingConfig() {
  return getConfig().scraping;
}
