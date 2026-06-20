/**
 * 模型路由类型
 *
 * 智能模型路由系统的类型定义，该系统根据任务复杂度
 * 将子代理任务路由到合适的模型（Opus/Sonnet/Haiku）。
 */

import type { ModelType } from '../../shared/types.js';
import { getDefaultTierModels } from '../../config/models.js';

/**
 * 任务路由的复杂度档位
 */
export type ComplexityTier = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * 模型档位到实际 Claude 模型的映射。
 *
 * 从环境变量（WISE_MODEL_HIGH、WISE_MODEL_MEDIUM、
 * WISE_MODEL_LOW）读取，并内置兜底值。用户/项目级配置覆盖
 * 由配置加载器在后续阶段应用。
 */
export const TIER_MODELS: Record<ComplexityTier, string> = getDefaultTierModels();

/**
 * 模型档位到简单模型类型的映射
 */
export const TIER_TO_MODEL_TYPE: Record<ComplexityTier, ModelType> = {
  LOW: 'haiku',
  MEDIUM: 'sonnet',
  HIGH: 'opus',
};

/**
 * 词法/语法信号，无需调用模型即可提取
 */
export interface LexicalSignals {
  /** 任务提示的词数 */
  wordCount: number;
  /** 提及的文件路径数量 */
  filePathCount: number;
  /** 提示中的代码块数量 */
  codeBlockCount: number;
  /** 是否包含架构相关关键词 */
  hasArchitectureKeywords: boolean;
  /** 是否包含调试相关关键词 */
  hasDebuggingKeywords: boolean;
  /** 是否包含简单搜索关键词 */
  hasSimpleKeywords: boolean;
  /** 是否包含风险/关键关键词 */
  hasRiskKeywords: boolean;
  /** 问题深度：'why' > 'how' > 'what' > 'where' */
  questionDepth: 'why' | 'how' | 'what' | 'where' | 'none';
  /** 是否存在隐式需求（缺乏明确交付物的表述） */
  hasImplicitRequirements: boolean;
}

/**
 * 需要解析的结构信号
 */
export interface StructuralSignals {
  /** 估算的子任务数量 */
  estimatedSubtasks: number;
  /** 改动是否跨多个文件 */
  crossFileDependencies: boolean;
  /** 是否需要测试 */
  hasTestRequirements: boolean;
  /** 任务的领域专属性 */
  domainSpecificity: 'generic' | 'frontend' | 'backend' | 'infrastructure' | 'security';
  /** 是否需要外部知识 */
  requiresExternalKnowledge: boolean;
  /** 改动的可回滚程度 */
  reversibility: 'easy' | 'moderate' | 'difficult';
  /** 影响范围 */
  impactScope: 'local' | 'module' | 'system-wide';
}

/**
 * 来自会话状态的上下文信号
 */
export interface ContextSignals {
  /** 本任务的前序失败次数 */
  previousFailures: number;
  /** 对话轮数 */
  conversationTurns: number;
  /** 当前计划的复杂度（任务数量） */
  planComplexity: number;
  /** 计划中剩余的任务数量 */
  remainingTasks: number;
  /** 代理委派链的深度 */
  agentChainDepth: number;
}

/**
 * 合并后的复杂度信号
 */
export interface ComplexitySignals {
  lexical: LexicalSignals;
  structural: StructuralSignals;
  context: ContextSignals;
}

/**
 * 路由决策结果
 */
export interface RoutingDecision {
  /** 选定的模型 ID */
  model: string;
  /** 选定的模型类型 */
  modelType: ModelType;
  /** 复杂度档位 */
  tier: ComplexityTier;
  /** 置信度分数（0-1） */
  confidence: number;
  /** 决策理由 */
  reasons: string[];
  /** 针对该档位适配后的提示（可选） */
  adaptedPrompt?: string;
  /** 是否触发了升级 */
  escalated: boolean;
  /** 升级前的原始档位（若已升级） */
  originalTier?: ComplexityTier;
}

/**
 * 用于做出路由决策的上下文
 */
