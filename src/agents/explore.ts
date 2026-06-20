/**
 * Explore Agent - 快速模式匹配与代码搜索
 *
 * 针对内部代码库的快速搜索与广泛探索进行优化。
 * 使用并行搜索策略以获得最高速度。
 *
 * 从 oh-my-opencode 的 explore agent 移植。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const EXPLORE_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'exploration',
  cost: 'CHEAP',
  promptAlias: 'Explore',
  triggers: [
    { domain: 'Internal codebase search', trigger: 'Finding implementations, patterns, files' },
    { domain: 'Project structure', trigger: 'Understanding code organization' },
    { domain: 'Code discovery', trigger: 'Locating specific code by pattern' },
  ],
  useWhen: [
    'Finding files by pattern or name',
    'Searching for implementations in current project',
    'Understanding project structure',
    'Locating code by content or pattern',
    'Quick codebase exploration',
  ],
  avoidWhen: [
    'External documentation, literature, or academic paper lookup (use document-specialist)',
    'Database/reference/manual lookups outside the current project (use document-specialist)',
    'GitHub/npm package research (use document-specialist)',
    'Complex architectural analysis (use architect)',
    'When you already know the file location',
  ],
};

export const exploreAgent: AgentConfig = {
  name: 'explore',
  description: 'Fast codebase exploration and pattern search. Use for finding files, understanding structure, locating implementations. Searches INTERNAL codebase only; external docs, literature, papers, and reference databases belong to document-specialist.',
  prompt: loadAgentPrompt('explore'),
  model: 'haiku',
  defaultModel: 'haiku',
  metadata: EXPLORE_PROMPT_METADATA
};
