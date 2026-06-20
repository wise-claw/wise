/**
 * 分层 prompt 适配
 *
 * 为 Opus、Sonnet、Haiku 提供针对各模型定制的 prompt 适配。
 * 每个 tier 都有针对该模型能力优化的 prompt。
 */

import type { ComplexityTier, PromptAdaptationStrategy } from '../types.js';
import { TIER_PROMPT_STRATEGIES } from '../types.js';

import { adaptPromptForOpus, OPUS_PROMPT_PREFIX, OPUS_PROMPT_SUFFIX } from './opus.js';
import { adaptPromptForSonnet, SONNET_PROMPT_PREFIX, SONNET_PROMPT_SUFFIX } from './sonnet.js';
import { adaptPromptForHaiku, HAIKU_PROMPT_PREFIX, HAIKU_PROMPT_SUFFIX } from './haiku.js';

// 重新导出各 tier 专用模块
export * from './opus.js';
export * from './sonnet.js';
export * from './haiku.js';

/**
 * 将 prompt 适配到指定的复杂度 tier
 */
export function adaptPromptForTier(prompt: string, tier: ComplexityTier): string {
  switch (tier) {
    case 'HIGH':
      return adaptPromptForOpus(prompt);
    case 'MEDIUM':
      return adaptPromptForSonnet(prompt);
    case 'LOW':
      return adaptPromptForHaiku(prompt);
  }
}

/**
 * 获取某个 tier 的 prompt 策略
 */
export function getPromptStrategy(tier: ComplexityTier): PromptAdaptationStrategy {
  return TIER_PROMPT_STRATEGIES[tier];
}

/**
 * 获取某个 tier 的 prompt 前缀
 */
export function getPromptPrefix(tier: ComplexityTier): string {
  switch (tier) {
    case 'HIGH':
      return OPUS_PROMPT_PREFIX;
    case 'MEDIUM':
      return SONNET_PROMPT_PREFIX;
    case 'LOW':
      return HAIKU_PROMPT_PREFIX;
  }
}

/**
 * 获取某个 tier 的 prompt 后缀
 */
export function getPromptSuffix(tier: ComplexityTier): string {
  switch (tier) {
    case 'HIGH':
      return OPUS_PROMPT_SUFFIX;
    case 'MEDIUM':
      return SONNET_PROMPT_SUFFIX;
    case 'LOW':
      return HAIKU_PROMPT_SUFFIX;
  }
}

/**
 * 创建带有适合该 tier 框架的委派 prompt
 */
export function createDelegationPrompt(
  tier: ComplexityTier,
  task: string,
  context: {
    deliverables?: string;
    successCriteria?: string;
    context?: string;
    mustDo?: string[];
    mustNotDo?: string[];
    requiredSkills?: string[];
    requiredTools?: string[];
  }
): string {
  const prefix = getPromptPrefix(tier);
  const suffix = getPromptSuffix(tier);

  let body = `### Task\n${task}\n`;

  if (context.deliverables) {
    body += `\n### Deliverables\n${context.deliverables}\n`;
  }

  if (context.successCriteria) {
    body += `\n### Success Criteria\n${context.successCriteria}\n`;
  }

  if (context.context) {
    body += `\n### Context\n${context.context}\n`;
  }

  if (context.mustDo?.length) {
    body += `\n### MUST DO\n${context.mustDo.map(m => `- ${m}`).join('\n')}\n`;
  }

  if (context.mustNotDo?.length) {
    body += `\n### MUST NOT DO\n${context.mustNotDo.map(m => `- ${m}`).join('\n')}\n`;
  }

  if (context.requiredSkills?.length) {
    body += `\n### REQUIRED SKILLS\n${context.requiredSkills.map(s => `- ${s}`).join('\n')}\n`;
  }

  if (context.requiredTools?.length) {
    body += `\n### REQUIRED TOOLS\n${context.requiredTools.map(t => `- ${t}`).join('\n')}\n`;
  }

  return prefix + body + suffix;
}

/**
 * 针对常见任务类型的各 tier 专用指令
 */
export const TIER_TASK_INSTRUCTIONS: Record<ComplexityTier, Record<string, string>> = {
  HIGH: {
    search: 'Perform thorough multi-angle search with analysis of findings.',
    implement: 'Design solution with tradeoff analysis before implementing.',
    debug: 'Deep root cause analysis with hypothesis testing.',
    review: 'Comprehensive evaluation against multiple criteria.',
    plan: 'Strategic planning with risk analysis and alternatives.',
  },
  MEDIUM: {
    search: 'Search efficiently, return structured results.',
    implement: 'Follow existing patterns, implement cleanly.',
    debug: 'Systematic debugging, fix the issue.',
    review: 'Check against criteria, provide feedback.',
    plan: 'Create actionable plan with clear steps.',
  },
  LOW: {
    search: 'Find and return paths.',
    implement: 'Make the change.',
    debug: 'Fix the bug.',
    review: 'Check it.',
    plan: 'List steps.',
  },
};

/**
 * 获取某个 tier 针对特定任务的指令
 */
export function getTaskInstructions(tier: ComplexityTier, taskType: string): string {
  return TIER_TASK_INSTRUCTIONS[tier][taskType] ?? TIER_TASK_INSTRUCTIONS[tier].implement;
}
