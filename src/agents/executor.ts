/**
 * 执行器代理 - 专注任务执行器
 *
 * 直接执行任务，不具备委派能力。
 * 与 WISE 同样的纪律，但独立工作。
 *
 * 从 oh-my-opencode 的 executor agent 移植。
 * prompt 加载自：agents/executor.md
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const EXECUTOR_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'CHEAP',
  promptAlias: 'Junior',
  triggers: [
    { domain: '直接实现', trigger: '单文件变更、聚焦任务' },
    { domain: '缺陷修复', trigger: '清晰、范围明确的修复' },
    { domain: '小型功能', trigger: '定义明确、独立的工作' },
  ],
  useWhen: [
    '直接、聚焦的实现任务',
    '单文件或少量文件变更',
    '委派开销不值得时',
    '清晰、范围明确的工作项',
  ],
  avoidWhen: [
    '多文件重构（使用编排者）',
    '需要研究任务（先使用 explore/document-specialist）',
    '复杂决策（咨询 architect）',
  ],
};

export const executorAgent: AgentConfig = {
  name: 'executor',
  description: '专注任务执行器。直接执行任务。绝不委派或派生其他代理。与 WISE 同样的纪律，无委派能力。',
  prompt: loadAgentPrompt('executor'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: EXECUTOR_PROMPT_METADATA
};
