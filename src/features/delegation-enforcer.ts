/**
 * 委派强制器
 *
 * 确保在 Task/Agent 调用中始终存在 model 参数的中间件。
 * 未指定时自动从代理定义中注入默认 model。
 *
 * 这解决了 Claude Code 不会自动应用代理定义中 model 的问题——
 * 每次 Task 调用都必须显式传入 model 参数。
 *
 * 对于非 Claude 提供方（CC Switch、LiteLLM 等），forceInherit 会被
 * 配置加载器自动开启（issue #1201），从而使本强制器剥离 model 参数，
 * 让代理继承用户配置的 model，而不是接收提供方无法识别的
 * Claude 专属 tier 名称（sonnet/opus/haiku）。
 */

import { getAgentDefinitions } from '../agents/definitions.js';
import { normalizeDelegationRole } from './delegation-routing/types.js';
import { loadConfig } from '../config/loader.js';
import { isProviderSpecificModelId, resolveClaudeFamily } from '../config/models.js';
import type { PluginConfig } from '../shared/types.js';

// ---------------------------------------------------------------------------
// 配置缓存——避免在每次 enforceModel() 调用时重复读取磁盘 (F10)
//
// 缓存键由 loadConfig() 读取的每一个环境变量构建而成。
// 当任一环境变量变化时（测试在不同用例间会这样做），键随之改变，
// loadConfig() 会重新调用。routing-force-inherit.test.ts 中的 mock
// 替换了 loadConfig 的导入绑定，因此 vi.fn() 的返回值会自动
// 流经此处——无需额外接线。
// ---------------------------------------------------------------------------

/** 所有会影响 loadConfig() 输出的环境变量名。 */
const CONFIG_ENV_KEYS = [
  // forceInherit 自动检测 (isNonClaudeProvider)
  'ANTHROPIC_BASE_URL',
  'CLAUDE_MODEL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  // 显式路由覆盖
  'WISE_ROUTING_FORCE_INHERIT',
  'WISE_ROUTING_ENABLED',
  'WISE_ROUTING_DEFAULT_TIER',
  'WISE_ESCALATION_ENABLED',
  // model 别名覆盖 (issue #1211)
  'WISE_MODEL_ALIAS_HAIKU',
  'WISE_MODEL_ALIAS_SONNET',
  'WISE_MODEL_ALIAS_OPUS',
  // tier model 解析（喂给 buildDefaultConfig）
  'WISE_MODEL_HIGH',
  'WISE_MODEL_MEDIUM',
  'WISE_MODEL_LOW',
  'CLAUDE_CODE_BEDROCK_HAIKU_MODEL',
  'CLAUDE_CODE_BEDROCK_SONNET_MODEL',
  'CLAUDE_CODE_BEDROCK_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
] as const;

function buildEnvCacheKey(): string {
  return CONFIG_ENV_KEYS.map((k) => `${k}=${process.env[k] ?? ''}`).join('|');
}

let _cachedConfig: PluginConfig | null = null;
let _cachedConfigKey = '';

function getCachedConfig(): PluginConfig {
  // 在测试环境中跳过缓存，使 vi.mock/vi.fn() 对 loadConfig 的覆盖
  // 始终生效，而无需手动让缓存失效。
  if (process.env.VITEST) {
    return loadConfig();
  }
  const key = buildEnvCacheKey();
  if (_cachedConfig === null || key !== _cachedConfigKey) {
    _cachedConfig = loadConfig();
    _cachedConfigKey = key;
  }
  return _cachedConfig;
}


/** 将 Claude model family 映射到 CC 支持的别名 */
const FAMILY_TO_ALIAS: Record<string, string> = {
  SONNET: 'sonnet',
  OPUS: 'opus',
  HAIKU: 'haiku',
  FABLE: 'fable',
};

/** 尽可能将 model ID 归一化为 CC 支持的别名 (sonnet/opus/haiku/fable) */
export function normalizeToCcAlias(model: string): string {
  if (isProviderSpecificModelId(model)) {
    return model;
  }

  const family = resolveClaudeFamily(model);
  return family ? (FAMILY_TO_ALIAS[family] ?? model) : model;
}

/**
 * 来自 Claude Agent SDK 的代理输入结构
 */
export interface AgentInput {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: string;
  resume?: string;
  run_in_background?: boolean;
}

/**
 * model 强制的结果
 */
export interface EnforcementResult {
  /** 原始输入 */
  originalInput: AgentInput;
  /** 强制 model 后的修改输入 */
  modifiedInput: AgentInput;
  /** 是否自动注入了 model */
  injected: boolean;
  /** 使用的 model */
  model: string;
  /** 警告信息（仅当 WISE_DEBUG=true） */
  warning?: string;
}

function isDelegationToolName(toolName: string): boolean {
  const normalizedToolName = toolName.toLowerCase();
  return normalizedToolName === 'agent' || normalizedToolName === 'task';
}

function canonicalizeSubagentType(subagentType: string): string {
  const hasPrefix = subagentType.startsWith('wise:');
  const rawAgentType = subagentType.replace(/^wise:/, '');
  const canonicalAgentType = normalizeDelegationRole(rawAgentType);
  return hasPrefix ? `wise:${canonicalAgentType}` : canonicalAgentType;
}

/**
 * 为代理委派调用强制 model 参数
 *
 * 若显式指定了 model，则保留之。
 * 若未指定，则注入代理定义中的默认 model。
 *
 * @param agentInput - agent/task 输入参数
 * @returns 带修改后输入的强制结果
 * @throws 若代理类型没有默认 model 则抛出 Error
 */
