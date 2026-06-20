/**
 * 自动斜杠命令检测器
 *
 * 在用户 prompt 中检测斜杠命令。
 *
 * 改编自 oh-my-opencode 的 auto-slash-command 钩子。
 */

import {
  SLASH_COMMAND_PATTERN,
  EXCLUDED_COMMANDS,
} from './constants.js';
import type { ParsedSlashCommand } from './types.js';

/** 匹配代码块的正则 */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

/**
 * 从文本中移除代码块以避免误报
 */
export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, '');
}

/**
 * 从文本中解析斜杠命令
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const match = trimmed.match(SLASH_COMMAND_PATTERN);
  if (!match) {
    return null;
  }

  const [raw, command, args] = match;
  return {
    command: command.toLowerCase(),
    args: args.trim(),
    raw,
  };
}

/**
 * 检查命令是否应被排除在自动展开之外
 */
export function isExcludedCommand(command: string): boolean {
  return EXCLUDED_COMMANDS.has(command.toLowerCase());
}

/**
 * 检测用户输入文本中的斜杠命令
 * 若未检测到命令或命令被排除，则返回 null
 */
export function detectSlashCommand(text: string): ParsedSlashCommand | null {
  // 先移除代码块
  const textWithoutCodeBlocks = removeCodeBlocks(text);
  const trimmed = textWithoutCodeBlocks.trim();

  // 必须以斜杠开头
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parsed = parseSlashCommand(trimmed);

  if (!parsed) {
    return null;
  }

  // 检查排除列表
  if (isExcludedCommand(parsed.command)) {
    return null;
  }

  return parsed;
}

/**
 * 从消息分块数组中提取文本内容
 */
export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join(' ');
}
