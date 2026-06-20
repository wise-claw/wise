/**
 * Background Task 管理
 *
 * 提供后台任务执行的管理工具，
 * 类似于 oh-my-opencode 的 Background Task Manager。
 *
 * 在 Claude Code 中，后台执行通过以下方式控制：
 * - Bash 工具的 `run_in_background` 参数
 * - Task 工具的 `run_in_background` 参数
 * - TaskOutput 工具用于获取结果
 *
 * 本模块提供：
 * - 何时使用后台执行的决策启发式
 * - 任务生命周期管理
 * - 并发上限强制执行
 * - 面向智能体的系统 prompt 指引
 */

import type { BackgroundTask, SessionState, PluginConfig } from '../shared/types.js';

/**
 * 默认最大并发后台任务数
 */
export const DEFAULT_MAX_BACKGROUND_TASKS = 5;

/**
 * 标识长耗时操作的模式
 * 这些通常应在后台运行
 */
export const LONG_RUNNING_PATTERNS = [
  // 包管理器
  /\b(npm|yarn|pnpm|bun)\s+(install|ci|update|upgrade)\b/i,
  /\b(pip|pip3)\s+install\b/i,
  /\bcargo\s+(build|install|test)\b/i,
  /\bgo\s+(build|install|test)\b/i,
  /\brustup\s+(update|install)\b/i,
  /\bgem\s+install\b/i,
  /\bcomposer\s+install\b/i,
  /\bmaven|mvn\s+(install|package|test)\b/i,
  /\bgradle\s+(build|test)\b/i,

  // 构建命令
  /\b(npm|yarn|pnpm|bun)\s+run\s+(build|compile|bundle)\b/i,
  /\bmake\s*(all|build|install)?\s*$/i,
  /\bcmake\s+--build\b/i,
  /\btsc\s+(--build|-b)?\b/i,
  /\bwebpack\b/i,
  /\brollup\b/i,
  /\besbuild\b/i,
  /\bvite\s+build\b/i,

  // 测试套件
  /\b(npm|yarn|pnpm|bun)\s+run\s+test\b/i,
  /\b(jest|mocha|vitest|pytest|cargo\s+test)\b/i,
  /\bgo\s+test\b/i,

  // Docker 操作
  /\bdocker\s+(build|pull|push)\b/i,
  /\bdocker-compose\s+(up|build)\b/i,

  // 数据库操作
  /\b(prisma|typeorm|sequelize)\s+(migrate|generate|push)\b/i,

  // 大型代码库的 lint
  /\b(eslint|prettier)\s+[^|]*\.\s*$/i,

  // 大型仓库的 git 操作
  /\bgit\s+(clone|fetch|pull)\b/i,
];

/**
 * 始终应阻塞（前台）运行的模式
 * 这些是快速操作或需要即时反馈
 */
export const BLOCKING_PATTERNS = [
  // 快速状态检查
  /\bgit\s+(status|diff|log|branch)\b/i,
  /\bls\b/i,
  /\bpwd\b/i,
  /\bcat\b/i,
  /\becho\b/i,
  /\bhead\b/i,
  /\btail\b/i,
  /\bwc\b/i,
  /\bwhich\b/i,
  /\btype\b/i,

  // 文件操作
  /\bcp\b/i,
  /\bmv\b/i,
  /\brm\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,

  // 环境检查
  /\benv\b/i,
  /\bprintenv\b/i,
  /\bnode\s+-[vpe]\b/i,
  /\bnpm\s+-v\b/i,
  /\bpython\s+--version\b/i,
];

/**
 * 后台执行决策的结果
 */
