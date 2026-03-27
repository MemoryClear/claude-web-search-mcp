// 日志模块 - 支持终端彩色输出 + 文件纯文本输出

import * as fs from 'fs';
import * as path from 'path';
import { getConfig, LoggingConfig } from '../config';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

// ANSI 颜色
const C = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bright: '\x1b[1m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: C.dim,
  [LogLevel.INFO]:  C.green,
  [LogLevel.WARN]:  C.yellow,
  [LogLevel.ERROR]: C.red,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]:  'INFO ',
  [LogLevel.WARN]:  'WARN ',
  [LogLevel.ERROR]: 'ERROR',
};

let currentConfig: LoggingConfig | null = null;
let logFilePath: string | null = null;

function getConfigInternal(): LoggingConfig {
  if (!currentConfig) {
    currentConfig = getConfig().logging;
  }
  return currentConfig;
}

function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

// 去除 ANSI 颜色码
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// 格式化时间戳（上海时区）
function formatTimestamp(): string {
  const now = new Date();
  const shanghaiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return shanghaiTime.toISOString().replace('T', ' ').substring(0, 19);
}

// 格式化持续时间
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

// 初始化日志文件路径
function initLogPath(): string | null {
  if (logFilePath) return logFilePath;
  
  try {
    const config = getConfigInternal();
    if (!config.file?.enabled) return null;
    
    logFilePath = path.resolve(config.file.path || './logs/app.log');
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return logFilePath;
  } catch {
    return null;
  }
}

// 写入文件（同步，确保写入）
function writeToFile(line: string): void {
  const fp = initLogPath();
  if (!fp) return;
  
  try {
    // 使用低级 API 确保写入
    const fd = fs.openSync(fp, 'a');
    fs.writeSync(fd, stripAnsi(line) + '\n');
    fs.closeSync(fd);
  } catch {
    // 静默失败
  }
}

function shouldLog(level: LogLevel): boolean {
  const configLevel = LOG_LEVEL_MAP[getConfigInternal().level] ?? LogLevel.INFO;
  return level >= configLevel;
}

