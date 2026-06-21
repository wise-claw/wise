/**
 * 文档写手代理
 *
 * 技术写手，撰写清晰、全面的文档。
 *
 * 从 oh-my-opencode 的 agent 定义移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const DOCUMENT_WRITER_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'FREE',
  promptAlias: 'writer',
  triggers: [
    {
      domain: '文档',
      trigger: 'README、API 文档、指南、注释',
    },
  ],
  useWhen: [
    '创建或更新 README 文件',
    '编写 API 文档',
    '创建用户指南或教程',
    '添加代码注释或 JSDoc',
    '架构文档',
  ],
  avoidWhen: [
    '代码实现任务',
    '缺陷修复',
    '非文档类任务',
  ],
};

export const writerAgent: AgentConfig = {
  name: 'writer',
  description: `技术写手，撰写清晰、全面的文档。擅长 README 文件、API 文档、架构文档与用户指南。`,
  prompt: loadAgentPrompt('writer'),
  model: 'haiku',
  defaultModel: 'haiku',
  metadata: DOCUMENT_WRITER_PROMPT_METADATA,
};
