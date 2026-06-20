/**
 * 钩子输入归一化
 *
 * 处理 Claude Code 钩子输入的 snake_case -> camelCase 字段映射。
 * Claude Code 发送 snake_case 字段：tool_name、tool_input、tool_response、
 * session_id、cwd、hook_event_name。本模块将其归一化为 camelCase，
 * 并以 snake_case 优先、camelCase 兜底。
 *
 * 使用 Zod 进行结构校验，尽早捕获格式错误的输入。
 * 敏感钩子使用严格的允许列表；其余钩子则透传未知字段。
 */

import { z } from 'zod';
import type { HookInput } from './bridge.js';
import { resolveTranscriptPath } from '../lib/worktree-paths.js';

// --- 钩子输入校验的 Zod schema ---

/** 通用钩子输入结构的 schema（同时支持 snake_case 和 camelCase） */
const HookInputSchema = z.object({
  // 来自 Claude Code 的 snake_case 字段
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_response: z.unknown().optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  hook_event_name: z.string().optional(),

  // camelCase 字段（兜底/已归一化）
  toolName: z.string().optional(),
  toolInput: z.unknown().optional(),
  toolOutput: z.unknown().optional(),
  toolResponse: z.unknown().optional(),
  sessionId: z.string().optional(),
  directory: z.string().optional(),
  hookEventName: z.string().optional(),

  // 两种命名约定中相同的字段
  prompt: z.string().optional(),
  message: z.object({ content: z.string().optional() }).optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  model: z.string().optional(),
  model_id: z.string().optional(),
  modelId: z.string().optional(),
  agent_name: z.string().optional(),
  agentName: z.string().optional(),

  // Stop 钩子字段
  stop_reason: z.string().optional(),
  stopReason: z.string().optional(),
  user_requested: z.boolean().optional(),
  userRequested: z.boolean().optional(),
}).passthrough();

/**
 * 从 Claude Code 接收的原始钩子输入（snake_case 字段）
 */
interface RawHookInput {
  // 来自 Claude Code 的 snake_case 字段
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;

  // camelCase 字段（兜底/已归一化）
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  toolResponse?: unknown;
  sessionId?: string;
  directory?: string;
  hookEventName?: string;

  // 两种命名约定中相同的字段
  prompt?: string;
  message?: { content?: string };
  parts?: Array<{ type: string; text?: string }>;
  model?: string;
  model_id?: string;
  modelId?: string;
  agent_name?: string;
  agentName?: string;

  // 允许其他字段透传
  [key: string]: unknown;
}

// --- 安全：钩子敏感度分类 ---

/** 丢弃未知字段的钩子（仅使用严格允许列表） */
const SENSITIVE_HOOKS = new Set([
  'permission-request',
  'setup-init',
  'setup-maintenance',
  'session-end',
]);

/** 系统使用的所有已知 camelCase 字段名（归一化后） */
const KNOWN_FIELDS = new Set([
  // 核心归一化字段
  'sessionId', 'toolName', 'toolInput', 'toolOutput', 'directory',
  'prompt', 'message', 'parts', 'hookEventName',
  // Stop 钩子字段
  'stop_reason', 'stopReason', 'user_requested', 'userRequested',
  // 权限钩子字段
  'permission_mode', 'tool_use_id', 'transcript_path',
  // 子代理字段
  'agent_id', 'agent_name', 'agent_type', 'parent_session_id',
  'agentName', 'model', 'model_id', 'modelId',
  // Claude Code 的常见额外字段
  'input', 'output', 'result', 'error', 'status',
  // 会话结束字段
  'reason',
]);

// --- 快速路径检测 ---

/** 表明输入已归一化的典型 camelCase 键 */
const CAMEL_CASE_MARKERS = new Set(['sessionId', 'toolName', 'directory']);

/** 检查对象中是否有键包含下划线（snake_case 标志） */
function hasSnakeCaseKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (key.includes('_')) return true;
  }
  return false;
}

/** 检查输入是否已归一化为 camelCase，可跳过 Zod 解析 */
function isAlreadyCamelCase(obj: Record<string, unknown>): boolean {
  // 必须至少包含一个 camelCase 标记键
  let hasMarker = false;
  for (const marker of CAMEL_CASE_MARKERS) {
    if (marker in obj) {
      hasMarker = true;
      break;
    }
  }
  if (!hasMarker) return false;
  // 必须不包含 snake_case 键
  return !hasSnakeCaseKeys(obj);
}

