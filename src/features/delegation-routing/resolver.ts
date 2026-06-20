/**
 * 委派路由器
 *
 * 解析对给定 agent 角色使用哪个提供方/工具。
 */

import type {
  DelegationRoutingConfig,
  DelegationRoute,
  DelegationDecision,
  ResolveDelegationOptions,
  DelegationTool,
} from '../../shared/types.js';
import {
  isDelegationEnabled,
  ROLE_CATEGORY_DEFAULTS,
  normalizeDelegationRole,
} from './types.js';

const DEPRECATED_MCP_PROVIDERS = new Set<DelegationRoute['provider']>([
  'codex',
  'gemini',
]);

export const DEPRECATED_MCP_PROVIDER_WARNING =
  '[WISE] Codex/Gemini MCP delegation is deprecated. Use /team to coordinate CLI workers instead.';

/**
 * 根据配置和上下文解析委派决策
 *
 * 优先级（从高到低）：
 * 1. 显式工具调用
 * 2. 已配置的路由（若启用）
 * 3. 默认启发式（角色类别 → Claude 子代理）
 * 4. defaultProvider
 */
export function resolveDelegation(options: ResolveDelegationOptions): DelegationDecision {
  const { agentRole, explicitTool, explicitModel, config } = options;
  const canonicalAgentRole = normalizeDelegationRole(agentRole);

  // 优先级 1：显式工具调用
  if (explicitTool) {
    return resolveExplicitTool(explicitTool, explicitModel, canonicalAgentRole);
  }

  // 优先级 2：已配置的路由（若启用）
  const configuredRoute = config?.roles?.[agentRole]
    ?? (canonicalAgentRole !== agentRole ? config?.roles?.[canonicalAgentRole] : undefined);

  if (config && isDelegationEnabled(config) && configuredRoute) {
    return resolveFromConfig(canonicalAgentRole, configuredRoute);
  }

  // 优先级 3 和 4：默认启发式
  return resolveDefault(canonicalAgentRole, config);
}

/**
 * 用户显式指定工具时的解析
 */
function resolveExplicitTool(
  tool: DelegationTool,
  model: string | undefined,
  agentRole: string
): DelegationDecision {
  // 仅支持 'Task' —— 显式工具调用始终使用 Claude
  return {
    provider: 'claude',
    tool: 'Task',
    agentOrModel: agentRole,
    reason: `Explicit tool invocation: ${tool}`,
  };
}

/**
 * 从配置解析
 */
function resolveFromConfig(
  agentRole: string,
  route: DelegationRoute,
): DelegationDecision {
  const provider = route.provider;
  let tool = route.tool;
  const agentOrModel = route.model || route.agentType || agentRole;
  const fallbackChain = route.fallback;

  // 已弃用的 MCP 提供方仅作为兼容性输入。在路由到可执行的 Claude Task 目标时，
  // 保留其兜底链证据。外部模型名不是有效的 Claude 子代理角色，因此 route.model
  // 仅作诊断用途，通过 reason 文本体现，而不放进 agentOrModel。
  if (isDeprecatedMcpProvider(provider)) {
    console.warn(DEPRECATED_MCP_PROVIDER_WARNING);
    const claudeAgent = route.agentType || agentRole;
    const modelEvidence = route.model ? `; ignored external model "${route.model}"` : '';
    return {
      provider: 'claude',
      tool: 'Task',
      agentOrModel: claudeAgent,
      reason: `Configured routing for role "${agentRole}" (deprecated provider "${provider}", falling back to Claude Task${modelEvidence})`,
      fallbackChain,
    };
  }

  // 仅 claude → Task 有效；纠正任何不匹配
  if (tool !== 'Task') {
    console.warn(`[delegation-routing] Provider/tool mismatch: ${provider} with ${tool}. Correcting to Task.`);
    tool = 'Task';
  }

  return {
    provider,
    tool,
    agentOrModel,
    reason: `Configured routing for role "${agentRole}"`,
    fallbackChain,
  };
}

/**
 * 使用默认值解析
 */
function resolveDefault(
  agentRole: string,
  config: DelegationRoutingConfig | undefined
): DelegationDecision {
  // 检查是否有该角色的默认 agent 映射
  const defaultAgent = ROLE_CATEGORY_DEFAULTS[agentRole];

  if (defaultAgent) {
    return {
      provider: 'claude',
      tool: 'Task',
      agentOrModel: defaultAgent,
      reason: `Default heuristic: role "${agentRole}" → Claude subagent "${defaultAgent}"`,
    };
  }

  // 兜底到默认提供方或 claude
  const defaultProvider = config?.defaultProvider || 'claude';

  if (isDeprecatedMcpProvider(defaultProvider)) {
    console.warn(DEPRECATED_MCP_PROVIDER_WARNING);
  }

  // 默认使用 claude Task（codex/gemini 默认提供方兜底到 claude）
  return {
    provider: 'claude',
    tool: 'Task',
    agentOrModel: agentRole,
    reason: `Fallback to Claude Task for role "${agentRole}"`,
  };
}

export function isDeprecatedMcpProvider(
  provider: DelegationRoute['provider'] | DelegationRoutingConfig['defaultProvider'],
): provider is 'codex' | 'gemini' {
  return provider ? DEPRECATED_MCP_PROVIDERS.has(provider) : false;
}

/**
 * 解析兜底链格式 ["claude:explore", "codex:gpt-5"]
 */
export function parseFallbackChain(
  fallback: string[] | undefined
): Array<{ provider: string; agentOrModel: string }> {
  if (!fallback || fallback.length === 0) {
    return [];
  }

  return fallback
    .map((entry) => {
      const parts = entry.split(':');
      if (parts.length >= 2) {
        const provider = parts[0].trim();
        const agentOrModel = parts.slice(1).join(':').trim(); // 处理形如 "codex:gpt-5.3-codex" 的情况
        // 跳过 provider 或 agent/model 为空的条目
        if (provider && agentOrModel) {
          return {
            provider,
            agentOrModel,
          };
        }
      }
      // 无效格式，跳过
      return null;
    })
    .filter((item): item is { provider: string; agentOrModel: string } => item !== null);
}
