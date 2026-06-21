/**
 * 评审者代理
 *
 * 专家计划评审者，以严苛标准进行评估。
 *
 * 从 oh-my-opencode 的 agent 定义移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const CRITIC_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'reviewer',
  cost: 'EXPENSIVE',
  promptAlias: 'critic',
  triggers: [
    {
      domain: '计划评审',
      trigger: '执行前评估工作计划',
    },
  ],
  useWhen: [
    '规划者创建工作计划之后',
    '执行复杂计划之前',
    '需要验证计划质量时',
    '实现前捕捉遗漏点',
  ],
  avoidWhen: [
    '简单、直接的任务',
    '没有可评审的计划时',
    '实现阶段进行中',
  ],
};

export const criticAgent: AgentConfig = {
  name: 'critic',
  description: `专家评审者，以严苛的清晰度、可验证性与完整性标准评估工作计划。在规划者创建工作计划之后、执行之前用于验证。`,
  prompt: loadAgentPrompt('critic'),
  model: 'opus',
  defaultModel: 'opus',
  metadata: CRITIC_PROMPT_METADATA,
};
