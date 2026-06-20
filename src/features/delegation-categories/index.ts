/**
 * 委派类别
 *
 * 基于 ComplexityTier 之上构建的类别化委派系统。
 * 提供语义分组，并自动设置 tier、temperature 与 thinking budget。
 *
 * 用法：
 * ```typescript
 * import { resolveCategory, getCategoryForTask } from './delegation-categories';
 *
 * // 显式类别
 * const config = resolveCategory('ultrabrain');
 * console.log(config.tier);  // 'HIGH'
 * console.log(config.temperature);  // 0.3
 *
 * // 从任务自动检测类别
 * const detected = getCategoryForTask({ taskPrompt: "Design a beautiful dashboard" });
 * console.log(detected.category);  // 'visual-engineering'
 * ```
 */

import type {
  DelegationCategory,
  CategoryConfig,
  ResolvedCategory,
  CategoryContext,
  ThinkingBudget,
} from './types.js';
import type { ComplexityTier } from '../model-routing/types.js';

/**
 * 类别配置定义
 */
export const CATEGORY_CONFIGS: Record<DelegationCategory, CategoryConfig> = {
  'visual-engineering': {
    tier: 'HIGH',
    temperature: 0.7,
    thinkingBudget: 'high',
    description: 'UI/visual reasoning, frontend work, design systems',
    promptAppend: 'Focus on visual design, user experience, and aesthetic quality. Consider accessibility, responsive design, and visual hierarchy.',
  },
  'ultrabrain': {
    tier: 'HIGH',
    temperature: 0.3,
    thinkingBudget: 'max',
    description: 'Complex reasoning, architecture decisions, deep debugging',
    promptAppend: 'Think deeply and systematically. Consider all edge cases, implications, and long-term consequences. Reason through the problem step by step.',
  },
  'artistry': {
    tier: 'MEDIUM',
    temperature: 0.9,
    thinkingBudget: 'medium',
    description: 'Creative writing, novel approaches, innovative solutions',
    promptAppend: 'Be creative and explore unconventional solutions. Think outside the box while maintaining practical feasibility.',
  },
  'quick': {
    tier: 'LOW',
    temperature: 0.1,
    thinkingBudget: 'low',
    description: 'Simple lookups, straightforward tasks, basic operations',
    promptAppend: 'Be concise and efficient. Focus on accuracy and speed.',
  },
  'writing': {
    tier: 'MEDIUM',
    temperature: 0.5,
    thinkingBudget: 'medium',
    description: 'Documentation, technical writing, content creation',
    promptAppend: 'Focus on clarity, completeness, and proper structure. Use appropriate technical terminology while remaining accessible.',
  },
  'unspecified-low': {
    tier: 'LOW',
    temperature: 0.3,
    thinkingBudget: 'low',
    description: 'Default for simple tasks when category is not specified',
  },
  'unspecified-high': {
    tier: 'HIGH',
    temperature: 0.5,
    thinkingBudget: 'high',
    description: 'Default for complex tasks when category is not specified',
  },
};

/**
 * 思考预算的 token 上限（近似值）
 */
export const THINKING_BUDGET_TOKENS: Record<ThinkingBudget, number> = {
  low: 1000,
  medium: 5000,
  high: 10000,
  max: 32000,
};

/**
 * 用于类别检测的关键词。
 *
 * 注意：这些关键词与 model-routing/types.ts 中的 COMPLEXITY_KEYWORDS 有意重叠。
 * 两套系统用途不同：
 * - COMPLEXITY_KEYWORDS：依据复杂度决定模型 tier（haiku/sonnet/opus）
 * - CATEGORY_KEYWORDS：通过 promptAppend 提供语义上下文以增强指引
 *
 * 两者可以匹配同一个 prompt——类别用上下文相关的指令增强 prompt，
 * 而 model-routing 独立选择合适的模型 tier。
 */
const CATEGORY_KEYWORDS: Record<DelegationCategory, string[]> = {
  'visual-engineering': [
    'ui', 'ux', 'design', 'frontend', 'component', 'style', 'css', 'visual',
    'layout', 'responsive', 'interface', 'dashboard', 'form', 'button',
    'theme', 'color', 'typography', 'animation', 'interactive',
  ],
  'ultrabrain': [
    'architecture', 'design pattern', 'refactor', 'optimize', 'debug',
    'root cause', 'analyze', 'investigate', 'complex', 'system',
    'performance', 'scalability', 'concurrency', 'race condition',
  ],
  'artistry': [
    'creative', 'innovative', 'novel', 'unique', 'original',
    'brainstorm', 'ideate', 'explore', 'imagine', 'unconventional',
  ],
  'quick': [
    'find', 'search', 'locate', 'list', 'show', 'get', 'fetch',
    'where is', 'what is', 'display', 'print', 'lookup',
  ],
  'writing': [
    'document', 'readme', 'comment', 'explain', 'describe',
    'write', 'draft', 'article', 'guide', 'tutorial', 'docs',
  ],
  'unspecified-low': [],
  'unspecified-high': [],
};

/**
 * 将类别解析为完整配置
 *
 * @param category - 要解析的类别
 * @returns 带配置的已解析类别
 */