/**
 * 将 Claude Code 的 snake_case 格式钩子输入归一化为内部使用的
 * camelCase HookInput 接口。
 *
 * 使用 Zod 校验输入结构，随后将 snake_case 映射为 camelCase。
 * 始终先读 snake_case，以 camelCase 兜底，遵循
 * MEMORY.md 中记录的项目约定。
 *
 * @param raw - 原始钩子输入（可能为 snake_case、camelCase 或混合形式）
 * @param hookType - 可选的钩子类型，用于按敏感度过滤
 */
export function normalizeHookInput(raw: unknown, hookType?: string): HookInput {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }

  const rawObj = raw as Record<string, unknown>;

  // 快速路径：若输入已是 camelCase，则完全跳过 Zod 解析
  if (isAlreadyCamelCase(rawObj)) {
    const passthrough = filterPassthrough(rawObj, hookType);
    // 解析 worktree 不匹配的 transcript 路径（issue #1094）
    if (passthrough.transcript_path) {
      passthrough.transcript_path = resolveTranscriptPath(
        passthrough.transcript_path as string,
        rawObj.directory as string | undefined,
      );
    }
    return {
      sessionId: rawObj.sessionId as string | undefined,
      toolName: rawObj.toolName as string | undefined,
      toolInput: rawObj.toolInput,
      toolOutput: rawObj.toolOutput ?? rawObj.toolResponse,
      directory: rawObj.directory as string | undefined,
      prompt: rawObj.prompt as string | undefined,
      message: rawObj.message as HookInput['message'],
      parts: rawObj.parts as HookInput['parts'],
      ...passthrough,
    } as HookInput;
  }

  // 用 Zod 校验 - 使用 safeParse，使格式错误的输入不会抛出异常
  const parsed = HookInputSchema.safeParse(raw);
  if (!parsed.success) {
    // 记录校验问题但不阻断 - 继续走尽力而为的映射
    console.error('[bridge-normalize] Zod validation warning:', parsed.error.issues.map(i => i.message).join(', '));
  }

  const input = (parsed.success ? parsed.data : raw) as RawHookInput;

  const extraFields = filterPassthrough(input, hookType);
  // 解析 worktree 不匹配的 transcript 路径（issue #1094）
  if (extraFields.transcript_path) {
    extraFields.transcript_path = resolveTranscriptPath(
      extraFields.transcript_path as string,
      (input.cwd ?? input.directory) as string | undefined,
    );
  }

  return {
    sessionId: input.session_id ?? input.sessionId,
    toolName: input.tool_name ?? input.toolName,
    toolInput: input.tool_input ?? input.toolInput,
    // tool_response 映射到 toolOutput，用于向后兼容
    toolOutput: input.tool_response ?? input.toolOutput ?? input.toolResponse,
    directory: input.cwd ?? input.directory,
    prompt: input.prompt,
    message: input.message,
    parts: input.parts,
    // 按敏感度过滤后透传额外字段
    ...extraFields,
  } as HookInput;
}

/**
 * 根据钩子敏感度过滤透传字段。
 *
 * - 敏感钩子：仅允许 KNOWN_FIELDS（丢弃其余所有字段）
 * - 其他钩子：透传未知字段并发出调试警告
 */
function filterPassthrough(input: Record<string, unknown>, hookType?: string): Record<string, unknown> {
  const MAPPED_KEYS = new Set([
    'tool_name', 'toolName',
    'tool_input', 'toolInput',
    'tool_response', 'toolOutput', 'toolResponse',
    'session_id', 'sessionId',
    'cwd', 'directory',
    'hook_event_name', 'hookEventName',
    'prompt', 'message', 'parts',
  ]);

  const isSensitive = hookType != null && SENSITIVE_HOOKS.has(hookType);
  const extra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (MAPPED_KEYS.has(key) || value === undefined) continue;

    if (isSensitive) {
      // 严格模式：仅允许已知字段
      if (KNOWN_FIELDS.has(key)) {
        extra[key] = value;
      }
      // 敏感钩子会静默丢弃未知字段
    } else {
      // 保守模式：透传但对真正未知的字段发出警告
      extra[key] = value;
      if (!KNOWN_FIELDS.has(key)) {
        console.error(`[bridge-normalize] Unknown field "${key}" passed through for hook "${hookType ?? 'unknown'}"`);
      }
    }
  }
  return extra;
}

// --- 测试辅助函数（仅为测试导出） ---
export { SENSITIVE_HOOKS, KNOWN_FIELDS, isAlreadyCamelCase, HookInputSchema };
