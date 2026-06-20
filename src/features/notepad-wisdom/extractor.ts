/**
 * Wisdom 提取器
 *
 * 解析 agent 完成响应，提取 wisdom 条目。
 */

import type { WisdomCategory } from './types.js';

export interface ExtractedWisdom {
  category: WisdomCategory;
  content: string;
}

/**
 * 从 agent 完成响应中提取 wisdom
 *
 * 查找如下格式的 wisdom 块：
 * - <wisdom category="learnings">content</wisdom>
 * - <learning>content</learning>
 * - <decision>content</decision>
 * - <issue>content</issue>
 * - <problem>content</problem>
 */
export function extractWisdomFromCompletion(response: string): ExtractedWisdom[] {
  const extracted: ExtractedWisdom[] = [];

  // 模式 1：<wisdom category="...">content</wisdom>
  const wisdomTagRegex = /<wisdom\s+category=["'](\w+)["']>([\s\S]*?)<\/wisdom>/gi;
  let match;

  while ((match = wisdomTagRegex.exec(response)) !== null) {
    const category = match[1].toLowerCase() as WisdomCategory;
    const content = match[2].trim();

    if (isValidCategory(category) && content) {
      extracted.push({ category, content });
    }
  }

  // 模式 2：<learning>、<decision>、<issue>、<problem> 标签
  const _categories: WisdomCategory[] = ['learnings', 'decisions', 'issues', 'problems'];
  const singularMap: Record<string, WisdomCategory> = {
    learning: 'learnings',
    decision: 'decisions',
    issue: 'issues',
    problem: 'problems',
  };

  for (const [singular, category] of Object.entries(singularMap)) {
    const tagRegex = new RegExp(`<${singular}>([\s\S]*?)<\/${singular}>`, 'gi');

    while ((match = tagRegex.exec(response)) !== null) {
      const content = match[1].trim();
      if (content) {
        extracted.push({ category, content });
      }
    }
  }

  return extracted;
}

/**
 * 校验 wisdom 类别
 */
function isValidCategory(category: string): category is WisdomCategory {
  return ['learnings', 'decisions', 'issues', 'problems'].includes(category);
}

/**
 * 按类别提取 wisdom
 */
export function extractWisdomByCategory(
  response: string,
  targetCategory: WisdomCategory
): string[] {
  const allWisdom = extractWisdomFromCompletion(response);
  return allWisdom
    .filter(w => w.category === targetCategory)
    .map(w => w.content);
}

/**
 * 检查响应是否包含 wisdom
 */
export function hasWisdom(response: string): boolean {
  return extractWisdomFromCompletion(response).length > 0;
}
