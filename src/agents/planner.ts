/**
 * 规划者代理 - 策略规划顾问
 *
 * 策略规划顾问。
 *
 * 从 oh-my-opencode 的 agent 定义移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const PLANNER_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'planner',
  cost: 'EXPENSIVE',
  promptAlias: 'planner',
  triggers: [
    {
      domain: '策略规划',
      trigger: '全面工作计划、访谈式咨询',
    },
  ],
  useWhen: [
    '需要规划的复杂功能',
    '需求需通过访谈澄清时',
    '创建全面工作计划',
    '大型实现工作之前',
  ],
  avoidWhen: [
    '简单、直接的任务',
    '应当直接开始实现时',
    '计划已存在时',
  ],
};

export const plannerAgent: AgentConfig = {
  name: 'planner',
  description: `策略规划顾问。通过访谈用户理解需求，然后创建全面工作计划。绝不实现——只负责规划。`,
  prompt: loadAgentPrompt('planner'),
  model: 'opus',
  defaultModel: 'opus',
  metadata: PLANNER_PROMPT_METADATA,
};
