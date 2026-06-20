/**
 * 文档写手 Agent
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
      domain: 'Documentation',
      trigger: 'README, API docs, guides, comments',
    },
  ],
  useWhen: [
    'Creating or updating README files',
    'Writing API documentation',
    'Creating user guides or tutorials',
    'Adding code comments or JSDoc',
    'Architecture documentation',
  ],
  avoidWhen: [
    'Code implementation tasks',
    'Bug fixes',
    'Non-documentation tasks',
  ],
};

export const writerAgent: AgentConfig = {
  name: 'writer',
  description: `Technical writer who crafts clear, comprehensive documentation. Specializes in README files, API docs, architecture docs, and user guides.`,
  prompt: loadAgentPrompt('writer'),
  model: 'haiku',
  defaultModel: 'haiku',
  metadata: DOCUMENT_WRITER_PROMPT_METADATA,
};
