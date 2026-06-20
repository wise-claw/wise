/**
 * 模型路由器
 *
 * 主路由引擎，决定给定任务使用哪个模型档位。
 * 结合信号提取、评分与规则评估。
 */

import type {
  RoutingContext,
  RoutingDecision,
  RoutingConfig,
  ComplexityTier,
} from './types.js';
import {
  DEFAULT_ROUTING_CONFIG,
  TIER_TO_MODEL_TYPE,
} from './types.js';
import { extractAllSignals } from './signals.js';
import { calculateComplexityScore, calculateConfidence, scoreToTier } from './scorer.js';
import { evaluateRules, DEFAULT_ROUTING_RULES } from './rules.js';

/**
 * 将任务路由到合适的模型档位
 */
export function routeTask(
  context: RoutingContext,
  config: Partial<RoutingConfig> = {}
): RoutingDecision {
  const mergedConfig = { ...DEFAULT_ROUTING_CONFIG, ...config };

  // 若启用 forceInherit，则绕过所有路由，让子代理继承父模型（issue #1135）
  if (mergedConfig.forceInherit) {
    return {
      model: 'inherit',
      modelType: 'inherit',
      tier: 'MEDIUM',
      confidence: 1.0,
      reasons: ['forceInherit enabled: agents inherit parent model'],
      escalated: false,
    };
  }

  // 若路由被禁用，使用默认档位
  if (!mergedConfig.enabled) {
    return createDecision(mergedConfig.defaultTier, mergedConfig.tierModels, ['Routing disabled, using default tier'], false);
  }

  // 若显式指定了模型，遵从该指定
  if (context.explicitModel) {
    const explicitTier = modelTypeToTier(context.explicitModel);
    return createDecision(explicitTier, mergedConfig.tierModels, ['Explicit model specified by user'], false, explicitTier);
  }

  // 检查是否有按代理类型的覆盖配置
  if (context.agentType && mergedConfig.agentOverrides?.[context.agentType]) {
    const override = mergedConfig.agentOverrides[context.agentType];
    return createDecision(override.tier, mergedConfig.tierModels, [override.reason], false, override.tier);
  }

  // 从任务中提取信号
  const signals = extractAllSignals(context.taskPrompt, context);

  // 评估路由规则
  const ruleResult = evaluateRules(context, signals, DEFAULT_ROUTING_RULES);

  if (ruleResult.tier === 'EXPLICIT') {
    // 显式模型已在上方处理，此处不应到达
    return createDecision('MEDIUM', mergedConfig.tierModels, ['Unexpected EXPLICIT tier'], false);
  }

  // 计算分数以用于置信度与日志
  const score = calculateComplexityScore(signals);
  const scoreTier = scoreToTier(score);
  let confidence = calculateConfidence(score, ruleResult.tier);

  let finalTier = ruleResult.tier;
  const tierOrder: ComplexityTier[] = ['LOW', 'MEDIUM', 'HIGH'];
  const ruleIdx = tierOrder.indexOf(ruleResult.tier);
  const scoreIdx = tierOrder.indexOf(scoreTier);

  // 当评分器与规则分歧超过 1 级时，降低置信度
  // 并优先采用更高档位，以避免资源不足
  const divergence = Math.abs(ruleIdx - scoreIdx);
  if (divergence > 1) {
    confidence = Math.min(confidence, 0.5);
    finalTier = tierOrder[Math.max(ruleIdx, scoreIdx)];
  }

  const reasons = [
    ruleResult.reason,
    `Rule: ${ruleResult.ruleName}`,
    `Score: ${score} (${scoreTier} tier by score)`,
    ...(divergence > 1 ? [`Scorer/rules divergence (${divergence} levels): confidence reduced, preferred higher tier`] : []),
  ];

  // 若配置了 minTier 则强制执行下限
  if (mergedConfig.minTier) {
    const currentIdx = tierOrder.indexOf(finalTier);
    const minIdx = tierOrder.indexOf(mergedConfig.minTier);
    if (currentIdx < minIdx) {
      finalTier = mergedConfig.minTier;
      reasons.push(`Min tier enforced: ${ruleResult.tier} -> ${finalTier}`);
    }
  }

  return {
    model: mergedConfig.tierModels[finalTier],
    modelType: TIER_TO_MODEL_TYPE[finalTier],
    tier: finalTier,
    confidence,
    reasons,
    escalated: false,
  };
}

