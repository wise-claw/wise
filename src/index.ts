/**
 * Wise
 *
 * 面向 Claude Agent SDK 的自进化多智能体编排系统。
 *
 * 主要特性：
 * - 自进化：智能体基于反馈与上下文持续演进
 * - 多智能体编排：委派给专业化子智能体
 * - 并行执行：后台智能体并发运行
 * - LSP/AST 工具：为智能体提供 IDE 级能力
 * - 上下文管理：从上下文文件自动注入
 * - 续跑强制：确保任务在停止前完成
 * - 魔法关键词：用于增强行为的特殊触发器
 */

import { loadConfig, findContextFiles, loadContextFromFiles } from './config/loader.js';
import { getAgentDefinitions, wiseSystemPrompt } from './agents/definitions.js';
import { getDefaultMcpServers, toSdkMcpFormat } from './mcp/servers.js';
import { wiseToolsServer, getWiseToolNames } from './mcp/wise-tools-server.js';
import { createMagicKeywordProcessor, detectMagicKeywords } from './features/magic-keywords.js';
import { continuationSystemPromptAddition } from './features/continuation-enforcement.js';
import { appendSkininthegamebrosGuidance } from './agents/skininthegamebros-guidance.js';
import {
  createBackgroundTaskManager,
  shouldRunInBackground as shouldRunInBackgroundFn,
  type BackgroundTaskManager,
  type TaskExecutionDecision
} from './features/background-tasks.js';
import type { PluginConfig, SessionState } from './shared/types.js';

export { loadConfig, getAgentDefinitions, wiseSystemPrompt };
export { getDefaultMcpServers, toSdkMcpFormat } from './mcp/servers.js';
export { lspTools, astTools, allCustomTools } from './tools/index.js';
export { wiseToolsServer, wiseToolNames, getWiseToolNames } from './mcp/wise-tools-server.js';
export { createMagicKeywordProcessor, detectMagicKeywords } from './features/magic-keywords.js';
export {
  createBackgroundTaskManager,
  shouldRunInBackground,
  getBackgroundTaskGuidance,
  DEFAULT_MAX_BACKGROUND_TASKS,
  LONG_RUNNING_PATTERNS,
  BLOCKING_PATTERNS,
  type BackgroundTaskManager,
  type TaskExecutionDecision
} from './features/background-tasks.js';
export {
  // 自动更新类型
  type VersionMetadata,
  type ReleaseInfo,
  type UpdateCheckResult,
  type UpdateResult,
  // 自动更新常量
  REPO_OWNER,
  REPO_NAME,
  GITHUB_API_URL,
  CLAUDE_CONFIG_DIR,
  VERSION_FILE,
  // 自动更新函数
  getInstalledVersion,
  saveVersionMetadata,
  checkForUpdates,
  performUpdate,
  formatUpdateNotification,
  shouldCheckForUpdates,
  backgroundUpdateCheck,
  compareVersions
} from './features/auto-update.js';
export * from './shared/index.js';

// 钩子模块导出
export * from './hooks/index.js';

// 特性模块导出（boulder-state、context-injector）
export {
  // Boulder 状态
  type BoulderState,
  type PlanProgress,
  type PlanSummary,
  BOULDER_DIR,
  BOULDER_FILE,
  BOULDER_STATE_PATH,
  NOTEPAD_DIR,
  NOTEPAD_BASE_PATH,
  PLANNER_PLANS_DIR,
  PLAN_EXTENSION,
  getBoulderFilePath,
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  clearBoulderState,
  findPlannerPlans,
  getPlanProgress,
  getPlanName,
  createBoulderState,
  getPlanSummaries,
  hasBoulder,
  getActivePlanPath,
  // 上下文注入器
  ContextCollector,
  contextCollector,
  injectPendingContext,
  injectContextIntoText,
  createContextInjectorHook,
  type ContextSourceType,
  type ContextPriority,
  type ContextEntry,
  type RegisterContextOptions,
  type PendingContext,
  type MessageContext,
  type OutputPart,
  type InjectionStrategy,
  type InjectionResult
} from './features/index.js';
export { searchSessionHistory, parseSinceSpec, type SessionHistoryMatch, type SessionHistorySearchOptions, type SessionHistorySearchReport } from './features/index.js';

