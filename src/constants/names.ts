/**
 * 共享常量注册表
 *
 * 模式、工具类别与钩子事件的规范字符串常量。
 * 消除代码库中散落的字符串字面量。
 */

// 模式名称
export const MODES = {
  AUTOPILOT: 'autopilot',
  RALPH: 'ralph',
  ULTRAWORK: 'ultrawork',
  ULTRAQA: 'ultraqa',
  TEAM: 'team',
  RALPLAN: 'ralplan',
} as const;
export type ModeName = typeof MODES[keyof typeof MODES];

// 工具类别
export const TOOL_CATEGORIES = {
  LSP: 'lsp',
  AST: 'ast',
  PYTHON: 'python',
  STATE: 'state',
  NOTEPAD: 'notepad',
  MEMORY: 'memory',
  TRACE: 'trace',
  SKILLS: 'skills',
  INTEROP: 'interop',
  CODEX: 'codex',
  GEMINI: 'gemini',
  SHARED_MEMORY: 'shared-memory',
  DEEPINIT: 'deepinit',
  WIKI: 'wiki',
} as const;
export type ToolCategory = typeof TOOL_CATEGORIES[keyof typeof TOOL_CATEGORIES];

// 钩子事件名称
export const HOOK_EVENTS = {
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  SESSION_START: 'SessionStart',
  STOP: 'Stop',
  NOTIFICATION: 'Notification',
  USER_PROMPT_SUBMIT: 'UserPromptSubmit',
  PRE_COMPACT: 'PreCompact',
} as const;
export type HookEvent = typeof HOOK_EVENTS[keyof typeof HOOK_EVENTS];
