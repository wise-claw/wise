/**
 * 架构师代理 - 架构与调试专家
 *
 * 只读咨询 agent，用于战略性架构决策与复杂调试。
 *
 * 从 oh-my-opencode 的 architect agent 移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const ARCHITECT_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'advisor',
  cost: 'EXPENSIVE',
  promptAlias: 'architect',
  triggers: [
    { domain: '架构决策', trigger: '多系统权衡、不熟悉的模式' },
    { domain: '自我评审', trigger: '完成重要实现之后' },
    { domain: '疑难调试', trigger: '修复尝试失败 2 次以上' },
  ],
  useWhen: [
    '复杂架构设计',
    '完成重要工作之后',
    '修复尝试失败 2 次以上',
    '不熟悉的代码模式',
    '安全/性能问题',
    '多系统权衡',
  ],
  avoidWhen: [
    '简单文件操作（使用直接工具）',
    '任何修复的首次尝试（先自己尝试）',
    '可从已读代码中回答的问题',
    '琐碎决策（变量名、格式）',
    '可从现有代码模式推断的内容',
  ],
};

// prompt 从 agents/architect.md 动态加载（权威来源）

export const architectAgent: AgentConfig = {
  name: 'architect',
  description: '只读咨询 agent。高推理能力专家，用于疑难问题调试与高难度架构设计。',
  prompt: loadAgentPrompt('architect'),
  model: 'opus',
  defaultModel: 'opus',
  metadata: ARCHITECT_PROMPT_METADATA
};
