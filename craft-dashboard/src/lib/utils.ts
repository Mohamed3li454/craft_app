import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | Date | undefined | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return String(dateStr);
  }
}

export function formatRelativeTime(dateStr: string | Date | undefined | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);

    if (diffSec < 60) return `${Math.max(0, diffSec)}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return formatDate(dateStr);
  } catch {
    return String(dateStr);
  }
}

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatCurrency(amount: number | undefined | null): string {
  if (amount === undefined || amount === null) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function formatTokens(tokens: number | undefined | null): string {
  if (tokens === undefined || tokens === null) return '—';
  if (tokens === 0) return '0';
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return formatNumber(tokens);
}

export function truncate(text: string | undefined | null, length: number = 40): string {
  if (!text) return '—';
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}

export function formatLatency(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export {
  isTelemetryKey,
  isSensitiveKey,
  sanitizeSafeString,
  sanitizeSafeMetadata,
  sanitizeSafeErrorDetails,
  safeJsonStringify,
} from '@/lib/safety/trace-sanitizer';



