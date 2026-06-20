/**
 * 上下文注入器类型定义
 *
 * 上下文注入系统的类型定义。
 * 允许多个来源注册上下文，这些上下文会被合并并注入到 prompt 中。
 *
 * 移植自 oh-my-opencode 的 context-injector。
 */

/**
 * 上下文注入的来源标识符。
 * 每个来源注册的上下文会被合并并一起注入。
 */
export type ContextSourceType =
  | 'keyword-detector'
  | 'rules-injector'
  | 'directory-agents'
  | 'directory-readme'
  | 'boulder-state'
  | 'session-context'
  | 'learner'
  | 'beads'
  | 'project-memory'
  | 'custom';

/**
 * 用于上下文排序的优先级级别。
 * 优先级更高的上下文在合并输出中排在前面。
 */
export type ContextPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * 由某个来源注册的单个上下文条目。
 */
export interface ContextEntry {
  /** 该条目在所属来源内的唯一标识符 */
  id: string;
  /** 注册该上下文的来源 */
  source: ContextSourceType;
  /** 实际要注入的上下文内容 */
  content: string;
  /** 用于排序的优先级（默认：normal） */
  priority: ContextPriority;
  /** 注册时的时间戳 */
  timestamp: number;
  /** 可选元数据，用于调试/日志 */
  metadata?: Record<string, unknown>;
}

/**
 * 注册上下文的选项。
 */
export interface RegisterContextOptions {
  /** 该上下文条目的唯一 ID（用于去重） */
  id: string;
  /** 来源标识符 */
  source: ContextSourceType;
  /** 要注入的内容 */
  content: string;
  /** 用于排序的优先级（默认：normal） */
  priority?: ContextPriority;
  /** 可选元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 获取某个 session 待处理上下文的结果。
 */
export interface PendingContext {
  /** 已合并的上下文字符串，可直接注入 */
  merged: string;
  /** 被合并的各个条目 */
  entries: ContextEntry[];
  /** 是否存在可注入的内容 */
  hasContent: boolean;
}

/**
 * 来自原始用户消息的消息上下文。
 * 注入时用于匹配消息格式。
 */
export interface MessageContext {
  sessionId?: string;
  agent?: string;
  model?: {
    providerId?: string;
    modelId?: string;
  };
  path?: {
    cwd?: string;
    root?: string;
  };
  tools?: Record<string, boolean>;
}

/**
 * 钩子处理产生的 output parts。
 */
export interface OutputPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * 上下文的注入策略。
 */
export type InjectionStrategy = 'prepend' | 'append' | 'wrap';

/**
 * 注入操作的结果。
 */
export interface InjectionResult {
  /** 是否发生了注入 */
  injected: boolean;
  /** 注入上下文的长度 */
  contextLength: number;
  /** 注入的条目数量 */
  entryCount: number;
}
