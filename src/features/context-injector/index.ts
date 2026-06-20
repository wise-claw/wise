/**
 * 上下文注入模块
 *
 * 从多个来源收集上下文并注入到用户 prompt 的系统。
 * 支持优先级排序与去重。
 *
 * 移植自 oh-my-opencode 的 context-injector。
 */

// 收集器
export { ContextCollector, contextCollector } from './collector.js';

// 注入函数
export {
  injectPendingContext,
  injectContextIntoText,
  createContextInjectorHook,
} from './injector.js';

// 类型
export type {
  ContextSourceType,
  ContextPriority,
  ContextEntry,
  RegisterContextOptions,
  PendingContext,
  MessageContext,
  OutputPart,
  InjectionStrategy,
  InjectionResult,
} from './types.js';
