/**
 * Agent 工具函数
 *
 * 用于 agent 创建与管理的共享工具。
 * 包含 prompt 构建器与配置辅助函数。
 *
 * 从 oh-my-opencode 的 agent utils 移植。
 */

import { readFileSync } from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

import type {
  AgentConfig,
  AgentPromptMetadata,
  AvailableAgent,
  AgentOverrideConfig,
  ModelType
} from './types.js';
// ============================================================
// 动态 prompt 加载
// ============================================================

/**
 * 构建时注入的 agent prompts 映射。
 * esbuild 在 bridge 构建期间将其替换为 { role: "prompt content" } 对象。
 * 在开发/测试（未打包）环境中，它保持 undefined，我们兜底为运行时文件读取。
 */
declare const __AGENT_PROMPTS__: Record<string, string> | undefined;

/**
 * 获取包根目录（agents/ 文件夹所在位置）。
 * 同时处理 ESM (import.meta.url) 与 CJS bundle (__dirname) 上下文。
 * 在 CJS bundle 中，__dirname 始终可靠，应优先使用。
 * 这样可避免打包过程中 import.meta.url 被 shim 时产生的路径偏差。
 */
function getPackageDir(): string {
  // __dirname 在打包后的 CJS 以及某些测试转译上下文中可用。
  if (typeof __dirname !== 'undefined' && __dirname) {
    const currentDirName = basename(__dirname);
    const parentDirName = basename(dirname(__dirname));

    // 打包后的 CLI 路径：bridge/cli.cjs -> 包根目录在上一级。
    if (currentDirName === 'bridge') {
      return join(__dirname, '..');
    }

    // 源码/dist 模块路径（src/agents 或 dist/agents）-> 包根目录在上两级。
    if (currentDirName === 'agents' && (parentDirName === 'src' || parentDirName === 'dist')) {
      return join(__dirname, '..', '..');
    }
  }

  // ESM 路径（在开发环境下通过 ts/dist 生效）
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const currentDirName = basename(__dirname);
    if (currentDirName === 'bridge') {
      return join(__dirname, '..');
    }
    // 从 src/agents/ 或 dist/agents/ 向上回到包根目录
    return join(__dirname, '..', '..');
  } catch {
    // import.meta.url 不可用 — 最后手段
  }

  // 最后手段
  return process.cwd();
}

/**
 * 从 markdown 内容中剥离 YAML frontmatter。
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * 从 /agents/{agentName}.md 加载 agent prompt
 * 可用时优先使用构建时内嵌的 prompt（CJS bundle），
 * 兜底为运行时文件读取（开发/测试环境）。
 *
 * 安全性：校验 agent 名以防止路径遍历攻击
 */
