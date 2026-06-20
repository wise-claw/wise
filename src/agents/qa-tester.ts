/**
 * QA Tester Agent - 基于 tmux 的交互式 CLI 测试
 *
 * 专用 agent，使用 tmux 管理会话并对 CLI 应用与服务进行交互式 QA 测试。
 *
 * 支持：
 * - 在隔离的 tmux 会话中启动服务
 * - 发送命令并捕获输出
 * - 校验 CLI 行为与响应
 * - 测试环境的干净清理
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const QA_TESTER_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'CHEAP',
  promptAlias: 'QATester',
  triggers: [
    { domain: 'CLI testing', trigger: 'Testing command-line applications' },
    { domain: 'Service testing', trigger: 'Starting and testing background services' },
    { domain: 'Integration testing', trigger: 'End-to-end CLI workflow verification' },
    { domain: 'Interactive testing', trigger: 'Testing applications requiring user input' },
  ],
  useWhen: [
    'Testing CLI applications that need interactive input',
    'Starting background services and verifying their behavior',
    'Running end-to-end tests on command-line tools',
    'Testing applications that produce streaming output',
    'Verifying service startup and shutdown behavior',
  ],
  avoidWhen: [
    'Unit testing (use standard test runners)',
    'API testing without CLI interface (use curl/httpie directly)',
    'Static code analysis (use architect or explore)',
  ],
};

export const qaTesterAgent: AgentConfig = {
  name: 'qa-tester',
  description: 'Interactive CLI testing specialist using tmux. Tests CLI applications, background services, and interactive tools. Manages test sessions, sends commands, verifies output, and ensures cleanup.',
  prompt: loadAgentPrompt('qa-tester'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: QA_TESTER_PROMPT_METADATA
};
