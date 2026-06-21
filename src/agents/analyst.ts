/**
 * 分析师代理
 *
 * 计划前的顾问，用于识别隐藏需求。
 *
 * 从 oh-my-opencode 的 agent 定义移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const ANALYST_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'planner',
  cost: 'EXPENSIVE',
  promptAlias: 'analyst',
  triggers: [
    {
      domain: '规划前阶段',
      trigger: '隐藏需求、边界情况、风险分析',
    },
  ],
  useWhen: [
    '创建工作计划之前',
    '需求看起来不完整时',
    '用于识别隐藏的假设',
    '实现前的风险分析',
    '范围确认',
  ],
  avoidWhen: [
    '简单、定义明确的任务',
    '实现阶段进行中',
    '计划已被评审时',
  ],
};

export const analystAgent: AgentConfig = {
  name: 'analyst',
  description: `规划前顾问，在实现之前分析请求以识别隐藏需求、边界情况与潜在风险。在创建工作计划之前使用。`,
  prompt: loadAgentPrompt('analyst'),
  model: 'opus',
  defaultModel: 'opus',
  metadata: ANALYST_PROMPT_METADATA,
};
