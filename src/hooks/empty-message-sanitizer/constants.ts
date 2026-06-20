/**
 * 空消息清理器常量
 *
 * 空消息清理器钩子使用的常量。
 *
 * 改编自 oh-my-opencode 的 empty-message-sanitizer 钩子。
 */

/**
 * 为空消息注入的占位文本
 * 用于防止因内容为空导致的 API 错误
 */
export const PLACEHOLDER_TEXT = '[user interrupted]';

/**
 * 视为有效内容的工具相关 part 类型
 */
export const TOOL_PART_TYPES = new Set([
  'tool',
  'tool_use',
  'tool_result',
]);

/**
 * 钩子名称标识符
 */
export const HOOK_NAME = 'empty-message-sanitizer';

/**
 * 调试日志前缀
 */
export const DEBUG_PREFIX = '[empty-message-sanitizer]';

/**
 * 用于调试的错误消息模式
 */
export const ERROR_PATTERNS = {
  EMPTY_CONTENT: 'all messages must have non-empty content',
  EMPTY_TEXT: 'message contains empty text part',
  NO_VALID_PARTS: 'message has no valid content parts',
};
