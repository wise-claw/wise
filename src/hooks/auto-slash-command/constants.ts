/**
 * 自动斜杠命令常量
 *
 * 斜杠命令检测所用的配置值。
 *
 * 改编自 oh-my-opencode 的 auto-slash-command 钩子。
 */

export const HOOK_NAME = 'auto-slash-command' as const;

/** 用于标记自动展开斜杠命令的 XML 标签 */
export const AUTO_SLASH_COMMAND_TAG_OPEN = '<auto-slash-command>';
export const AUTO_SLASH_COMMAND_TAG_CLOSE = '</auto-slash-command>';

/** 检测消息开头斜杠命令的正则 */
export const SLASH_COMMAND_PATTERN = /^\/([a-zA-Z][\w-]*)\s*(.*)/;

/**
 * 不应被自动展开的命令
 *（它们在别处有特殊处理，或现已为带 wise: 前缀的技能）
 */
export const EXCLUDED_COMMANDS = new Set([
  'ralph',
  'wise:ralplan',
  'wise:ultraqa',
  'wise:skillify',
  'wise:learner',
  'wise:plan',
  'wise:cancel',
  // Claude Code 内置命令，不应被展开
  'help',
  'clear',
  'compact',
  'history',
  'exit',
  'quit',
]);
