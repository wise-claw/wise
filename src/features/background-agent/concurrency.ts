/**
 * 后台 Agent 并发管理器
 *
 * 管理后台任务的并发上限。
 *
 * 改编自 oh-my-opencode 的 background-agent 功能。
 */

import type { BackgroundTaskConfig } from './types.js';

/**
 * 管理后台任务的并发上限。
 * 提供带排队的 acquire/release 语义。
 */
export class ConcurrencyManager {
  private config?: BackgroundTaskConfig;
  private counts: Map<string, number> = new Map();
  private queues: Map<string, Array<() => void>> = new Map();

  constructor(config?: BackgroundTaskConfig) {
    this.config = config;
  }

  /**
   * 获取给定键（模型/agent 名）的并发上限
   */
  getConcurrencyLimit(key: string): number {
    // 检查模型专属上限
    const modelLimit = this.config?.modelConcurrency?.[key];
    if (modelLimit !== undefined) {
      return modelLimit === 0 ? Infinity : modelLimit;
    }

    // 检查 provider 专属上限（键中 / 之前的部分）
    const provider = key.split('/')[0];
    const providerLimit = this.config?.providerConcurrency?.[provider];
    if (providerLimit !== undefined) {
      return providerLimit === 0 ? Infinity : providerLimit;
    }

    // 回退到默认值
    const defaultLimit = this.config?.defaultConcurrency;
    if (defaultLimit !== undefined) {
      return defaultLimit === 0 ? Infinity : defaultLimit;
    }

    // 默认每个键 5 个并发任务
    return 5;
  }

  /**
   * 为给定键获取一个槽位。
   * 未达上限时立即返回，否则将请求排队。
   */
  async acquire(key: string): Promise<void> {
    const limit = this.getConcurrencyLimit(key);
    if (limit === Infinity) {
      return;
    }

    const current = this.counts.get(key) ?? 0;
    if (current < limit) {
      this.counts.set(key, current + 1);
      return;
    }

    // 将请求排队
    return new Promise<void>((resolve) => {
      const queue = this.queues.get(key) ?? [];
      queue.push(resolve);
      this.queues.set(key, queue);
    });
  }

  /**
   * 释放给定键的一个槽位。
   * 若有排队的请求，则 resolve 下一个。
   */
  release(key: string): void {
    const limit = this.getConcurrencyLimit(key);
    if (limit === Infinity) {
      return;
    }

    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      // resolve 下一个排队请求
      const next = queue.shift()!;
      next();
    } else {
      // 计数减一
      const current = this.counts.get(key) ?? 0;
      if (current > 0) {
        this.counts.set(key, current - 1);
      }
    }
  }

  /**
   * 获取某键的当前计数
   */
  getCount(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  /**
   * 获取某键的排队长度
   */
  getQueueLength(key: string): number {
    return this.queues.get(key)?.length ?? 0;
  }

  /**
   * 检查某键是否已达上限
   */
  isAtCapacity(key: string): boolean {
    const limit = this.getConcurrencyLimit(key);
    if (limit === Infinity) return false;
    return (this.counts.get(key) ?? 0) >= limit;
  }

  /**
   * 获取所有活跃键及其计数
   */
  getActiveCounts(): Map<string, number> {
    return new Map(this.counts);
  }

  /**
   * 清除所有计数与队列
   */
  clear(): void {
    this.counts.clear();
    this.queues.clear();
  }
}