// 智能体模块导出（模块化智能体系统）
export {
  // 类型
  type ModelType,
  type AgentCost,
  type AgentCategory,
  type DelegationTrigger,
  type AgentPromptMetadata,
  type AgentConfig,
  type FullAgentConfig,
  type AgentOverrideConfig,
  type AgentOverrides,
  type AgentFactory,
  type AvailableAgent,
  isGptModel,
  isClaudeModel,
  getDefaultModelForCategory,
  // 工具方法
  createAgentToolRestrictions,
  mergeAgentConfig,
  buildDelegationTable,
  buildUseAvoidSection,
  createEnvContext,
  getAvailableAgents,
  buildKeyTriggersSection,
  validateAgentConfig,
  deepMerge,
  loadAgentPrompt,
  // 带元数据的独立智能体（重命名为直观名称）
  architectAgent,
  ARCHITECT_PROMPT_METADATA,
  exploreAgent,
  EXPLORE_PROMPT_METADATA,
  DOCUMENT_SPECIALIST_PROMPT_METADATA,
  tracerAgent,
  TRACER_PROMPT_METADATA,
  executorAgent,
  EXECUTOR_PROMPT_METADATA,
  designerAgent,
  FRONTEND_ENGINEER_PROMPT_METADATA,
  writerAgent,
  DOCUMENT_WRITER_PROMPT_METADATA,
  criticAgent,
  CRITIC_PROMPT_METADATA,
  analystAgent,
  ANALYST_PROMPT_METADATA,
  plannerAgent,
  PLANNER_PROMPT_METADATA,
} from './agents/index.js';

/** @deprecated 请改用 documentSpecialistAgent */
export { documentSpecialistAgent as researcherAgent } from './agents/document-specialist.js';

// 用于 SDK 集成的命令展开工具
export {
  expandCommand,
  expandCommandPrompt,
  getCommand,
  getAllCommands,
  listCommands,
  commandExists,
  expandCommands,
  getCommandsDir,
  type CommandInfo,
  type ExpandedCommand
} from './commands/index.js';

// 安装器导出
export {
  install,
  isInstalled,
  getInstallInfo,
  isClaudeInstalled,
  CLAUDE_CONFIG_DIR as INSTALLER_CLAUDE_CONFIG_DIR,
  AGENTS_DIR,
  COMMANDS_DIR,
  VERSION as INSTALLER_VERSION,
  type InstallResult,
  type InstallOptions
} from './installer/index.js';

/**
 * 创建 WISE 会话的选项
 */
export interface WiseOptions {
  /** 自定义配置（与已加载配置合并） */
  config?: Partial<PluginConfig>;
  /** 工作目录（默认：process.cwd()） */
  workingDirectory?: string;
  /** 跳过加载配置文件 */
  skipConfigLoad?: boolean;
  /** 跳过上下文文件注入 */
  skipContextInjection?: boolean;
  /** 自定义系统 prompt 追加内容 */
  customSystemPrompt?: string;
  /** API key（默认：取自 ANTHROPIC_API_KEY 环境变量） */
  apiKey?: string;
}

/**
 * 创建 WISE 会话的结果
 */
export interface WiseSession {
  /** 传给 Claude Agent SDK 的查询选项 */
  queryOptions: {
    options: {
      systemPrompt: string;
      agents: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>;
      mcpServers: Record<string, { command: string; args: string[] }>;
      allowedTools: string[];
      permissionMode: string;
    };
  };
  /** 会话状态 */
  state: SessionState;
  /** 已加载的配置 */
  config: PluginConfig;
  /** 处理 prompt（应用魔法关键词） */
  processPrompt: (prompt: string) => string;
  /** 获取 prompt 中检测到的魔法关键词 */
  detectKeywords: (prompt: string) => string[];
  /** 用于控制异步执行的后台任务管理器 */
  backgroundTasks: BackgroundTaskManager;
  /** 判断命令是否应后台运行（便捷方法） */
  shouldRunInBackground: (command: string) => TaskExecutionDecision;
}

/**
 * 创建 WISE 编排会话
 *
 * 准备运行 Claude Agent SDK 查询所需的全部配置与选项。
 *
 * @example
 * ```typescript
 * import { createWiseSession } from 'wise';
 * import { query } from '@anthropic-ai/claude-agent-sdk';
 *
 * const session = createWiseSession();
 *
 * // 与 Claude Agent SDK 配合使用
 * for await (const message of query({
 *   prompt: session.processPrompt("ultrawork refactor the authentication module"),
 *   ...session.queryOptions
 * })) {
 *   console.log(message);
 * }
 * ```
 */
