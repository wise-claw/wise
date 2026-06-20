/**
 * 路由规则
 *
 * 定义模型路由决策的规则引擎。
 * 规则按优先级顺序评估，首个匹配的规则生效。
 */

import type {
  RoutingRule,
  RoutingContext,
  ComplexitySignals,
  ComplexityTier,
} from './types.js';

/**
 * 默认路由规则，按优先级排序（最高优先在前）
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // ============ 覆盖规则（最高优先级）============

  {
    name: 'explicit-model-specified',
    condition: (ctx) => ctx.explicitModel !== undefined,
    action: { tier: 'EXPLICIT' as any, reason: 'User specified model explicitly' },
    priority: 100,
  },

  // 注意：所有代理现在都根据任务复杂度自适应
  // 包括：architect、planner、critic、analyst、explore、writer 等

  // ============ 建议类代理自适应规则 ============

  // Architect：简单查询 → LOW，追踪 → MEDIUM，调试/架构 → HIGH
  // 优先级更高（85），以覆盖 short-local-change 等通用规则
  {
    name: 'architect-complex-debugging',
    condition: (ctx, signals) =>
      ctx.agentType === 'architect' &&
      (signals.lexical.hasDebuggingKeywords ||
       signals.lexical.hasArchitectureKeywords ||
       signals.lexical.hasRiskKeywords),
    action: { tier: 'HIGH', reason: 'Architect: Complex debugging/architecture decision' },
    priority: 85,
  },

  {
    name: 'architect-simple-lookup',
    condition: (ctx, signals) =>
      ctx.agentType === 'architect' &&
      signals.lexical.hasSimpleKeywords &&
      !signals.lexical.hasDebuggingKeywords &&
      !signals.lexical.hasArchitectureKeywords &&
      !signals.lexical.hasRiskKeywords,
    action: { tier: 'LOW', reason: 'Architect: Simple lookup query' },
    priority: 80,
  },

  // Planner：简单拆分 → LOW，中等规划 → MEDIUM，跨领域 → HIGH
  {
    name: 'planner-simple-breakdown',
    condition: (ctx, signals) =>
      ctx.agentType === 'planner' &&
      signals.structural.estimatedSubtasks <= 3 &&
      !signals.lexical.hasRiskKeywords &&
      signals.structural.impactScope === 'local',
    action: { tier: 'LOW', reason: 'Planner: Simple task breakdown' },
    priority: 75,
  },

  {
    name: 'planner-strategic-planning',
    condition: (ctx, signals) =>
      ctx.agentType === 'planner' &&
      (signals.structural.impactScope === 'system-wide' ||
       signals.lexical.hasArchitectureKeywords ||
       signals.structural.estimatedSubtasks > 10),
    action: { tier: 'HIGH', reason: 'Planner: Cross-domain strategic planning' },
    priority: 75,
  },

  // Critic：清单检查 → LOW，差距分析 → MEDIUM，对抗性评审 → HIGH
  {
    name: 'critic-checklist-review',
    condition: (ctx, signals) =>
      ctx.agentType === 'critic' &&
      signals.lexical.wordCount < 30 &&
      !signals.lexical.hasRiskKeywords,
    action: { tier: 'LOW', reason: 'Critic: Checklist verification' },
    priority: 75,
  },

  {
    name: 'critic-adversarial-review',
    condition: (ctx, signals) =>
      ctx.agentType === 'critic' &&
      (signals.lexical.hasRiskKeywords || signals.structural.impactScope === 'system-wide'),
    action: { tier: 'HIGH', reason: 'Critic: Adversarial review for critical system' },
    priority: 75,
  },

  // Analyst：简单影响分析 → LOW，依赖梳理 → MEDIUM，风险分析 → HIGH
  {
    name: 'analyst-simple-impact',
    condition: (ctx, signals) =>
      ctx.agentType === 'analyst' &&
      signals.structural.impactScope === 'local' &&
      !signals.lexical.hasRiskKeywords,
    action: { tier: 'LOW', reason: 'Analyst: Simple impact analysis' },
    priority: 75,
  },

  {
    name: 'analyst-risk-analysis',
    condition: (ctx, signals) =>
      ctx.agentType === 'analyst' &&
      (signals.lexical.hasRiskKeywords || signals.structural.impactScope === 'system-wide'),
    action: { tier: 'HIGH', reason: 'Analyst: Risk analysis and unknown-unknowns detection' },
    priority: 75,
  },

  // ============ 基于任务的规则 ============

  {
    name: 'architecture-system-wide',
    condition: (ctx, signals) =>
      signals.lexical.hasArchitectureKeywords &&
      signals.structural.impactScope === 'system-wide',
    action: { tier: 'HIGH', reason: 'Architectural decisions with system-wide impact' },
    priority: 70,
  },

  {
    name: 'security-domain',
    condition: (ctx, signals) =>
      signals.structural.domainSpecificity === 'security',
    action: { tier: 'HIGH', reason: 'Security-related tasks require careful reasoning' },
    priority: 70,
  },

  {
    name: 'difficult-reversibility-risk',
    condition: (ctx, signals) =>
      signals.structural.reversibility === 'difficult' &&
      signals.lexical.hasRiskKeywords,
    action: { tier: 'HIGH', reason: 'High-risk, difficult-to-reverse changes' },
    priority: 70,
  },

  {
    name: 'deep-debugging',
    condition: (ctx, signals) =>
      signals.lexical.hasDebuggingKeywords &&
      signals.lexical.questionDepth === 'why',
    action: { tier: 'HIGH', reason: 'Root cause analysis requires deep reasoning' },
    priority: 65,
  },

  {
    name: 'complex-multi-step',
    condition: (ctx, signals) =>
      signals.structural.estimatedSubtasks > 5 &&
      signals.structural.crossFileDependencies,
    action: { tier: 'HIGH', reason: 'Complex multi-step task with cross-file changes' },
    priority: 60,
  },

  {
    name: 'simple-search-query',
    condition: (ctx, signals) =>
      signals.lexical.hasSimpleKeywords &&
      signals.structural.estimatedSubtasks <= 1 &&
      signals.structural.impactScope === 'local' &&
      !signals.lexical.hasArchitectureKeywords &&
      !signals.lexical.hasDebuggingKeywords,
    action: { tier: 'LOW', reason: 'Simple search or lookup task' },
    priority: 60,
  },

  {
    name: 'short-local-change',
    condition: (ctx, signals) =>
      signals.lexical.wordCount < 50 &&
      signals.structural.impactScope === 'local' &&
      signals.structural.reversibility === 'easy' &&
      !signals.lexical.hasRiskKeywords,
    action: { tier: 'LOW', reason: 'Short, local, easily reversible change' },
    priority: 55,
  },

  {
    name: 'moderate-complexity',
    condition: (ctx, signals) =>
      signals.structural.estimatedSubtasks > 1 &&
      signals.structural.estimatedSubtasks <= 5,
    action: { tier: 'MEDIUM', reason: 'Moderate complexity with multiple subtasks' },
    priority: 50,
  },

  {
    name: 'module-level-work',
    condition: (ctx, signals) =>
      signals.structural.impactScope === 'module',
    action: { tier: 'MEDIUM', reason: 'Module-level changes' },
    priority: 45,
  },

  // ============ 默认规则 ============

  {
    name: 'default-medium',
    condition: () => true,
    action: { tier: 'MEDIUM', reason: 'Default tier for unclassified tasks' },
    priority: 0,
  },
];

/**
 * 评估路由规则，返回首个匹配规则的动作
 */