/**
 * 为给定档位创建路由决策
 */
function createDecision(
  tier: ComplexityTier,
  tierModels: Record<ComplexityTier, string>,
  reasons: string[],
  escalated: boolean,
  originalTier?: ComplexityTier
): RoutingDecision {
  return {
    model: tierModels[tier],
    modelType: TIER_TO_MODEL_TYPE[tier],
    tier,
    confidence: escalated ? 0.9 : 0.7, // 升级后置信度更高
    reasons,
    escalated,
    originalTier,
  };
}

/**
 * 将 ModelType 转换为 ComplexityTier
 */
function modelTypeToTier(modelType: string): ComplexityTier {
  switch (modelType) {
    case 'opus':
      return 'HIGH';
    case 'haiku':
      return 'LOW';
    case 'sonnet':
    default:
      return 'MEDIUM';
  }
}

/**
 * 失败后升级到更高档位
 */
export function escalateModel(currentTier: ComplexityTier): ComplexityTier {
  switch (currentTier) {
    case 'LOW':
      return 'MEDIUM';
    case 'MEDIUM':
      return 'HIGH';
    case 'HIGH':
      return 'HIGH'; // 已是最高档
  }
}

/**
 * 检查是否还能进一步升级
 */
export function canEscalate(currentTier: ComplexityTier): boolean {
  return currentTier !== 'HIGH';
}

/**
 * 为编排器获取路由建议
 *
 * 面向主动式（PROACTIVE）路由设计——编排器（Opus）在委派之前
 * 分析任务复杂度并选择合适的模型档位。
 *
 * 而非响应式升级——即在前期就选好正确的模型。
 */
export function getRoutingRecommendation(
  context: RoutingContext,
  config: Partial<RoutingConfig> = {}
): RoutingDecision {
  return routeTask(context, config);
}

/**
 * 遗留：带升级支持的路由
 * @deprecated 主动式路由请改用 getRoutingRecommendation。
 * 编排器应在前期分析复杂度，而非事后响应式升级。
 */
export function routeWithEscalation(
  context: RoutingContext,
  config: Partial<RoutingConfig> = {}
): RoutingDecision {
  // 直接返回路由建议
  // 响应式升级已废弃——编排器应在前期决定
  return routeTask(context, config);
}

/**
 * 获取路由解释，用于调试/日志
 */
export function explainRouting(
  context: RoutingContext,
  config: Partial<RoutingConfig> = {}
): string {
  const decision = routeTask(context, config);
  const signals = extractAllSignals(context.taskPrompt, context);

  const lines = [
    '=== Model Routing Decision ===',
    `Task: ${context.taskPrompt.substring(0, 100)}${context.taskPrompt.length > 100 ? '...' : ''}`,
    `Agent: ${context.agentType ?? 'unspecified'}`,
    '',
    '--- Signals ---',
    `Word count: ${signals.lexical.wordCount}`,
    `File paths: ${signals.lexical.filePathCount}`,
    `Architecture keywords: ${signals.lexical.hasArchitectureKeywords}`,
    `Debugging keywords: ${signals.lexical.hasDebuggingKeywords}`,
    `Simple keywords: ${signals.lexical.hasSimpleKeywords}`,
    `Risk keywords: ${signals.lexical.hasRiskKeywords}`,
    `Question depth: ${signals.lexical.questionDepth}`,
    `Estimated subtasks: ${signals.structural.estimatedSubtasks}`,
    `Cross-file: ${signals.structural.crossFileDependencies}`,
    `Impact scope: ${signals.structural.impactScope}`,
    `Reversibility: ${signals.structural.reversibility}`,
    `Previous failures: ${signals.context.previousFailures}`,
    '',
    '--- Decision ---',
    `Tier: ${decision.tier}`,
    `Model: ${decision.model}`,
    `Confidence: ${decision.confidence}`,
    `Escalated: ${decision.escalated}`,
    '',
    '--- Reasons ---',
    ...decision.reasons.map(r => `  - ${r}`),
  ];

  return lines.join('\n');
}

