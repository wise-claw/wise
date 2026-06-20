/**
 * Executor Agent - 专注任务执行器
 *
 * 直接执行任务，不具备委派能力。
 * 与 WISE 同样的纪律，但独立工作。
 *
 * 从 oh-my-opencode 的 executor agent 移植。
 * prompt 加载自：agents/executor.md
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const EXECUTOR_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'CHEAP',
  promptAlias: 'Junior',
  triggers: [
    { domain: 'Direct implementation', trigger: 'Single-file changes, focused tasks' },
    { domain: 'Bug fixes', trigger: 'Clear, scoped fixes' },
    { domain: 'Small features', trigger: 'Well-defined, isolated work' },
  ],
  useWhen: [
    'Direct, focused implementation tasks',
    'Single-file or few-file changes',
    'When delegation overhead isn\'t worth it',
    'Clear, well-scoped work items',
  ],
  avoidWhen: [
    'Multi-file refactoring (use orchestrator)',
    'Tasks requiring research (use explore/document-specialist first)',
    'Complex decisions (consult architect)',
  ],
};

export const executorAgent: AgentConfig = {
  name: 'executor',
  description: 'Focused task executor. Execute tasks directly. NEVER delegate or spawn other agents. Same discipline as WISE, no delegation.',
  prompt: loadAgentPrompt('executor'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: EXECUTOR_PROMPT_METADATA
};