export interface TaskExecutionDecision {
  /** 是否在后台运行 */
  runInBackground: boolean;
  /** 人类可读的决策原因 */
  reason: string;
  /** 预估耗时类别 */
  estimatedDuration: 'quick' | 'medium' | 'long' | 'unknown';
  /** 决策的置信度等级 */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 判断某条命令是否应在后台运行
 *
 * 这是核心启发式函数，决定某条命令
 * 是否应使用 `run_in_background: true` 执行。
 *
 * @param command - 待分析的命令
 * @param currentBackgroundCount - 当前正在运行的后台任务数
 * @param maxBackgroundTasks - 允许的最大并发后台任务数
 * @returns 包含建议与理由的决策对象
 */
export function shouldRunInBackground(
  command: string,
  currentBackgroundCount: number = 0,
  maxBackgroundTasks: number = DEFAULT_MAX_BACKGROUND_TASKS
): TaskExecutionDecision {
  // 检查是否已达上限
  if (currentBackgroundCount >= maxBackgroundTasks) {
    return {
      runInBackground: false,
      reason: `At background task limit (${currentBackgroundCount}/${maxBackgroundTasks}). Wait for existing tasks or run blocking.`,
      estimatedDuration: 'unknown',
      confidence: 'high'
    };
  }

  // 先检查显式的阻塞模式
  for (const pattern of BLOCKING_PATTERNS) {
    if (pattern.test(command)) {
      return {
        runInBackground: false,
        reason: 'Quick operation that should complete immediately.',
        estimatedDuration: 'quick',
        confidence: 'high'
      };
    }
  }

  // 检查长耗时模式
  for (const pattern of LONG_RUNNING_PATTERNS) {
    if (pattern.test(command)) {
      return {
        runInBackground: true,
        reason: 'Long-running operation detected. Run in background to continue other work.',
        estimatedDuration: 'long',
        confidence: 'high'
      };
    }
  }

  // 启发式：包含多个操作（管道或链式）的命令
  if ((command.match(/\|/g) || []).length > 2 || (command.match(/&&/g) || []).length > 2) {
    return {
      runInBackground: true,
      reason: 'Complex command chain that may take time.',
      estimatedDuration: 'medium',
      confidence: 'medium'
    };
  }

  // 默认：未知命令阻塞运行
  return {
    runInBackground: false,
    reason: 'Unknown command type. Running blocking for immediate feedback.',
    estimatedDuration: 'unknown',
    confidence: 'low'
  };
}

/**
 * BackgroundTaskManager 接口
 *
 * 管理后台任务生命周期、强制执行并发上限，
 * 并提供跟踪任务状态的工具。
 */
export interface BackgroundTaskManager {
  /** 注册一个新的后台任务 */
  registerTask(agentName: string, prompt: string): BackgroundTask;

  /** 获取全部后台任务 */
  getTasks(): BackgroundTask[];

  /** 按状态获取任务 */
  getTasksByStatus(status: BackgroundTask['status']): BackgroundTask[];

  /** 获取正在运行的任务数 */
  getRunningCount(): number;

  /** 检查能否启动新的后台任务 */
  canStartNewTask(): boolean;

  /** 更新任务状态 */
  updateTaskStatus(taskId: string, status: BackgroundTask['status'], result?: string, error?: string): void;

  /** 标记任务为已完成 */
  completeTask(taskId: string, result: string): void;

  /** 标记任务为失败 */
  failTask(taskId: string, error: string): void;

  /** 移除超过指定时长（毫秒）的已完成任务 */
  pruneCompletedTasks(maxAge?: number): number;

  /** 获取允许的最大后台任务数 */
  getMaxTasks(): number;