function output(level: LogLevel, prefix: string, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;

  const ts = formatTimestamp();
  const levelName = LEVEL_NAMES[level];
  const formattedMsg = args.length > 0
    ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`
    : message;

  // 终端输出（带颜色）
  const color = LEVEL_COLORS[level];
  const termLine = isTTY()
    ? `${C.dim}[${ts}]${C.reset} ${color}${levelName}${C.reset} ${C.cyan}[${prefix}]${C.reset} ${formattedMsg}`
    : `[${ts}] ${levelName} [${prefix}] ${formattedMsg}`;

  if (level === LogLevel.ERROR) {
    process.stderr.write(termLine + '\n');
  } else {
    process.stdout.write(termLine + '\n');
  }

  // 文件输出（纯文本）
  writeToFile(`[${ts}] ${levelName} [${prefix}] ${formattedMsg}`);
}

// ============ 主要日志接口 ============

export const logger = {
  debug: (prefix: string, message: string, ...args: unknown[]) =>
    output(LogLevel.DEBUG, prefix, message, ...args),

  info: (prefix: string, message: string, ...args: unknown[]) =>
    output(LogLevel.INFO, prefix, message, ...args),

  warn: (prefix: string, message: string, ...args: unknown[]) =>
    output(LogLevel.WARN, prefix, message, ...args),

  error: (prefix: string, message: string, ...args: unknown[]) =>
    output(LogLevel.ERROR, prefix, message, ...args),

  setLevel: (level: 'debug' | 'info' | 'warn' | 'error') => {
    if (currentConfig) currentConfig.level = level;
  },

  refreshConfig: () => {
    currentConfig = null;
    logFilePath = null;
  },
};

// ============ 审计日志 ============

export function auditLog(
  ip: string,
  method: string,
  urlPath: string,
  statusCode: number,
  durationMs: number,
  body?: string
): void {
  const config = getConfigInternal();
  if (!config.audit?.enabled) return;

  const ts = formatTimestamp();
  const duration = formatDuration(durationMs);
  const statusStr = String(statusCode);

  // 终端输出（带颜色）
  const statusColor = statusCode >= 400 ? C.red : C.green;
  const termLine = isTTY()
    ? `${C.dim}[${ts}]${C.reset} ${C.cyan}[AUDIT]${C.reset} ${ip} | ${method} ${urlPath} | ${statusColor}${statusStr}${C.reset} | ${C.yellow}${duration}${C.reset}`
    : `[${ts}] AUDIT [${ip}] ${method} ${urlPath} | ${statusStr} | ${duration}`;

  // 文件输出（纯文本）
  const fileLine = `[${ts}] AUDIT [${ip}] ${method} ${urlPath} | ${statusStr} | ${duration}`;

  if (statusCode >= 400 && config.audit.log_body_on_error && body) {
    const truncated = body.length > 200 ? body.substring(0, 200) + '...' : body;
    process.stderr.write(`${termLine}\n        Body: ${truncated}\n`);
    writeToFile(`${fileLine}\n        Body: ${truncated}`);
  } else {
    process.stdout.write(termLine + '\n');
    writeToFile(fileLine);
  }
}

// ============ 请求追踪 ============

export interface RequestTrace {
  id: string;
  ip: string;
  method: string;
  path: string;
  startTime: number;
  userAgent?: string;
}

export function startRequestTrace(ip: string, method: string, urlPath: string, userAgent?: string): RequestTrace {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  logger.info('request', `-> ${method} ${urlPath} from ${ip}`);
  return { id, ip, method, path: urlPath, startTime: Date.now(), userAgent };
}

export function endRequestTrace(trace: RequestTrace, statusCode: number, body?: string): void {
  auditLog(trace.ip, trace.method, trace.path, statusCode, Date.now() - trace.startTime, body);
}

// ============ 搜索日志 ============

export function logSearch(query: string, provider: string, resultsCount: number, durationMs: number): void {
  logger.info('search', `"${query.substring(0, 50)}" -> ${provider} -> ${resultsCount} results (${formatDuration(durationMs)})`);
}

export function logProviderFallback(fromProvider: string, toProvider: string, reason: string): void {
  logger.warn('search', `Provider ${fromProvider} failed: ${reason}, falling back to ${toProvider}`);
}

// ============ 安全日志 ============

export function logAuthFailure(ip: string, reason: string): void {
  logger.warn('security', `Auth failed from ${ip}: ${reason}`);
}

export function logRateLimitExceeded(ip: string, limit: number): void {
  logger.warn('security', `Rate limit exceeded for ${ip} (limit: ${limit}/min)`);
}

export function logIpBlocked(ip: string): void {
  logger.warn('security', `IP blocked: ${ip}`);
}

// ============ 启动日志 ============

export function logStartup(config: {
  host: string;
  port: number;
  apiKeySet: boolean;
  corsOrigin: string;
  rateLimit: string;
  forceHttps: boolean;
}): void {
  // 终端输出（带颜色）
  if (isTTY()) {
    process.stdout.write('\n');
    process.stdout.write(`${C.bright}${C.green}=================================================\n`);
    process.stdout.write(`  Claude Web Search MCP Server (中国极致版)\n`);
    process.stdout.write(`=================================================${C.reset}\n`);
    process.stdout.write(`  Listening:  http://${config.host}:${config.port}\n`);
    process.stdout.write(`  MCP:        http://${config.host}:${config.port}/mcp\n`);
    process.stdout.write(`  Health:     http://${config.host}:${config.port}/health\n`);
    process.stdout.write('\n');
    process.stdout.write(`${C.cyan}  Security:${C.reset}\n`);
    process.stdout.write(`  API Key:    ${config.apiKeySet ? C.green + '[OK] Configured' + C.reset : C.red + '[!!] NOT SET' + C.reset}\n`);
    process.stdout.write(`  CORS:       ${config.corsOrigin}\n`);
    process.stdout.write(`  Rate Limit: ${config.rateLimit}\n`);
    process.stdout.write(`  HTTPS:      ${config.forceHttps ? C.green + '[OK] Forced' + C.reset : '[--] Not enforced'}\n`);
    process.stdout.write('\n');
  } else {
    console.log('\n=================================================');
    console.log('  Claude Web Search MCP Server (中国极致版)');
    console.log('=================================================');
    console.log(`  Listening:  http://${config.host}:${config.port}`);
    console.log(`  MCP:        http://${config.host}:${config.port}/mcp`);
    console.log(`  Health:     http://${config.host}:${config.port}/health`);
    console.log('\n  Security:');
    console.log(`  API Key:    ${config.apiKeySet ? '[OK]' : '[!!]'}`);
    console.log(`  CORS:       ${config.corsOrigin}`);
    console.log(`  Rate Limit: ${config.rateLimit}`);
    console.log('\n');
  }

  // 写入文件
  writeToFile(`[${formatTimestamp()}] INFO  [startup] Claude Web Search MCP Server started on ${config.host}:${config.port}`);
}

export function logSecurityWarning(message: string): void {
  const line = `[!!] SECURITY WARNING: ${message}`;
  process.stdout.write(`\n${C.red}${C.bright}${line}${C.reset}\n\n`);
  writeToFile(`[${formatTimestamp()}] WARN  [security] ${message}`);
}
