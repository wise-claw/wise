/**
 * 上下文收集器
 *
 * 负责某个 session 中来自多个来源的上下文条目的注册与读取。
 *
 * 移植自 oh-my-opencode 的 context-injector。
 */

import type {
  ContextEntry,
  ContextPriority,
  PendingContext,
  RegisterContextOptions,
} from './types.js';

/** 优先级排序——数字越小优先级越高 */
const PRIORITY_ORDER: Record<ContextPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** 合并后的上下文条目之间的分隔符 */
const CONTEXT_SEPARATOR = '\n\n---\n\n';

/**
 * 收集并管理各 session 的上下文条目。
 */
export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map();

  /**
   * 为某个 session 注册上下文条目。
   * 若已存在相同 source:id 的条目，将被替换。
   */
  register(sessionId: string, options: RegisterContextOptions): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }

    const sessionMap = this.sessions.get(sessionId)!;
    const key = `${options.source}:${options.id}`;

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: options.content,
      priority: options.priority ?? 'normal',
      timestamp: Date.now(),
      metadata: options.metadata,
    };

    sessionMap.set(key, entry);
  }

  /**
   * 获取某个 session 的待处理上下文，但不消费它。
   */
  getPending(sessionId: string): PendingContext {
    const sessionMap = this.sessions.get(sessionId);

    if (!sessionMap || sessionMap.size === 0) {
      return {
        merged: '',
        entries: [],
        hasContent: false,
      };
    }

    const entries = this.sortEntries([...sessionMap.values()]);
    const merged = entries.map((e) => e.content).join(CONTEXT_SEPARATOR);

    return {
      merged,
      entries,
      hasContent: entries.length > 0,
    };
  }

  /**
   * 获取并消费某个 session 的待处理上下文。
   * 消费后，该 session 的上下文将被清空。
   */
  consume(sessionId: string): PendingContext {
    const pending = this.getPending(sessionId);
    this.clear(sessionId);
    return pending;
  }

  /**
   * 清空某个 session 的全部上下文。
   */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 检查某个 session 是否有待处理上下文。
   */
  hasPending(sessionId: string): boolean {
    const sessionMap = this.sessions.get(sessionId);
    return sessionMap !== undefined && sessionMap.size > 0;
  }

  /**
   * 获取某个 session 的条目数量。
   */
  getEntryCount(sessionId: string): number {
    const sessionMap = this.sessions.get(sessionId);
    return sessionMap?.size ?? 0;
  }

  /**
   * 从某个 session 中移除指定条目。
   */
  removeEntry(sessionId: string, source: string, id: string): boolean {
    const sessionMap = this.sessions.get(sessionId);
    if (!sessionMap) return false;

    const key = `${source}:${id}`;
    return sessionMap.delete(key);
  }

  /**
   * 获取所有活跃 session 的 ID。
   */
  getActiveSessions(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * 按优先级（高优先）再按时间戳（早优先）对条目排序。
   */
  private sortEntries(entries: ContextEntry[]): ContextEntry[] {
    return entries.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });
  }
}

/** 全局单例上下文收集器实例 */
export const contextCollector = new ContextCollector();
