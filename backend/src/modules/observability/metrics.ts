/**
 * Low-Cardinality In-Memory Metrics Registry (Phase 8.5)
 *
 * Provides a deterministic, fail-open metrics collection abstraction for
 * counters, histograms (latencies, token counts), and gauges.
 * Strictly prevents cardinality explosions by filtering allowed tag dimensions.
 */

import { HistogramSnapshot, MetricsSnapshot, MetricTagDefinition } from './types';

const ALLOWED_TAG_KEYS = new Set([
  'provider',
  'model',
  'channel',
  'status',
  'tool',
  'errorCategory',
  'stage',
  'strategy',
  'candidateType',
  'intent',
]);

const FORBIDDEN_TAG_KEYS = new Set([
  'userId',
  'user_id',
  'conversationId',
  'conversation_id',
  'messageId',
  'message_id',
  'prompt',
  'text',
  'phone',
  'email',
]);

export class MetricsCollector {
  private static instance: MetricsCollector;
  private readonly startTime: number = Date.now();

  private readonly counters: Map<string, number> = new Map();
  private readonly histograms: Map<string, number[]> = new Map();
  private readonly gauges: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Sanitizes tag keys and values to prevent cardinality explosion and PII leakage.
   */
  private sanitizeTags(tags?: MetricTagDefinition): Record<string, string> | undefined {
    if (!tags) return undefined;
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(tags)) {
      if (FORBIDDEN_TAG_KEYS.has(key)) continue;
      if (!ALLOWED_TAG_KEYS.has(key)) continue;
      if (typeof value === 'string' && value.length > 0) {
        // Normalize low-cardinality value (truncate to max 32 chars)
        sanitized[key] = value.slice(0, 32);
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  /**
   * Builds a deterministic cache key from metric name and sanitized tags.
   */
  private buildKey(name: string, sanitizedTags?: Record<string, string>): string {
    if (!sanitizedTags) return name;
    const tagEntries = Object.entries(sanitizedTags).sort(([a], [b]) => a.localeCompare(b));
    const tagString = tagEntries.map(([k, v]) => `${k}=${v}`).join(',');
    return `${name}{${tagString}}`;
  }

  /**
   * Increments a monotonic counter.
   */
  public increment(name: string, value = 1, tags?: MetricTagDefinition): void {
    try {
      const sanitized = this.sanitizeTags(tags);
      const key = this.buildKey(name, sanitized);
      const current = this.counters.get(key) || 0;
      this.counters.set(key, current + value);
    } catch {
      // Fail-open: metrics collection never throws
    }
  }

  /**
   * Records an observation into a histogram (e.g. latency, token size).
   */
  public observe(name: string, value: number, tags?: MetricTagDefinition): void {
    try {
      const sanitized = this.sanitizeTags(tags);
      const key = this.buildKey(name, sanitized);
      let values = this.histograms.get(key);
      if (!values) {
        values = [];
        this.histograms.set(key, values);
      }
      values.push(value);
      // Keep bounded sample buffer per metric to avoid memory leak (last 1000 observations)
      if (values.length > 1000) {
        values.shift();
      }
    } catch {
      // Fail-open
    }
  }

  /**
   * Sets a gauge value (e.g. queue size, cache item count).
   */
  public gauge(name: string, value: number): void {
    try {
      this.gauges.set(name, value);
    } catch {
      // Fail-open
    }
  }

  /**
   * Reads current counter value for test assertions and monitoring.
   * If specific tags are provided, sums values of all matching series where those tags match.
   * If no tags are provided, sums all series matching the metric name.
   */
  public getCounter(name: string, tags?: MetricTagDefinition): number {
    const sanitized = this.sanitizeTags(tags);
    const exactKey = this.buildKey(name, sanitized);

    if (sanitized && Object.keys(sanitized).length > 0 && this.counters.has(exactKey)) {
      return this.counters.get(exactKey) || 0;
    }

    let total = 0;
    let foundAny = false;

    for (const [key, value] of this.counters.entries()) {
      if (key === name) {
        if (!sanitized || Object.keys(sanitized).length === 0) {
          total += value;
          foundAny = true;
        }
      } else if (key.startsWith(`${name}{`) && key.endsWith('}')) {
        if (!sanitized || Object.keys(sanitized).length === 0) {
          total += value;
          foundAny = true;
        } else {
          const tagPart = key.slice(name.length + 1, -1);
          const pairs = tagPart.split(',');
          const keyTags: Record<string, string> = {};
          for (const p of pairs) {
            const [k, v] = p.split('=');
            keyTags[k] = v;
          }
          const matches = Object.entries(sanitized).every(([k, v]) => keyTags[k] === v);
          if (matches) {
            total += value;
            foundAny = true;
          }
        }
      }
    }

    return foundAny ? total : (this.counters.get(exactKey) || 0);
  }

  /**
   * Computes statistical percentiles for a histogram metric.
   */
  public getHistogram(name: string, tags?: MetricTagDefinition): HistogramSnapshot | undefined {
    const sanitized = this.sanitizeTags(tags);
    const exactKey = this.buildKey(name, sanitized);
    let rawValues = this.histograms.get(exactKey);

    if (!rawValues || rawValues.length === 0) {
      // Look for series matching the metric name
      const aggregated: number[] = [];
      for (const [key, values] of this.histograms.entries()) {
        if (key === name && (!sanitized || Object.keys(sanitized).length === 0)) {
          aggregated.push(...values);
        } else if (key.startsWith(`${name}{`) && key.endsWith('}')) {
          if (!sanitized || Object.keys(sanitized).length === 0) {
            aggregated.push(...values);
          } else {
            const tagPart = key.slice(name.length + 1, -1);
            const pairs = tagPart.split(',');
            const keyTags: Record<string, string> = {};
            for (const p of pairs) {
              const [k, v] = p.split('=');
              keyTags[k] = v;
            }
            const matches = Object.entries(sanitized).every(([k, v]) => keyTags[k] === v);
            if (matches) {
              aggregated.push(...values);
            }
          }
        }
      }
      if (aggregated.length > 0) {
        rawValues = aggregated;
      }
    }

    if (!rawValues || rawValues.length === 0) return undefined;

    const sorted = [...rawValues].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const min = sorted[0];
    const max = sorted[count - 1];
    const avg = sum / count;

    const p = (pct: number) => {
      const idx = Math.min(count - 1, Math.floor((pct / 100) * count));
      return sorted[idx];
    };

    return {
      count,
      sum,
      min,
      max,
      avg: Math.round(avg * 100) / 100,
      p50: p(50),
      p90: p(90),
      p95: p(95),
      p99: p(99),
    };
  }

  /**
   * Produces a serializable metrics snapshot for reporting and health checks.
   */
  public getSnapshot(): MetricsSnapshot {
    const countersObj: Record<string, { value: number }> = {};
    for (const [key, value] of this.counters.entries()) {
      countersObj[key] = { value };
    }

    const histogramsObj: Record<string, HistogramSnapshot> = {};
    for (const [key, values] of this.histograms.entries()) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((acc, v) => acc + v, 0);
        histogramsObj[key] = {
          count,
          sum,
          min: sorted[0],
          max: sorted[count - 1],
          avg: Math.round((sum / count) * 100) / 100,
          p50: sorted[Math.floor(count * 0.5)],
          p90: sorted[Math.floor(count * 0.9)],
          p95: sorted[Math.floor(count * 0.95)],
          p99: sorted[Math.floor(count * 0.99)],
        };
      }
    }

    const gaugesObj: Record<string, number> = {};
    for (const [key, value] of this.gauges.entries()) {
      gaugesObj[key] = value;
    }

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      counters: countersObj,
      histograms: histogramsObj,
      gauges: gaugesObj,
    };
  }

  /**
   * Resets all metric state (for unit test isolation).
   */
  public reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
