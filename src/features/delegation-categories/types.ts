/**
 * 委派类别类型
 *
 * 基于 ComplexityTier 之上构建的类别化委派系统。
 * 类别提供语义分组，并附带 tier、temperature 与思考预算。
 */

import type { ComplexityTier } from '../model-routing/types.js';

/**
 * 用于委派的语义类别，映射到复杂度 tier + 配置
 */
export type DelegationCategory =
  | 'visual-engineering'
  | 'ultrabrain'
  | 'artistry'
  | 'quick'
  | 'writing'
  | 'unspecified-low'
  | 'unspecified-high';

/**
 * 思考预算级别
 */
export type ThinkingBudget = 'low' | 'medium' | 'high' | 'max';

/**
 * 委派类别的配置
 */
export interface CategoryConfig {
  /** 复杂度 tier（LOW/MEDIUM/HIGH） */
  tier: ComplexityTier;
  /** 模型采样的 temperature（0-1） */
  temperature: number;
  /** 思考预算级别 */
  thinkingBudget: ThinkingBudget;
  /** 该类别的可选 prompt 附言 */
  promptAppend?: string;
  /** 人类可读的描述 */
  description: string;
}

/**
 * 带完整配置的已解析类别
 */
export interface ResolvedCategory extends CategoryConfig {
  /** 类别标识符 */
  category: DelegationCategory;
}

/**
 * 类别解析的上下文
 */
export interface CategoryContext {
  /** 任务描述 */
  taskPrompt: string;
  /** 被委派的目标代理类型 */
  agentType?: string;
  /** 显式指定的类别（覆盖检测） */
  explicitCategory?: DelegationCategory;
  /** 显式指定的 tier（绕过类别） */
  explicitTier?: ComplexityTier;
}