/**
 * 已知代理类型的快速档位查询
 * 适用于不需要完整信号分析的场景
 */
export function quickTierForAgent(agentType: string): ComplexityTier | null {
  const agentTiers: Record<string, ComplexityTier> = {
    architect: 'HIGH',
    planner: 'HIGH',
    critic: 'HIGH',
    analyst: 'HIGH',
    explore: 'LOW',
    'writer': 'LOW',
    'document-specialist': 'MEDIUM',
    researcher: 'MEDIUM',
    'test-engineer': 'MEDIUM',
    'tdd-guide': 'MEDIUM',
    'executor': 'MEDIUM',
    'designer': 'MEDIUM',
    'vision': 'MEDIUM',
  };

  return agentTiers[agentType] ?? null;
}


/**
 * 根据任务复杂度获取为代理推荐的模型
 *
 * 这是编排器模型路由的主入口。
 * 编排器在委派时调用此函数以决定使用哪个模型。
 *
 * 所有代理均根据任务复杂度自适应。
 *
 * @param agentType - 要委派到的代理
 * @param taskPrompt - 任务描述
 * @returns 推荐的模型类型（'haiku'、'sonnet' 或 'opus'）
 */
export function getModelForTask(
  agentType: string,
  taskPrompt: string,
  config: Partial<RoutingConfig> = {}
): { model: 'haiku' | 'sonnet' | 'opus'; tier: ComplexityTier; reason: string } {
  // 所有代理均根据任务复杂度自适应
  // 建议类代理使用代理专属规则，其他代理使用通用规则
  const decision = routeTask({ taskPrompt, agentType }, config);

  return {
    model: decision.modelType as 'haiku' | 'sonnet' | 'opus',
    tier: decision.tier,
    reason: decision.reasons[0] ?? 'Complexity analysis',
  };
}


/**
 * 为编排器生成复杂度分析摘要
 *
 * 返回人类可读的分析说明，解释路由建议。
 */
export function analyzeTaskComplexity(
  taskPrompt: string,
  agentType?: string
): {
  tier: ComplexityTier;
  model: string;
  analysis: string;
  signals: {
    wordCount: number;
    hasArchitectureKeywords: boolean;
    hasRiskKeywords: boolean;
    estimatedSubtasks: number;
    impactScope: string;
  };
} {
  const signals = extractAllSignals(taskPrompt, { taskPrompt, agentType });
  const decision = routeTask({ taskPrompt, agentType });

  const analysis = [
    `**Tier: ${decision.tier}** → ${decision.model}`,
    '',
    '**Why:**',
    ...decision.reasons.map(r => `- ${r}`),
    '',
    '**Signals detected:**',
    signals.lexical.hasArchitectureKeywords ? '- Architecture keywords (refactor, redesign, etc.)' : null,
    signals.lexical.hasRiskKeywords ? '- Risk keywords (migration, production, critical)' : null,
    signals.lexical.hasDebuggingKeywords ? '- Debugging keywords (root cause, investigate)' : null,
    signals.structural.crossFileDependencies ? '- Cross-file dependencies' : null,
    signals.structural.impactScope === 'system-wide' ? '- System-wide impact' : null,
    signals.structural.reversibility === 'difficult' ? '- Difficult to reverse' : null,
  ].filter(Boolean).join('\n');

  return {
    tier: decision.tier,
    model: decision.model,
    analysis,
    signals: {
      wordCount: signals.lexical.wordCount,
      hasArchitectureKeywords: signals.lexical.hasArchitectureKeywords,
      hasRiskKeywords: signals.lexical.hasRiskKeywords,
      estimatedSubtasks: signals.structural.estimatedSubtasks,
      impactScope: signals.structural.impactScope,
    },
  };
}
