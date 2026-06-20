/**
 * 模型路由特性
 *
 * 智能模型路由系统，根据任务复杂度将子代理任务路由到合适的
 * 模型（Opus/Sonnet/Haiku）。
 *
 * 用法：
 * ```typescript
 * import { routeTask, routeWithEscalation, adaptPromptForTier } from './model-routing';
 *
 * const decision = routeTask({
 *   taskPrompt: "Find where authentication is implemented",
 *   agentType: "explore"
 * });
 *
 * console.log(decision.tier);  // 'LOW'
 * console.log(decision.model); // 'claude-haiku-4-5-20251001'
 * ```
 */

// 重新导出类型
export type {
  ComplexityTier,
  ComplexitySignals,
  LexicalSignals,
  StructuralSignals,
  ContextSignals,
  RoutingDecision,
  RoutingContext,
  RoutingConfig,
  RoutingRule,
  PromptAdaptationStrategy,
} from './types.js';

export {
  TIER_MODELS,
  TIER_TO_MODEL_TYPE,
  DEFAULT_ROUTING_CONFIG,
  AGENT_CATEGORY_TIERS,
  COMPLEXITY_KEYWORDS,
  TIER_PROMPT_STRATEGIES,
} from './types.js';

// 重新导出信号提取
export {
  extractLexicalSignals,
  extractStructuralSignals,
  extractContextSignals,
  extractAllSignals,
} from './signals.js';

// 重新导出评分
export {
  calculateComplexityScore,
  calculateComplexityTier,
  scoreToTier,
  getScoreBreakdown,
  calculateConfidence,
} from './scorer.js';

// 重新导出规则
export {
  DEFAULT_ROUTING_RULES,
  evaluateRules,
  getMatchingRules,
  createRule,
  mergeRules,
} from './rules.js';

// 重新导出路由
export {
  routeTask,
  routeWithEscalation,
  getRoutingRecommendation,
  getModelForTask,
  analyzeTaskComplexity,
  escalateModel,
  canEscalate,
  explainRouting,
  quickTierForAgent,
} from './router.js';

// 重新导出 prompt 适配
export {
  adaptPromptForTier,
  getPromptStrategy,
  getPromptPrefix,
  getPromptSuffix,
  createDelegationPrompt,
  getTaskInstructions,
  TIER_TASK_INSTRUCTIONS,
} from './prompts/index.js';

// 为 routeAndAdaptTask 便捷函数做的本地导入
import { routeWithEscalation } from './router.js';
import { adaptPromptForTier } from './prompts/index.js';

/**
 * 一次性完成路由与 prompt 适配的便捷函数
 */
export function routeAndAdaptTask(
  taskPrompt: string,
  agentType?: string,
  previousFailures?: number
): { decision: import('./types.js').RoutingDecision; adaptedPrompt: string } {
  const decision = routeWithEscalation({
    taskPrompt,
    agentType,
    previousFailures,
  });

  const adaptedPrompt = adaptPromptForTier(taskPrompt, decision.tier);

  return {
    decision,
    adaptedPrompt,
  };
}
