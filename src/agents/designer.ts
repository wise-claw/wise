/**
 * 前端工程师代理
 *
 * 由设计师转身的开发者，打造出色的 UI/UX。
 *
 * 从 oh-my-opencode 的 agent 定义移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const FRONTEND_ENGINEER_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'CHEAP',
  promptAlias: 'designer',
  triggers: [
    {
      domain: 'UI/UX',
      trigger: '视觉变更、样式、组件、无障碍',
    },
    {
      domain: '设计',
      trigger: '布局、动画、响应式设计',
    },
  ],
  useWhen: [
    '视觉样式或布局变更',
    '组件设计或重构',
    '动画实现',
    '无障碍改进',
    '响应式设计工作',
  ],
  avoidWhen: [
    '前端文件中的纯逻辑变更',
    '后端/API 工作',
    '非视觉重构',
  ],
};

export const designerAgent: AgentConfig = {
  name: 'designer',
  description: `由设计师转身的开发者，即使没有设计稿也能打造出色的 UI/UX。仅用于视觉变更（样式、布局、动画）。前端文件中的纯逻辑变更应直接处理。`,
  prompt: loadAgentPrompt('designer'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: FRONTEND_ENGINEER_PROMPT_METADATA,
};