export function evaluateRules(
  context: RoutingContext,
  signals: ComplexitySignals,
  rules: RoutingRule[] = DEFAULT_ROUTING_RULES
): { tier: ComplexityTier | 'EXPLICIT'; reason: string; ruleName: string } {
  // 按优先级排序规则（最高优先在前）
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (rule.condition(context, signals)) {
      return {
        tier: rule.action.tier,
        reason: rule.action.reason,
        ruleName: rule.name,
      };
    }
  }

  // 由于存在默认规则，理论上不会到达此处，但以防万一
  return {
    tier: 'MEDIUM',
    reason: 'Fallback to medium tier',
    ruleName: 'fallback',
  };
}

/**
 * 获取给定上下文下所有会匹配的规则（用于调试）
 */
export function getMatchingRules(
  context: RoutingContext,
  signals: ComplexitySignals,
  rules: RoutingRule[] = DEFAULT_ROUTING_RULES
): RoutingRule[] {
  return rules.filter(rule => rule.condition(context, signals));
}

/**
 * 创建自定义路由规则
 */
export function createRule(
  name: string,
  condition: (context: RoutingContext, signals: ComplexitySignals) => boolean,
  tier: ComplexityTier,
  reason: string,
  priority: number
): RoutingRule {
  return {
    name,
    condition,
    action: { tier, reason },
    priority,
  };
}

/**
 * 将自定义规则与默认规则合并
 */
export function mergeRules(customRules: RoutingRule[]): RoutingRule[] {
  // 同名自定义规则覆盖默认规则
  const customNames = new Set(customRules.map(r => r.name));
  const filteredDefaults = DEFAULT_ROUTING_RULES.filter(
    r => !customNames.has(r.name)
  );
  return [...customRules, ...filteredDefaults];
}