export function createWiseSession(options?: WiseOptions): WiseSession {
  // 加载配置
  const loadedConfig = options?.skipConfigLoad ? {} : loadConfig();
  const config: PluginConfig = {
    ...loadedConfig,
    ...options?.config
  };

  // 查找并加载上下文文件
  let contextAddition = '';
  if (!options?.skipContextInjection && config.features?.autoContextInjection !== false) {
    const contextFiles = findContextFiles(options?.workingDirectory);
    if (contextFiles.length > 0) {
      contextAddition = `\n\n## Project Context\n\n${loadContextFromFiles(contextFiles)}`;
    }
  }

  // 构建 system prompt
  let systemPrompt = appendSkininthegamebrosGuidance(wiseSystemPrompt, 'system');

  // 追加续跑强制
  if (config.features?.continuationEnforcement !== false) {
    systemPrompt += continuationSystemPromptAddition;
  }

  // 追加自定义 system prompt
  if (options?.customSystemPrompt) {
    systemPrompt += `\n\n## Custom Instructions\n\n${options.customSystemPrompt}`;
  }

  // 追加来自文件的上下文
  if (contextAddition) {
    systemPrompt += contextAddition;
  }

  // 获取智能体定义
  const agents = getAgentDefinitions({ config });

  // 构建 MCP server 配置
  const externalMcpServers = getDefaultMcpServers({
    exaApiKey: config.mcpServers?.exa?.apiKey,
    enableExa: config.mcpServers?.exa?.enabled,
    enableContext7: config.mcpServers?.context7?.enabled
  });

  // 构建允许的工具列表
  const allowedTools: string[] = [
    'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'
  ];

  if (config.permissions?.allowBash !== false) {
    allowedTools.push('Bash');
  }

  if (config.permissions?.allowEdit !== false) {
    allowedTools.push('Edit');
  }

  if (config.permissions?.allowWrite !== false) {
    allowedTools.push('Write');
  }

  // 追加 MCP 工具名
  for (const serverName of Object.keys(externalMcpServers)) {
    allowedTools.push(`mcp__${serverName}__*`);
  }

  // 以 MCP 格式追加 WISE 自定义工具（LSP、AST、python_repl）
  const wiseTools = getWiseToolNames({
    includeLsp: config.features?.lspTools !== false,
    includeAst: config.features?.astTools !== false,
    includePython: true
  });
  allowedTools.push(...wiseTools);

  // 创建魔法关键词处理器
  const processPrompt = createMagicKeywordProcessor(config.magicKeywords);

  // 初始化会话状态
  const state: SessionState = {
    activeAgents: new Map(),
    backgroundTasks: [],
    contextFiles: findContextFiles(options?.workingDirectory)
  };

  // 创建后台任务管理器
  const backgroundTaskManager = createBackgroundTaskManager(state, config);

  return {
    queryOptions: {
      options: {
        systemPrompt,
        agents,
        mcpServers: {
          ...toSdkMcpFormat(externalMcpServers),
          't': wiseToolsServer as any
        },
        allowedTools,
        permissionMode: 'acceptEdits'
      }
    },
    state,
    config,
    processPrompt,
    detectKeywords: (prompt: string) => detectMagicKeywords(prompt, config.magicKeywords),
    backgroundTasks: backgroundTaskManager,
    shouldRunInBackground: (command: string) => shouldRunInBackgroundFn(
      command,
      backgroundTaskManager.getRunningCount(),
      backgroundTaskManager.getMaxTasks()
    )
  };
}

/**
 * 用 WISE 增强处理 prompt 的快捷助手
 */
export function enhancePrompt(prompt: string, config?: PluginConfig): string {
  const processor = createMagicKeywordProcessor(config?.magicKeywords);
  return processor(prompt);
}

/**
 * 获取编排器的 system prompt（可直接使用）
 */
export function getWiseSystemPrompt(options?: {
  includeContinuation?: boolean;
  customAddition?: string;
}): string {
  let prompt = appendSkininthegamebrosGuidance(wiseSystemPrompt, 'system');

  if (options?.includeContinuation !== false) {
    prompt += continuationSystemPromptAddition;
  }

  if (options?.customAddition) {
    prompt += `\n\n${options.customAddition}`;
  }

  return prompt;
}