export function enforceModel(agentInput: AgentInput): EnforcementResult {
  const canonicalSubagentType = canonicalizeSubagentType(agentInput.subagent_type);

  // 若 forceInherit 已开启，则完全跳过 model 注入，让代理
  // 继承用户的 Claude Code model 设置 (issue #1135)
  const config = getCachedConfig();
  if (config.routing?.forceInherit) {
    const { model: _existing, ...rest } = agentInput;
    const cleanedInput: AgentInput = { ...(rest as AgentInput), subagent_type: canonicalSubagentType };
    return {
      originalInput: agentInput,
      modifiedInput: cleanedInput,
      injected: false,
      model: 'inherit',
    };
  }

  // 若 model 已指定，先将其归一化为 CC 支持的别名再放行。
  // 完整 ID 如 'claude-sonnet-4-6' 会在 Bedrock/Vertex 上引发 400
  // 错误。(issue #1415)
  if (agentInput.model) {
    const normalizedModel = normalizeToCcAlias(agentInput.model);
    return {
      originalInput: agentInput,
      modifiedInput: { ...agentInput, subagent_type: canonicalSubagentType, model: normalizedModel },
      injected: false,
      model: normalizedModel,
    };
  }

  const agentType = canonicalSubagentType.replace(/^wise:/, '');
  const agentDefs = getAgentDefinitions({ config });
  const agentDef = agentDefs[agentType];

  if (!agentDef) {
    throw new Error(`Unknown agent type: ${agentType} (from ${agentInput.subagent_type})`);
  }

  if (!agentDef.model) {
    throw new Error(`No default model defined for agent: ${agentType}`);
  }

  // 应用配置中的 modelAliases (issue #1211)。
  // 优先级：显式参数（上文已处理）> modelAliases > 代理默认值。
  // 这样用户无需动用釜底抽薪的 forceInherit 选项即可重映射 tier 名称。
  let resolvedModel = agentDef.model;
  const aliases = config.routing?.modelAliases;
  const aliasSourceModel = agentDef.defaultModel ?? agentDef.model;
  if (aliases && aliasSourceModel && aliasSourceModel !== 'inherit') {
    const alias = aliases[aliasSourceModel as keyof typeof aliases];
    if (alias) {
      resolvedModel = alias;
    }
  }

  // 若解析后的 model 为 'inherit'，则不注入任何 model 参数。
  if (resolvedModel === 'inherit') {
    const { model: _existing, ...rest } = agentInput;
    const cleanedInput: AgentInput = { ...(rest as AgentInput), subagent_type: canonicalSubagentType };
    return {
      originalInput: agentInput,
      modifiedInput: cleanedInput,
      injected: false,
      model: 'inherit',
    };
  }

  // 将 model 归一化为 Claude Code 支持的别名 (sonnet/opus/haiku)。
  // 完整 ID 会在 Bedrock/Vertex 上引发 400 错误。(issue #1201, #1415)
  const normalizedModel = normalizeToCcAlias(resolvedModel);

  const modifiedInput: AgentInput = {
    ...agentInput,
    subagent_type: canonicalSubagentType,
    model: normalizedModel,
  };

  let warning: string | undefined;
  if (process.env.WISE_DEBUG === 'true') {
    const aliasNote = resolvedModel !== agentDef.model && aliasSourceModel
      ? ` (aliased from ${aliasSourceModel})`
      : '';
    const normalizedNote = normalizedModel !== resolvedModel
      ? ` (normalized from ${resolvedModel})`
      : '';
    warning = `[WISE] Auto-injecting model: ${normalizedModel} for ${agentType}${aliasNote}${normalizedNote}`;
  }

  return {
    originalInput: agentInput,
    modifiedInput,
    injected: true,
    model: normalizedModel,
    warning,
  };
}

/**
 * 检查工具输入是否为代理委派调用
 */
export function isAgentCall(toolName: string, toolInput: unknown): toolInput is AgentInput {
  if (!isDelegationToolName(toolName)) {
    return false;
  }

  if (!toolInput || typeof toolInput !== 'object') {
    return false;
  }

  const input = toolInput as Record<string, unknown>;
  return (
    typeof input.subagent_type === 'string' &&
    typeof input.prompt === 'string' &&
    typeof input.description === 'string'
  );
}

/**
 * 处理用于 model 强制的 pre-tool-use 钩子
 */
export function processPreToolUse(
  toolName: string,
  toolInput: unknown
): { modifiedInput: unknown; warning?: string } {
  if (!isAgentCall(toolName, toolInput)) {
    return { modifiedInput: toolInput };
  }

  const result = enforceModel(toolInput);

  if (result.warning) {
    console.warn(result.warning);
  }

  return {
    modifiedInput: result.modifiedInput,
    warning: result.warning,
  };
}

/**
 * 获取某个代理类型的 model（用于测试/调试）
 */
export function getModelForAgent(agentType: string): string {
  const normalizedType = normalizeDelegationRole(agentType.replace(/^wise:/, ''));
  const agentDefs = getAgentDefinitions({ config: getCachedConfig() });
  const agentDef = agentDefs[normalizedType];

  if (!agentDef) {
    throw new Error(`Unknown agent type: ${normalizedType}`);
  }

  if (!agentDef.model) {
    throw new Error(`No default model defined for agent: ${normalizedType}`);
  }

  // 将标准 Anthropic ID 归一化为 CC 支持的别名 (sonnet/opus/haiku)，
  // 同时保留 Bedrock/Vertex 路径等提供方专属 ID。
  return normalizeToCcAlias(agentDef.model);
}
