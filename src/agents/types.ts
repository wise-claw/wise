/**
 * Wise 的 Agent 类型
 *
 * 定义用于动态 prompt 生成的 agent 配置与元数据类型。
 * 从 oh-my-opencode 的 agent 类型系统移植。
 */

import type { ModelType } from '../shared/types.js';
export type { ModelType };

/**
 * agent 使用的成本档位
 * 用于指导何时调用昂贵或便宜的 agent
 */
export type AgentCost = 'FREE' | 'CHEAP' | 'EXPENSIVE';

/**
 * 用于路由与分组的 agent 类别
 */
export type AgentCategory =
  | 'exploration'    // 代码搜索与发现
  | 'specialist'     // 特定领域实现
  | 'advisor'        // 战略咨询（只读）
  | 'utility'        // 通用辅助
  | 'orchestration'  // 多 agent 协调
  | 'planner'        // 战略规划
  | 'reviewer';      // 计划/工作评审

/**
 * 委派的触发条件
 */
export interface DelegationTrigger {
  /** 该触发器适用的领域或区域 */
  domain: string;
  /** 触发委派的条件 */
  trigger: string;
}

/**
 * 用于动态 prompt 生成的 agent 元数据
 * 这使 WISE 能自动构建委派表
 */
export interface AgentPromptMetadata {
  /** Agent 类别 */
  category: AgentCategory;
  /** 成本档位 */
  cost: AgentCost;
  /** prompt 的短别名 */
  promptAlias?: string;
  /** 触发向该 agent 委派的条件 */
  triggers: DelegationTrigger[];
  /** 何时使用该 agent */
  useWhen?: string[];
  /** 何时不应使用该 agent */
  avoidWhen?: string[];
  /** 用于动态 prompt 构建的描述 */
  promptDescription?: string;
  /** 该 agent 使用的工具（用于工具选择指导） */
  tools?: string[];
}

/**
 * 基础 agent 配置
 */
export interface AgentConfig {
  /** Agent 名称/标识符 */
  name: string;
  /** 用于 agent 选择的简短描述 */
  description: string;
  /** 该 agent 的系统 prompt */
  prompt: string;
  /** agent 可使用的工具（可选 — 省略时默认允许全部工具） */
  tools?: string[];
  /** 明确禁止该 agent 使用的工具 */
  disallowedTools?: string[];
  /** 要使用的模型（默认 sonnet） */
  model?: string;
  /** 该 agent 的默认模型（显式档位映射） */
  defaultModel?: string;
  /** 用于动态 prompt 生成的可选元数据 */
  metadata?: AgentPromptMetadata;
}

/**
 * 全字段可选的扩展 agent 配置
 */
export interface FullAgentConfig extends AgentConfig {
  /** Temperature 设置 */
  temperature?: number;
  /** 最大 token 数 */
  maxTokens?: number;
  /** Thinking 配置（用于 Claude 模型） */
  thinking?: {
    type: 'enabled' | 'disabled';
    budgetTokens?: number;
  };
  /** 工具限制 */
  toolRestrictions?: string[];
}

/**
 * 用于自定义的 agent 覆盖配置
 */
export interface AgentOverrideConfig {
  /** 覆盖模型 */
  model?: string;
  /** 启用/禁用 agent */
  enabled?: boolean;
  /** 追加到 prompt */
  prompt_append?: string;
  /** 覆盖 temperature */
  temperature?: number;
}

/**
 * agent 覆盖项的映射
 */
export type AgentOverrides = Partial<Record<string, AgentOverrideConfig>>;

/**
 * 用于创建 agent 的工厂函数签名
 */
export type AgentFactory = (model?: string) => AgentConfig;

/**
 * 用于 WISE prompt 构建的可用 agent 描述符
 */
export interface AvailableAgent {
  name: string;
  description: string;
  metadata: AgentPromptMetadata;
}

/**
 * 检查 model ID 是否为 GPT 模型
 */
export function isGptModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('gpt');
}

/**
 * 检查 model ID 是否为 Claude 模型
 */
export function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('claude');
}

/**
 * 获取某类别的默认模型
 */
export function getDefaultModelForCategory(category: AgentCategory): ModelType {
  switch (category) {
    case 'exploration':
      return 'haiku'; // 快速、便宜
    case 'specialist':
      return 'sonnet'; // 均衡
    case 'advisor':
      return 'opus'; // 高质量推理
    case 'utility':
      return 'haiku'; // 快速、便宜
    case 'orchestration':
      return 'sonnet'; // 均衡
    default:
      return 'sonnet';
  }
}