export interface RoutingContext {
  /** 待路由的任务提示 */
  taskPrompt: string;
  /** 目标代理类型（若指定） */
  agentType?: string;
  /** 用于上下文的父会话 ID */
  parentSession?: string;
  /** 前序失败次数 */
  previousFailures?: number;
  /** 当前对话轮数 */
  conversationTurns?: number;
  /** 当前计划的任务数量 */
  planTasks?: number;
  /** 计划中剩余的任务 */
  remainingTasks?: number;
  /** 当前代理链深度 */
  agentChainDepth?: number;
  /** 显式模型覆盖（绕过路由） */
  explicitModel?: ModelType;
}

/**
 * 路由规则定义
 */
export interface RoutingRule {
  /** 规则名称，用于日志/调试 */
  name: string;
  /** 判断规则是否适用的条件函数 */
  condition: (context: RoutingContext, signals: ComplexitySignals) => boolean;
  /** 条件为真时执行的动作 */
  action: {
    tier: ComplexityTier | 'EXPLICIT';
    reason: string;
  };
  /** 优先级（数值越大越先评估） */
  priority: number;
}

/**
 * 路由配置
 */
export interface RoutingConfig {
  /** 是否启用路由 */
  enabled: boolean;
  /** 无规则匹配时的默认档位 */
  defaultTier: ComplexityTier;
  /**
   * 强制所有代理继承父模型，绕过所有路由。
   * 为 true 时，routeTask 返回 'inherit' 模型类型，从而在调用
   * Task/Agent 时不传入 model 参数。
   */
  forceInherit?: boolean;
  /** 允许的最低档位（如将 minTier 设为 MEDIUM 以禁用 LOW 档） */
  minTier?: ComplexityTier;
  /** 是否启用自动升级 */
  escalationEnabled: boolean;
  /** 最大升级次数 */
  maxEscalations: number;
  /** 各档位的模型映射 */
  tierModels: Record<ComplexityTier, string>;
  /** 按代理类型的覆盖配置 */
  agentOverrides?: Record<string, {
    tier: ComplexityTier;
    reason: string;
  }>;
  /** 强制升级的关键词 */
  escalationKeywords?: string[];
  /** 提示使用更低档位的关键词 */
  simplificationKeywords?: string[];
}

/**
 * 默认路由配置
 *
 * 所有代理均根据任务复杂度自适应。
 */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  enabled: true,
  defaultTier: 'MEDIUM',
  escalationEnabled: false,  // 已废弃：编排器主动路由
  maxEscalations: 0,
  tierModels: TIER_MODELS,
  agentOverrides: {},
  escalationKeywords: [
    'critical', 'production', 'urgent', 'security', 'breaking',
    'architecture', 'refactor', 'redesign', 'root cause',
  ],
  simplificationKeywords: [
    'find', 'list', 'show', 'where', 'search', 'locate', 'grep',
  ],
};

/**
 * 代理类别及其默认复杂度档位
 */
export const AGENT_CATEGORY_TIERS: Record<string, ComplexityTier> = {
  exploration: 'LOW',
  utility: 'LOW',
  specialist: 'MEDIUM',
  orchestration: 'MEDIUM',
  advisor: 'HIGH',
  planner: 'HIGH',
  reviewer: 'HIGH',
};

/**
 * 复杂度检测关键词
 */
export const COMPLEXITY_KEYWORDS = {
  architecture: [
    'architecture', 'refactor', 'redesign', 'restructure', 'reorganize',
    'decouple', 'modularize', 'abstract', 'pattern', 'design',
  ],
  debugging: [
    'debug', 'diagnose', 'root cause', 'investigate', 'trace', 'analyze',
    'why is', 'figure out', 'understand why', 'not working',
  ],
  simple: [
    'find', 'search', 'locate', 'list', 'show', 'where is', 'what is',
    'get', 'fetch', 'display', 'print',
  ],
  risk: [
    'critical', 'production', 'urgent', 'security', 'breaking', 'dangerous',
    'irreversible', 'data loss', 'migration', 'deploy',
  ],
};

/**
 * 各档位的提示适配策略
 */
export type PromptAdaptationStrategy = 'full' | 'balanced' | 'concise';

export const TIER_PROMPT_STRATEGIES: Record<ComplexityTier, PromptAdaptationStrategy> = {
  HIGH: 'full',
  MEDIUM: 'balanced',
  LOW: 'concise',
};
