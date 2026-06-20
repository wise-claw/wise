/**
 * 速率限制监控
 *
 * 包装已有的 usage-api.ts 以提供速率限制状态监控。
 * 使用 OAuth API 检查用量百分比。
 */

import { getUsage } from '../../hud/usage-api.js';
import type { RateLimitStatus } from './types.js';

/** 判定受到速率限制的阈值百分比 */
const RATE_LIMIT_THRESHOLD = 100;

/**
 * 使用 OAuth API 检查当前速率限制状态
 *
 * @returns 速率限制状态；API 不可用时返回 null
 */
export async function checkRateLimitStatus(): Promise<RateLimitStatus | null> {
  try {
    const result = await getUsage();

    if (!result.rateLimits) {
      // 无 OAuth 凭证或 API 不可用
      return null;
    }

    const usage = result.rateLimits;
    const fiveHourLimited = (usage.fiveHourPercent ?? 0) >= RATE_LIMIT_THRESHOLD;
    const weeklyLimited = (usage.weeklyPercent ?? 0) >= RATE_LIMIT_THRESHOLD;
    const monthlyLimited = (usage.monthlyPercent ?? 0) >= RATE_LIMIT_THRESHOLD;
    const isLimited = fiveHourLimited || weeklyLimited || monthlyLimited;
    const usingStaleData = result.error === 'rate_limited' && !!result.rateLimits;

    // 确定下次重置时间
    let nextResetAt: Date | null = null;
    let timeUntilResetMs: number | null = null;

    if (isLimited) {
      const now = Date.now();
      const resets: Date[] = [];

      if (fiveHourLimited && usage.fiveHourResetsAt) {
        resets.push(usage.fiveHourResetsAt);
      }
      if (weeklyLimited && usage.weeklyResetsAt) {
        resets.push(usage.weeklyResetsAt);
      }
      if (monthlyLimited && usage.monthlyResetsAt) {
        resets.push(usage.monthlyResetsAt);
      }

      if (resets.length > 0) {
        // 查找最早的重置时间
        nextResetAt = resets.reduce((earliest, current) =>
          current < earliest ? current : earliest
        );
        timeUntilResetMs = Math.max(0, nextResetAt.getTime() - now);
      }
    }

    return {
      fiveHourLimited,
      weeklyLimited,
      monthlyLimited,
      isLimited,
      fiveHourResetsAt: usage.fiveHourResetsAt ?? null,
      weeklyResetsAt: usage.weeklyResetsAt ?? null,
      monthlyResetsAt: usage.monthlyResetsAt ?? null,
      nextResetAt,
      timeUntilResetMs,
      fiveHourPercent: usage.fiveHourPercent,
      weeklyPercent: usage.weeklyPercent,
      monthlyPercent: usage.monthlyPercent,
      apiErrorReason: result.error,
      usingStaleData,
      lastCheckedAt: new Date(),
    };
  } catch (error) {
    // 记录错误但不抛出 —— 返回 null 表示不可用
    console.error('[RateLimitMonitor] Error checking rate limit:', error);
    return null;
  }
}

/**
 * 格式化距离重置的时长以供显示
 */
export function formatTimeUntilReset(ms: number): string {
  if (ms <= 0) return 'now';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * 获取可读的速率限制状态消息
 */
export function formatRateLimitStatus(status: RateLimitStatus): string {
  if (status.apiErrorReason === 'rate_limited' && !status.isLimited) {
    const cachedUsageParts: string[] = [];

    if (typeof status.fiveHourPercent === 'number') {
      cachedUsageParts.push(`5-hour ${status.fiveHourPercent}%`);
    }
    if (typeof status.weeklyPercent === 'number') {
      cachedUsageParts.push(`weekly ${status.weeklyPercent}%`);
    }
    if (typeof status.monthlyPercent === 'number') {
      cachedUsageParts.push(`monthly ${status.monthlyPercent}%`);
    }

    if (cachedUsageParts.length > 0) {
      return `Usage API rate limited; showing stale cached usage (${cachedUsageParts.join(', ')})`;
    }
    return 'Usage API rate limited; current limit status unavailable';
  }

  if (!status.isLimited) {
    return 'Not rate limited';
  }

  const parts: string[] = [];

  if (status.fiveHourLimited) {
    parts.push('5-hour limit reached');
  }
  if (status.weeklyLimited) {
    parts.push('Weekly limit reached');
  }
  if (status.monthlyLimited) {
    parts.push('Monthly limit reached');
  }

  let message = parts.join(' and ');

  if (status.timeUntilResetMs !== null) {
    message += ` (resets in ${formatTimeUntilReset(status.timeUntilResetMs)})`;
  }

  if (status.apiErrorReason === 'rate_limited') {
    message += ' [usage API 429; cached data]';
  }

  return message;
}

/**
 * 底层 usage API 当前是否因 429/陈旧缓存行为而降级。
 */
export function isRateLimitStatusDegraded(status: RateLimitStatus | null): boolean {
  return status?.apiErrorReason === 'rate_limited';
}

/**
 * 守护进程是否应主动扫描被阻塞的面板。
 * 只有确认的配额耗尽才进入面板等待/恢复路径。
 * usage-api 429/陈旧缓存的降级状态对用户仍可见，但
 * 刻意排除在守护进程面板阻塞行为之外。
 */
export function shouldMonitorBlockedPanes(status: RateLimitStatus | null): boolean {
  return !!status?.isLimited;
}