export function resolveCategory(category: DelegationCategory): ResolvedCategory {
  const config = CATEGORY_CONFIGS[category];
  if (!config) {
    throw new Error(`Unknown delegation category: ${category}`);
  }

  return {
    category,
    ...config,
  };
}

/**
 * 检查字符串是否为有效的委派类别
 *
 * @param category - 要检查的字符串
 * @returns 若为有效类别则返回 true
 */
export function isValidCategory(category: string): category is DelegationCategory {
  return category in CATEGORY_CONFIGS;
}

/**
 * 获取所有可用类别
 *
 * @returns 所有委派类别的数组
 */
export function getAllCategories(): DelegationCategory[] {
  return Object.keys(CATEGORY_CONFIGS) as DelegationCategory[];
}

/**
 * 获取某个类别的描述
 *
 * @param category - 类别
 * @returns 人类可读的描述
 */
export function getCategoryDescription(category: DelegationCategory): string {
  return CATEGORY_CONFIGS[category].description;
}

/**
 * 通过关键词匹配从任务提示词中检测类别
 *
 * @param taskPrompt - 任务描述
 * @returns 最佳匹配的类别或 null
 */
export function detectCategoryFromPrompt(taskPrompt: string): DelegationCategory | null {
  const lowerPrompt = taskPrompt.toLowerCase();
  const scores: Record<DelegationCategory, number> = {
    'visual-engineering': 0,
    'ultrabrain': 0,
    'artistry': 0,
    'quick': 0,
    'writing': 0,
    'unspecified-low': 0,
    'unspecified-high': 0,
  };

  // 根据关键词匹配为每个类别计分
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerPrompt.includes(keyword)) {
        scores[category as DelegationCategory]++;
      }
    }
  }

  // 找到得分最高的类别（排除 unspecified）
  let maxScore = 0;
  let bestCategory: DelegationCategory | null = null;

  for (const category of getAllCategories()) {
    if (category.startsWith('unspecified-')) continue;

    if (scores[category] > maxScore) {
      maxScore = scores[category];
      bestCategory = category;
    }
  }

  // 至少需要 2 个关键词匹配才算可信
  if (maxScore >= 2 && bestCategory) {
    return bestCategory;
  }

  return null;
}

/**
 * 结合上下文获取任务的类别
 *
 * @param context - 类别解析上下文
 * @returns 已解析的类别
 */
export function getCategoryForTask(context: CategoryContext): ResolvedCategory {
  // 显式 tier 绕过类别
  if (context.explicitTier) {
    const category: DelegationCategory = context.explicitTier === 'LOW' ? 'unspecified-low' : 'unspecified-high';
    return resolveCategory(category);
  }

  // 显式类别
  if (context.explicitCategory) {
    return resolveCategory(context.explicitCategory);
  }

  // 从任务提示词自动检测
  const detected = detectCategoryFromPrompt(context.taskPrompt);
  if (detected) {
    return resolveCategory(detected);
  }

  // 默认使用 medium tier
  return resolveCategory('unspecified-high');
}

/**
 * 从类别获取 tier（用于向后兼容）
 *
 * @param category - 委派类别
 * @returns 复杂度 tier
 */
export function getCategoryTier(category: DelegationCategory): ComplexityTier {
  return CATEGORY_CONFIGS[category].tier;
}

/**
 * 从类别获取 temperature
 *
 * @param category - 委派类别
 * @returns temperature 值
 */
export function getCategoryTemperature(category: DelegationCategory): number {
  return CATEGORY_CONFIGS[category].temperature;
}

/**
 * 从类别获取思考预算
 *
 * @param category - 委派类别
 * @returns 思考预算级别
 */
export function getCategoryThinkingBudget(category: DelegationCategory): ThinkingBudget {
  return CATEGORY_CONFIGS[category].thinkingBudget;
}

/**
 * 获取以 token 为单位的思考预算
 *
 * @param category - 委派类别
 * @returns token 预算
 */
export function getCategoryThinkingBudgetTokens(category: DelegationCategory): number {
  const budget = CATEGORY_CONFIGS[category].thinkingBudget;
  return THINKING_BUDGET_TOKENS[budget];
}

/**
 * 获取类别的 prompt 附言
 *
 * @param category - 委派类别
 * @returns prompt 附言或空字符串
 */
export function getCategoryPromptAppend(category: DelegationCategory): string {
  return CATEGORY_CONFIGS[category].promptAppend || '';
}

/**
 * 创建带有类别专属指引的委派 prompt
 *
 * @param taskPrompt - 基础任务 prompt
 * @param category - 委派类别
 * @returns 带类别指引的增强 prompt
 */
export function enhancePromptWithCategory(
  taskPrompt: string,
  category: DelegationCategory
): string {
  const config = CATEGORY_CONFIGS[category];

  if (!config.promptAppend) {
    return taskPrompt;
  }

  return `${taskPrompt}\n\n${config.promptAppend}`;
}

// 重新导出类型
export type {
  DelegationCategory,
  CategoryConfig,
  ResolvedCategory,
  CategoryContext,
  ThinkingBudget,
} from './types.js';