export function loadAgentPrompt(agentName: string): string {
  // 安全性：校验 agent 名仅含安全字符（字母数字与连字符）
  // 这可防止类似 "../../etc/passwd" 的路径遍历攻击
  if (!/^[a-z0-9-]+$/i.test(agentName)) {
    throw new Error(`Invalid agent name: contains disallowed characters`);
  }

  // 优先使用构建时内嵌的 prompt（CJS bundle 中始终可用）
  try {
    if (typeof __AGENT_PROMPTS__ !== 'undefined' && __AGENT_PROMPTS__ !== null) {
      const prompt = __AGENT_PROMPTS__[agentName];
      if (prompt) return prompt;
    }
  } catch {
    // __AGENT_PROMPTS__ 未定义 — 继续走向运行时文件读取
  }

  // 运行时兜底：从文件系统读取（开发/测试环境）
  try {
    const agentsDir = join(getPackageDir(), 'agents');
    const agentPath = join(agentsDir, `${agentName}.md`);

    // 安全性：校验解析后的路径是否位于 agents 目录内
    const resolvedPath = resolve(agentPath);
    const resolvedAgentsDir = resolve(agentsDir);
    const rel = relative(resolvedAgentsDir, resolvedPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Invalid agent name: path traversal detected`);
    }

    const content = readFileSync(agentPath, 'utf-8');
    return stripFrontmatter(content);
  } catch (error) {
    // 不要在错误信息中泄露内部路径
    const message = error instanceof Error && error.message.includes('Invalid agent name')
      ? error.message
      : '未找到 Agent prompt 文件';
    console.warn(`[loadAgentPrompt] ${message}`);
    return `Agent: ${agentName}\n\nPrompt unavailable.`;
  }
}

/**
 * 创建工具限制配置
 * 返回一个可展开到 agent 配置中以限制工具的对象
 */
export function createAgentToolRestrictions(
  blockedTools: string[]
): { tools: Record<string, boolean> } {
  const restrictions: Record<string, boolean> = {};
  for (const tool of blockedTools) {
    restrictions[tool.toLowerCase()] = false;
  }
  return { tools: restrictions };
}

/**
 * 将 agent 配置与覆盖项合并
 */
export function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  const { prompt_append, ...rest } = override;

  const merged: AgentConfig = {
    ...base,
    ...(rest.model && { model: rest.model as ModelType }),
    ...(rest.enabled !== undefined && { enabled: rest.enabled })
  };

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + '\n\n' + prompt_append;
  }

  return merged;
}

/**
 * 为 WISE prompt 构建委派表小节
 */
export function buildDelegationTable(availableAgents: AvailableAgent[]): string {
  if (availableAgents.length === 0) {
    return '';
  }

  const rows = availableAgents
    .filter(a => a.metadata.triggers.length > 0)
    .map(a => {
      const triggers = a.metadata.triggers
        .map(t => `${t.domain}: ${t.trigger}`)
        .join('; ');
      return `| ${a.metadata.promptAlias || a.name} | ${a.metadata.cost} | ${triggers} |`;
    });

  if (rows.length === 0) {
    return '';
  }

  return `### Agent 委派表

| Agent | 成本 | 何时使用 |
|-------|------|----------|
${rows.join('\n')}`;
}

/**
 * 为某个 agent 构建 use/avoid 小节
 */
export function buildUseAvoidSection(metadata: AgentPromptMetadata): string {
  const sections: string[] = [];

  if (metadata.useWhen && metadata.useWhen.length > 0) {
    sections.push(`**使用时机：**
${metadata.useWhen.map(u => `- ${u}`).join('\n')}`);
  }

  if (metadata.avoidWhen && metadata.avoidWhen.length > 0) {
    sections.push(`**避免时机：**
${metadata.avoidWhen.map(a => `- ${a}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * 为 agent 创建环境上下文
 */
export function createEnvContext(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return `
<env-context>
  当前时间: ${timeStr}
  时区: ${timezone}
  语言区域: ${locale}
</env-context>`;
}

/**
 * 以 AvailableAgent 描述符的形式获取所有可用 agent
 */
export function getAvailableAgents(
  agents: Record<string, AgentConfig>
): AvailableAgent[] {
  return Object.entries(agents)
    .filter(([_, config]) => config.metadata)
    .map(([name, config]) => ({
      name,
      description: config.description,
      metadata: config.metadata!
    }));
}

/**
 * 为 WISE prompt 构建关键触发器小节
 */
export function buildKeyTriggersSection(
  availableAgents: AvailableAgent[]
): string {
  const triggers: string[] = [];

  for (const agent of availableAgents) {
    for (const trigger of agent.metadata.triggers) {
      triggers.push(`- **${trigger.domain}** → ${agent.metadata.promptAlias || agent.name}: ${trigger.trigger}`);
    }
  }

  if (triggers.length === 0) {
    return '';
  }

  return `### 关键触发器（行动前检查）

${triggers.join('\n')}`;
}

/**
 * 校验 agent 配置
 */
export function validateAgentConfig(config: AgentConfig): string[] {
  const errors: string[] = [];

  if (!config.name) {
    errors.push('Agent 名称为必填项');
  }

  if (!config.description) {
    errors.push('Agent 描述为必填项');
  }

  if (!config.prompt) {
    errors.push('Agent prompt 为必填项');
  }

  // 注意：tools 现为可选 — 若省略，agent 默认获得全部工具

  return errors;
}

/**
 * 从 agent markdown frontmatter 中解析 disallowedTools
 */
export function parseDisallowedTools(agentName: string): string[] | undefined {
  // 安全性：校验 agent 名仅含安全字符（字母数字与连字符）
  if (!/^[a-z0-9-]+$/i.test(agentName)) {
    return undefined;
  }

  try {
    const agentsDir = join(getPackageDir(), 'agents');
    const agentPath = join(agentsDir, `${agentName}.md`);

    // 安全性：校验解析后的路径是否位于 agents 目录内
    const resolvedPath = resolve(agentPath);
    const resolvedAgentsDir = resolve(agentsDir);
    const rel = relative(resolvedAgentsDir, resolvedPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return undefined;
    }

    const content = readFileSync(agentPath, 'utf-8');

    // 提取 frontmatter
    const match = content.match(/^---[\s\S]*?---/);
    if (!match) return undefined;

    // 查找 disallowedTools 行
    const disallowedMatch = match[0].match(/^disallowedTools:\s*(.+)/m);
    if (!disallowedMatch) return undefined;

    // 解析逗号分隔的列表
    return disallowedMatch[1].split(',').map(t => t.trim()).filter(Boolean);
  } catch {
    return undefined;
  }
}

/**
 * open questions 文件的标准路径
 */
export const OPEN_QUESTIONS_PATH = '.wise/plans/open-questions.md';

/**
 * 格式化 open questions，以便追加到标准的 open-questions.md 文件。
 *
 * @param topic - 计划或分析主题名
 * @param questions - { question, reason } 对象数组
 * @returns 可直接追加的已格式化 markdown 字符串
 */
export function formatOpenQuestions(
  topic: string,
  questions: Array<{ question: string; reason: string }>
): string {
  if (questions.length === 0) return '';

  const date = new Date().toISOString().split('T')[0];
  const items = questions
    .map(q => `- [ ] ${q.question} — ${q.reason}`)
    .join('\n');

  return `\n## ${topic} - ${date}\n${items}\n`;
}

/**
 * 用于配置的深度合并工具
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const sourceValue = source[key as keyof T];
    const targetValue = target[key as keyof T];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }

  return result;
}
