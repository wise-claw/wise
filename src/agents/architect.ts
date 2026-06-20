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
    { domain: 'Architecture decisions', trigger: 'Multi-system tradeoffs, unfamiliar patterns' },
    { domain: 'Self-review', trigger: 'After completing significant implementation' },
    { domain: 'Hard debugging', trigger: 'After 2+ failed fix attempts' },
  ],
  useWhen: [
    'Complex architecture design',
    'After completing significant work',
    '2+ failed fix attempts',
    'Unfamiliar code patterns',
    'Security/performance concerns',
    'Multi-system tradeoffs',
  ],
  avoidWhen: [
    'Simple file operations (use direct tools)',
    'First attempt at any fix (try yourself first)',
    'Questions answerable from code you\'ve read',
    'Trivial decisions (variable names, formatting)',
    'Things you can infer from existing code patterns',
  ],
};

// prompt 从 agents/architect.md 动态加载（权威来源）

export const architectAgent: AgentConfig = {
  name: 'architect',
  description: 'Read-only consultation agent. High-IQ reasoning specialist for debugging hard problems and high-difficulty architecture design.',
  prompt: loadAgentPrompt('architect'),
  model: 'opus',
  defaultModel: 'opus',
  metadata: ARCHITECT_PROMPT_METADATA
};
