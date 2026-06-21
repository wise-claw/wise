/**
 * 探索者代理 - 快速模式匹配与代码搜索
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
    { domain: '内部代码库搜索', trigger: '查找实现、模式、文件' },
    { domain: '项目结构', trigger: '理解代码组织方式' },
    { domain: '代码发现', trigger: '按模式定位特定代码' },
  ],
  useWhen: [
    '按模式或名称查找文件',
    '在当前项目中搜索实现',
    '理解项目结构',
    '按内容或模式定位代码',
    '快速代码库探索',
  ],
  avoidWhen: [
    '外部文档、文献或学术论文查阅（使用 document-specialist）',
    '当前项目之外的数据库/参考/手册查阅（使用 document-specialist）',
    'GitHub/npm 包研究（使用 document-specialist）',
    '复杂架构分析（使用 architect）',
    '已知文件位置时',
  ],
};

export const exploreAgent: AgentConfig = {
  name: 'explore',
  description: '快速代码库探索与模式搜索。用于查找文件、理解结构、定位实现。仅搜索内部代码库；外部文档、文献、论文与参考数据库属于 document-specialist。',
  prompt: loadAgentPrompt('explore'),
  model: 'haiku',
  defaultModel: 'haiku',
  metadata: EXPLORE_PROMPT_METADATA
};