  /** 检查某条命令是否应在后台运行 */
  shouldRunInBackground(command: string): TaskExecutionDecision;
}

/**
 * 创建一个 BackgroundTaskManager 实例
 */
export function createBackgroundTaskManager(
  state: SessionState,
  config: PluginConfig
): BackgroundTaskManager {
  const maxBackgroundTasks = config.permissions?.maxBackgroundTasks ?? DEFAULT_MAX_BACKGROUND_TASKS;

  return {
    registerTask(agentName: string, prompt: string): BackgroundTask {
      const task: BackgroundTask = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        agentName,
        prompt,
        status: 'pending'
      };
      state.backgroundTasks.push(task);
      return task;
    },

    getTasks(): BackgroundTask[] {
      return [...state.backgroundTasks];
    },

    getTasksByStatus(status: BackgroundTask['status']): BackgroundTask[] {
      return state.backgroundTasks.filter(t => t.status === status);
    },

    getRunningCount(): number {
      return state.backgroundTasks.filter(t => t.status === 'running' || t.status === 'pending').length;
    },

    canStartNewTask(): boolean {
      return this.getRunningCount() < maxBackgroundTasks;
    },

    updateTaskStatus(taskId: string, status: BackgroundTask['status'], result?: string, error?: string): void {
      const task = state.backgroundTasks.find(t => t.id === taskId);
      if (task) {
        task.status = status;
        if (result !== undefined) task.result = result;
        if (error !== undefined) task.error = error;
      }
    },

    completeTask(taskId: string, result: string): void {
      this.updateTaskStatus(taskId, 'completed', result);
    },

    failTask(taskId: string, error: string): void {
      this.updateTaskStatus(taskId, 'error', undefined, error);
    },

    pruneCompletedTasks(_maxAge: number = 5 * 60 * 1000): number {
      // 注意：基于 maxAge 的清理需要跟踪任务完成时间戳
      // 暂时只清理所有已完成/出错的任务
      const before = state.backgroundTasks.length;
      state.backgroundTasks = state.backgroundTasks.filter(t =>
        t.status !== 'completed' && t.status !== 'error'
      );
      return before - state.backgroundTasks.length;
    },

    getMaxTasks(): number {
      return maxBackgroundTasks;
    },

    shouldRunInBackground(command: string): TaskExecutionDecision {
      return shouldRunInBackground(command, this.getRunningCount(), maxBackgroundTasks);
    }
  };
}

/**
 * 后台任务执行的系统 prompt 指引
 *
 * 此文本应附加到系统 prompt 中，以指引智能体
 * 何时以及如何使用后台执行。
 */
export function getBackgroundTaskGuidance(maxBackgroundTasks: number = DEFAULT_MAX_BACKGROUND_TASKS): string {
  return `
## Background Task Execution

For long-running operations, use the \`run_in_background\` parameter to avoid blocking.

### When to Use Background Execution

**Run in Background** (set \`run_in_background: true\`):
- Package installation (\`npm install\`, \`pip install\`, \`cargo build\`, etc.)
- Build processes (project build command, \`make\`, etc.)
- Test suites (project test command, etc.)
- Docker operations: \`docker build\`, \`docker pull\`
- Git operations on large repos: \`git clone\`, \`git fetch\`
- Database migrations: \`prisma migrate\`, \`typeorm migration:run\`

**Run Blocking** (foreground, immediate):
- Quick status checks: \`git status\`, \`ls\`, \`pwd\`
- File operations: \`cat\`, \`head\`, \`tail\`
- Simple commands: \`echo\`, \`which\`, \`env\`
- Operations needing immediate feedback

### How to Use Background Execution

1. **Start in background:**
   \`\`\`
   Bash(command: "project build command", run_in_background: true)
   \`\`\`

2. **Continue with other work** while the task runs

3. **Check results later:**
   \`\`\`
   TaskOutput(task_id: "<task_id_from_step_1>", block: false)
   \`\`\`

### Concurrency Limits

- Maximum **${maxBackgroundTasks}** concurrent background tasks
- If at limit, wait for existing tasks to complete or run the new task blocking
- Use \`TaskOutput\` to check if background tasks have finished

### Decision Checklist

Before running a command, ask:
1. Will this take more than 5 seconds? → Consider background
2. Do I need the result immediately? → Run blocking
3. Can I do other useful work while waiting? → Use background
4. Am I at the background task limit? → Run blocking or wait
`;
}
