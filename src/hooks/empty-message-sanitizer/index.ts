/**
 * 空消息清理器钩子
 *
 * 清理空消息以防止 API 错误。
 * 根据 Anthropic API 规范，所有消息都必须包含非空内容，
 * 可选的最终 assistant 消息除外。
 *
 * 本钩子：
 * 1. 检测没有有效内容（空文本或无 parts）的消息
 * 2. 注入占位文本以防止 API 错误
 * 3. 将注入的内容标记为 synthetic
 *
 * 注意：理想情况下，此清理器应在一个在所有其他消息处理之后执行的消息转换钩子上运行。
 * 在 shell hooks 系统中，应在消息发送到 API 之前的最后阶段调用。
 *
 * 改编自 oh-my-opencode 的 empty-message-sanitizer 钩子。
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  PLACEHOLDER_TEXT,
  TOOL_PART_TYPES,
  HOOK_NAME,
  DEBUG_PREFIX,
} from './constants.js';
import type {
  MessagePart,
  MessageWithParts,
  EmptyMessageSanitizerInput,
  EmptyMessageSanitizerOutput,
  EmptyMessageSanitizerConfig,
} from './types.js';

const DEBUG = process.env.EMPTY_MESSAGE_SANITIZER_DEBUG === '1';
const DEBUG_FILE = path.join(tmpdir(), 'empty-message-sanitizer-debug.log');

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] ${DEBUG_PREFIX} ${args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
      .join(' ')}\n`;
    fs.appendFileSync(DEBUG_FILE, msg);
  }
}

/**
 * 检查 part 是否包含非空文本内容
 */
export function hasTextContent(part: MessagePart): boolean {
  if (part.type === 'text') {
    const text = part.text;
    return Boolean(text && text.trim().length > 0);
  }
  return false;
}

/**
 * 检查 part 是否为工具相关 part
 */
export function isToolPart(part: MessagePart): boolean {
  return TOOL_PART_TYPES.has(part.type);
}

/**
 * 检查消息 parts 是否包含有效内容
 * 有效内容 = 非空文本或工具 parts
 */
export function hasValidContent(parts: MessagePart[]): boolean {
  return parts.some((part) => hasTextContent(part) || isToolPart(part));
}

/**
 * 清理单条消息以确保其包含有效内容
 */
export function sanitizeMessage(
  message: MessageWithParts,
  isLastMessage: boolean,
  placeholderText: string = PLACEHOLDER_TEXT
): boolean {
  const isAssistant = message.info.role === 'assistant';

  // 跳过最终的 assistant 消息（按 API 规范允许为空）
  if (isLastMessage && isAssistant) {
    debugLog('skipping final assistant message');
    return false;
  }

  const parts = message.parts;

  // 修复：移除了 `&& parts.length > 0` - 空数组同样需要清理
  // 当 parts 为 [] 时，消息没有内容，会导致 API 错误：
  // "all messages must have non-empty content except for the optional final assistant message"
  if (!hasValidContent(parts)) {
    debugLog(`sanitizing message ${message.info.id}: no valid content`);
    let injected = false;

    // 尝试查找已有的空文本 part 并替换其内容
    for (const part of parts) {
      if (part.type === 'text') {
        if (!part.text || !part.text.trim()) {
          part.text = placeholderText;
          part.synthetic = true;
          injected = true;
          debugLog(`replaced empty text in existing part`);
          break;
        }
      }
    }

    // 若未找到文本 part，则注入一个新的
    if (!injected) {
      const insertIndex = parts.findIndex((p) => isToolPart(p));

      const newPart: MessagePart = {
        id: `synthetic_${Date.now()}`,
        messageID: message.info.id,
        sessionID: message.info.sessionID ?? '',
        type: 'text',
        text: placeholderText,
        synthetic: true,
      };

      if (insertIndex === -1) {
        // 无工具 parts，追加到末尾
        parts.push(newPart);
        debugLog(`appended synthetic text part`);
      } else {
        // 插入到第一个工具 part 之前
        parts.splice(insertIndex, 0, newPart);
        debugLog(`inserted synthetic text part before tool part`);
      }
    }

    return true;
  }

  // 同时清理与有效内容共存的空文本 parts
  let sanitized = false;
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text !== undefined && part.text.trim() === '') {
        part.text = placeholderText;
        part.synthetic = true;
        sanitized = true;
        debugLog(`sanitized empty text part in message ${message.info.id}`);
      }
    }
  }

  return sanitized;
}

/**
 * 清理输入中的所有消息
 */
export function sanitizeMessages(
  input: EmptyMessageSanitizerInput,
  config?: EmptyMessageSanitizerConfig
): EmptyMessageSanitizerOutput {
  const { messages } = input;
  const placeholderText = config?.placeholderText ?? PLACEHOLDER_TEXT;

  debugLog('sanitizing messages', { count: messages.length });

  let sanitizedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const isLastMessage = i === messages.length - 1;

    const wasSanitized = sanitizeMessage(message, isLastMessage, placeholderText);
    if (wasSanitized) {
      sanitizedCount++;
    }
  }

  debugLog(`sanitized ${sanitizedCount} messages`);

  return {
    messages,
    sanitizedCount,
    modified: sanitizedCount > 0,
  };
}

/**
 * 为 Claude Code shell hooks 创建空消息清理器钩子
 *
 * 此钩子确保所有消息在发送到 API 之前都包含有效内容。
 * 应在消息处理的最后阶段调用。
 */
export function createEmptyMessageSanitizerHook(config?: EmptyMessageSanitizerConfig) {
  debugLog('createEmptyMessageSanitizerHook called', { config });

  return {
    /**
     * 清理消息（在消息转换阶段调用）
     */
    sanitize: (input: EmptyMessageSanitizerInput): EmptyMessageSanitizerOutput => {
      return sanitizeMessages(input, config);
    },

    /**
     * 获取钩子名称
     */
    getName: (): string => {
      return HOOK_NAME;
    },
  };
}

// 重新导出类型
export type {
  MessagePart,
  MessageInfo,
  MessageWithParts,
  EmptyMessageSanitizerInput,
  EmptyMessageSanitizerOutput,
  EmptyMessageSanitizerConfig,
} from './types.js';

// 重新导出常量
export {
  PLACEHOLDER_TEXT,
  TOOL_PART_TYPES,
  HOOK_NAME,
  DEBUG_PREFIX,
  ERROR_PATTERNS,
} from './constants.js';
