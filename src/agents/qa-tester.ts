/**
 * QA 测试员代理 - 基于 tmux 的交互式 CLI 测试
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
    { domain: 'CLI 测试', trigger: '测试命令行应用' },
    { domain: '服务测试', trigger: '启动并测试后台服务' },
    { domain: '集成测试', trigger: '端到端 CLI 工作流验证' },
    { domain: '交互式测试', trigger: '测试需要用户输入的应用' },
  ],
  useWhen: [
    '测试需要交互式输入的 CLI 应用',
    '启动后台服务并验证其行为',
    '对命令行工具运行端到端测试',
    '测试产生流式输出的应用',
    '验证服务的启动与关闭行为',
  ],
  avoidWhen: [
    '单元测试（使用标准测试运行器）',
    '无 CLI 接口的 API 测试（直接使用 curl/httpie）',
    '静态代码分析（使用 architect 或 explore）',
  ],
};

export const qaTesterAgent: AgentConfig = {
  name: 'qa-tester',
  description: '基于 tmux 的交互式 CLI 测试专家。测试 CLI 应用、后台服务与交互式工具。管理测试会话、发送命令、验证输出，并确保环境清理。',
  prompt: loadAgentPrompt('qa-tester'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: QA_TESTER_PROMPT_METADATA
};
