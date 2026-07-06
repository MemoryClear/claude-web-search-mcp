// 结构化 metrics 收集器 — Prometheus 文本格式 + JSON 导出，零外部依赖

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  labels: Record<string, string>;
  buckets: Map<number, number>; // le boundary -> cumulative count
  count: number;
  sum: number;
}

export class MetricsCollector {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();
  private startedAt = Date.now();

  // ========== Counter ==========

  incCounter(name: string, labels: Record<string, string> = {}, delta = 1): void {
    const key = this.makeKey(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += delta;
    } else {
      this.counters.set(key, { value: delta, labels });
    }
  }

  // ========== Histogram ==========

  observeHistogram(
    name: string,
    valueMs: number,
    labels: Record<string, string> = {}
  ): void {
    const key = this.makeKey(name, labels);
    let hist = this.histograms.get(key);
    if (!hist) {
      hist = { labels, buckets: new Map(), count: 0, sum: 0 };
      this.histograms.set(key, hist);
    }

    hist.count++;
    hist.sum += valueMs;

    // 累积计数
    for (const [le, cnt] of hist.buckets) {
      if (valueMs <= le) {
        hist.buckets.set(le, cnt + 1);
      }
    }
  }

  // 注册 histogram 桶边界（例如 [50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000]）
  registerHistogram(name: string, buckets: number[]): void {
    const key = this.makeKey(name, {});
    let hist = this.histograms.get(key);
    if (!hist) {
      hist = { labels: {}, buckets: new Map(), count: 0, sum: 0 };
      this.histograms.set(key, hist);
    }
    for (const b of buckets) {
      if (!hist.buckets.has(b)) hist.buckets.set(b, 0);
    }
  }

  // ========== 导出 Prometheus 文本格式 ==========

  toPrometheus(): string {
    const lines: string[] = [];
    const uptime = Math.floor((Date.now() - this.startedAt) / 1000);

    lines.push(`# HELP app_uptime_seconds Application uptime in seconds`);
    lines.push(`# TYPE app_uptime_seconds gauge`);
    lines.push(`app_uptime_seconds ${uptime}`);

    for (const [, c] of this.counters) {
      const name = `app_${this.sanitize(c.labels['name'] || 'counter')}_total`;
      const labels = this.formatLabels(c.labels);
      lines.push(`# HELP ${name} Counter`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${labels} ${c.value}`);
    }

    for (const [, h] of this.histograms) {
      if (h.count === 0) continue;
      const name = `app_${this.sanitize(h.labels['name'] || 'histogram')}_seconds`;
      const labels = this.formatLabels(h.labels);
      lines.push(`# HELP ${name} Histogram`);
      lines.push(`# TYPE ${name} histogram`);
      const sortedBuckets = [...h.buckets.entries()].sort((a, b) => a[0] - b[0]);
      for (const [le, cnt] of sortedBuckets) {
        lines.push(`${name}_bucket{le="${le}"${labels}} ${cnt}`);
      }
      lines.push(`${name}_bucket{le="+Inf"${labels}} ${h.count}`);
      lines.push(`${name}_sum${labels} ${(h.sum / 1000).toFixed(3)}`);
      lines.push(`${name}_count${labels} ${h.count}`);
    }

    return lines.join('\n');
  }

  // ========== JSON 导出 ==========

  toJSON(): object {
    return {
      uptime_ms: Date.now() - this.startedAt,
      counters: Object.fromEntries(
        [...this.counters.entries()].map(([k, c]) => [k, c.value])
      ),
      histograms: Object.fromEntries(
        [...this.histograms.entries()].map(([k, h]) => [k, {
          count: h.count,
          sum_ms: h.sum,
          avg_ms: h.count > 0 ? h.sum / h.count : 0,
        }])
      ),
    };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.startedAt = Date.now();
  }

  // ========== 内部 helpers ==========

  private makeKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).sort()
      .map(([k, v]) => `${k}="${v}"`).join(',');
    return `${name}{${labelStr}}`;
  }

  private formatLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `,${k}="${v}"`).join('');
  }

  private sanitize(s: string): string {
    return s.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}

// 全局单例
export const metrics = new MetricsCollector();
