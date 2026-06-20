/**
 * 上下文注入器
 *
 * 负责将收集到的上下文注入到 prompt/message 中。
 *
 * 移植自 oh-my-opencode 的 context-injector。
 */

import type { ContextCollector } from './collector.js';
import type { InjectionResult, InjectionStrategy, OutputPart } from './types.js';

/** 注入的上下文与原始内容之间的默认分隔符 */
const DEFAULT_SEPARATOR = '\n\n---\n\n';

/**
 * 将待处理上下文注入到一组 output parts 中。
 * 找到第一个文本 part 并把上下文前置到其中。
 */
export function injectPendingContext(
  collector: ContextCollector,
  sessionId: string,
  parts: OutputPart[],
  strategy: InjectionStrategy = 'prepend'
): InjectionResult {
  if (!collector.hasPending(sessionId)) {
    return { injected: false, contextLength: 0, entryCount: 0 };
  }

  const textPartIndex = parts.findIndex(
    (p) => p.type === 'text' && p.text !== undefined
  );

  if (textPartIndex === -1) {
    return { injected: false, contextLength: 0, entryCount: 0 };
  }

  const pending = collector.consume(sessionId);
  const originalText = parts[textPartIndex].text ?? '';

  switch (strategy) {
    case 'prepend':
      parts[textPartIndex].text = `${pending.merged}${DEFAULT_SEPARATOR}${originalText}`;
      break;
    case 'append':
      parts[textPartIndex].text = `${originalText}${DEFAULT_SEPARATOR}${pending.merged}`;
      break;
    case 'wrap':
      parts[textPartIndex].text = `<injected-context>\n${pending.merged}\n</injected-context>${DEFAULT_SEPARATOR}${originalText}`;
      break;
  }

  return {
    injected: true,
    contextLength: pending.merged.length,
    entryCount: pending.entries.length,
  };
}

/**
 * 将待处理上下文注入到原始文本字符串中。
 */
export function injectContextIntoText(
  collector: ContextCollector,
  sessionId: string,
  text: string,
  strategy: InjectionStrategy = 'prepend'
): { result: string; injectionResult: InjectionResult } {
  if (!collector.hasPending(sessionId)) {
    return {
      result: text,
      injectionResult: { injected: false, contextLength: 0, entryCount: 0 },
    };
  }

  const pending = collector.consume(sessionId);
  let result: string;

  switch (strategy) {
    case 'prepend':
      result = `${pending.merged}${DEFAULT_SEPARATOR}${text}`;
      break;
    case 'append':
      result = `${text}${DEFAULT_SEPARATOR}${pending.merged}`;
      break;
    case 'wrap':
      result = `<injected-context>\n${pending.merged}\n</injected-context>${DEFAULT_SEPARATOR}${text}`;
      break;
  }

  return {
    result,
    injectionResult: {
      injected: true,
      contextLength: pending.merged.length,
      entryCount: pending.entries.length,
    },
  };
}

/**
 * 创建用于上下文注入的 hook 处理器。
 * 这是一个工厂函数，用于创建 Claude Code 兼容的 hook。
 */
export function createContextInjectorHook(collector: ContextCollector) {
  return {
    /**
     * 处理用户消息并注入任何待处理上下文。
     */
    processUserMessage: (
      sessionId: string,
      message: string
    ): { message: string; injected: boolean } => {
      if (!collector.hasPending(sessionId)) {
        return { message, injected: false };
      }

      const { result } = injectContextIntoText(collector, sessionId, message, 'prepend');
      return { message: result, injected: true };
    },

    /**
     * 注册上下文，以便注入到下一条消息。
     */
    registerContext: collector.register.bind(collector),

    /**
     * 检查是否存在待处理上下文。
     */
    hasPending: collector.hasPending.bind(collector),

    /**
     * 清空待处理上下文但不注入。
     */
    clear: collector.clear.bind(collector),
  };
}
