// Sliding-window rate limiter — 无内存泄漏
// 原理：以时间戳为 key，每次请求只记一个戳，过期戳自动失效
// 清理策略：读请求触发惰性清理（最多清理到比当前时间早 2 个 window 的条目）

import { getConfig } from '../config';
import { logger } from './logger';

interface WindowEntry {
  timestamps: number[];
}

export function createRateLimiter() {
  const store = new Map<string, WindowEntry>();

  // 惰性清理：只清理比 now - 2*window 更老的条目
  function cleanup(key: string, now: number, windowMs: number) {
    const entry = store.get(key);
    if (!entry) return;

    const cutoff = now - windowMs * 2;
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);

    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }

  function isAllowed(ip: string): { allowed: boolean; remaining: number; resetMs: number } {
    const config = getConfig();
    const { window_ms, max_requests } = config.security.rate_limit;
    const now = Date.now();
    const windowStart = now - window_ms;

    // 惰性清理（每 10 次请求主动触发一次）
    if (Math.random() < 0.1) {
      for (const [k] of store) {
        cleanup(k, now, window_ms);
      }
    } else {
      cleanup(ip, now, window_ms);
    }

    const entry = store.get(ip);
    if (!entry) {
      return { allowed: true, remaining: max_requests - 1, resetMs: window_ms };
    }

    // 窗口内有效请求
    const active = entry.timestamps.filter(t => t > windowStart);
    if (active.length >= max_requests) {
      const oldestActive = active[0];
      const resetMs = oldestActive + window_ms - now;
      logger.warn('ratelimit', `Rate limit exceeded for ${ip}, resets in ${resetMs}ms`);
      return { allowed: false, remaining: 0, resetMs };
    }

    // 允许，更新时间戳
    active.push(now);
    store.set(ip, { timestamps: active });

    return { allowed: true, remaining: max_requests - active.length, resetMs: window_ms };
  }

  return { isAllowed };
}
