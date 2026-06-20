/**
 * Background Agent 管理器
 *
 * 为 WISE 系统管理后台任务。
 * 这是一个简化版本，跟踪通过 Claude Code 原生 Task 工具
 * 以 run_in_background: true 启动的任务。
 *
 * 改编自 oh-my-opencode 的 background-agent 功能。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { ConcurrencyManager } from './concurrency.js';
import type {
  BackgroundTask,
  BackgroundTaskStatus,
  BackgroundTaskConfig,
  LaunchInput,
  ResumeInput,
  TaskProgress,
  ResumeContext,
} from './types.js';

/** 默认任务超时：30 分钟 */
const DEFAULT_TASK_TTL_MS = 30 * 60 * 1000;

/** 任务状态存储目录 */
const BACKGROUND_TASKS_DIR = join(getClaudeConfigDir(), '.wise', 'background-tasks');

/**
 * 为 WISE 系统管理后台任务。
 */
export class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private notifications: Map<string, BackgroundTask[]> = new Map();
  private concurrencyManager: ConcurrencyManager;
  private config: BackgroundTaskConfig;
  private pruneInterval?: ReturnType<typeof setInterval>;

  constructor(config?: BackgroundTaskConfig) {
    this.config = config ?? {};
    this.concurrencyManager = new ConcurrencyManager(config);
    this.ensureStorageDir();
    this.loadPersistedTasks();
    this.startPruning();
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDir(): void {
    if (!existsSync(BACKGROUND_TASKS_DIR)) {
      mkdirSync(BACKGROUND_TASKS_DIR, { recursive: true });
    }
  }

  /**
   * 生成唯一任务 ID
   */
  private generateTaskId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `bg_${timestamp}${random}`;
  }

  /**
   * 获取某个任务的存储路径
   */
  private getTaskPath(taskId: string): string {
    return join(BACKGROUND_TASKS_DIR, `${taskId}.json`);
  }

  /**
   * 将任务持久化到磁盘
   */
  private persistTask(task: BackgroundTask): void {
    const path = this.getTaskPath(task.id);
    writeFileSync(path, JSON.stringify(task, null, 2));
  }

  /**
   * 从磁盘移除已持久化的任务
   */
  private unpersistTask(taskId: string): void {
    const path = this.getTaskPath(taskId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  /**
   * 从磁盘加载已持久化的任务
   */
  private loadPersistedTasks(): void {
    if (!existsSync(BACKGROUND_TASKS_DIR)) return;

    try {
      const files = readdirSync(BACKGROUND_TASKS_DIR) as string[];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const path = join(BACKGROUND_TASKS_DIR, file);
          const content = readFileSync(path, 'utf-8');
          const task = JSON.parse(content) as BackgroundTask;

          // 还原日期对象
          task.startedAt = new Date(task.startedAt);
          if (task.queuedAt) {
            task.queuedAt = new Date(task.queuedAt);
          }
          if (task.completedAt) {
            task.completedAt = new Date(task.completedAt);
          }
          if (task.progress?.lastUpdate) {
            task.progress.lastUpdate = new Date(task.progress.lastUpdate);
          }
          if (task.progress?.lastMessageAt) {
            task.progress.lastMessageAt = new Date(task.progress.lastMessageAt);
          }

          this.tasks.set(task.id, task);
        } catch {
          // 跳过无效的任务文件
        }
      }
    } catch {
      // 忽略读取目录时的错误
    }
  }

  /**
   * 启动对僵尸任务的周期性清理
   */
  private startPruning(): void {
    if (this.pruneInterval) return;

    this.pruneInterval = setInterval(() => {
      this.pruneStaleTasksAndNotifications();
    }, 60000); // 每分钟一次

    // 不要仅为清理而让进程保持存活
    if (this.pruneInterval.unref) {
      this.pruneInterval.unref();
    }
  }

  /**
   * 停止周期性清理
   */
  private stopPruning(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
  }

  /**
   * 移除已超过 TTL 的僵尸任务
   */
  private pruneStaleTasksAndNotifications(): void {
    const now = Date.now();
    const ttl = this.config.taskTimeoutMs ?? DEFAULT_TASK_TTL_MS;

    for (const [taskId, task] of this.tasks.entries()) {
      const age = now - task.startedAt.getTime();
      if (age > ttl && (task.status === 'running' || task.status === 'queued')) {
        task.status = 'error';
        task.error = `Task timed out after ${Math.round(ttl / 60000)} minutes`;
        task.completedAt = new Date();

        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey);
        }

        this.clearNotificationsForTask(taskId);
        this.unpersistTask(taskId);
        this.tasks.delete(taskId);
      }
    }

    // 清理旧通知
    for (const [sessionId, notifications] of this.notifications.entries()) {
      const validNotifications = notifications.filter((task) => {
        const age = now - task.startedAt.getTime();
        return age <= ttl;
      });

      if (validNotifications.length === 0) {
        this.notifications.delete(sessionId);
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionId, validNotifications);
      }
    }

    // 检测僵尸会话（无近期活动）
    this.detectAndHandleStaleSessions();
  }

  /**
   * 检测无近期活动的会话并处理
   * 即使未配置回调也将僵尸任务标记为出错（Bug #9 修复）
   */
  private detectAndHandleStaleSessions(): void {
    const now = Date.now();
    const threshold = this.config.staleThresholdMs ?? 5 * 60 * 1000; // 默认 5 分钟

    for (const task of this.tasks.values()) {
      // 仅检查运行中的任务（不含 queued、completed 等）
      if (task.status !== 'running') continue;

      // 检查最近活动（progress.lastUpdate，兜底用 startedAt）
      const lastActivity = task.progress?.lastUpdate ?? task.startedAt;
      const timeSinceActivity = now - lastActivity.getTime();

      if (timeSinceActivity > threshold) {
        // 若配置了回调则调用（允许调用方自动中断）
        if (this.config.onStaleSession) {
          this.config.onStaleSession(task);
        } else {
          // 默认行为：无活动时间超过 2 倍阈值后标记为出错
          if (timeSinceActivity > threshold * 2) {
            task.status = 'error';
            task.error = `Task stale: no activity for ${Math.round(timeSinceActivity / 60000)} minutes`;
            task.completedAt = new Date();

            if (task.concurrencyKey) {
              this.concurrencyManager.release(task.concurrencyKey);
            }

            this.clearNotificationsForTask(task.id);
            this.unpersistTask(task.id);
            this.tasks.delete(task.id);
          }
        }
      }
    }
  }

  /**
   * 注册新的后台任务
   */
  async launch(input: LaunchInput): Promise<BackgroundTask> {
    const concurrencyKey = input.agent;

    // 统计运行中和排队中的任务以做容量检查
    const runningTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running'
    );
    const queuedTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'queued'
    );
    const runningCount = runningTasks.length;
    const queuedCount = queuedTasks.length;

    // 检查 maxTotalTasks（running + queued = 进行中的任务）
    const maxTotal = this.config.maxTotalTasks ?? 10;
    const tasksInFlight = runningCount + queuedCount;

    if (tasksInFlight >= maxTotal) {
      throw new Error(
        `Maximum tasks in flight (${maxTotal}) reached. ` +
        `Currently: ${runningCount} running, ${queuedCount} queued. ` +
        `Wait for some tasks to complete.`
      );
    }

    // 若配置了显式的 maxQueueSize 则检查
    const maxQueueSize = this.config.maxQueueSize;
    if (maxQueueSize !== undefined && queuedCount >= maxQueueSize) {
      throw new Error(
        `Maximum queue size (${maxQueueSize}) reached. ` +
        `Currently: ${runningCount} running, ${queuedCount} queued. ` +
        `Wait for some tasks to start or complete.`
      );
    }

    const taskId = this.generateTaskId();
    const sessionId = `ses_${this.generateTaskId()}`;

    // 先以 QUEUED 状态创建任务（非阻塞 - 立即可见）
    const task: BackgroundTask = {
      id: taskId,
      sessionId,
      parentSessionId: input.parentSessionId,
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      status: 'queued',
      queuedAt: new Date(),
      startedAt: new Date(), // 向后兼容的占位值，进入 running 时更新
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
      concurrencyKey,
      parentModel: input.model, // 保留父模型
    };

    // 立即存储，使任务在等待槽位期间可见
    this.tasks.set(taskId, task);
    this.persistTask(task);

    // 等待并发槽位（可能立即解决或阻塞）
    await this.concurrencyManager.acquire(concurrencyKey);

    // 获取槽位后转为 RUNNING 状态
    task.status = 'running';
    task.startedAt = new Date();
    this.persistTask(task);

    return task;
  }

  /**
   * 恢复已有的后台任务
   */
  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.findBySession(input.sessionId);
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`);
    }

    existingTask.status = 'running';
    existingTask.completedAt = undefined;
    existingTask.error = undefined;
    existingTask.parentSessionId = input.parentSessionId;

    if (!existingTask.progress) {
      existingTask.progress = { toolCalls: 0, lastUpdate: new Date() };
    }
    existingTask.progress.lastUpdate = new Date();

    this.persistTask(existingTask);

    return existingTask;
  }

  /**
   * 获取某会话的恢复上下文
   * 供 resume_session 工具用于准备续接 prompt
   */
  getResumeContext(sessionId: string): ResumeContext | null {
    const task = this.findBySession(sessionId);
    if (!task) {
      return null;
    }

    return {
      sessionId: task.sessionId,
      previousPrompt: task.prompt,
      toolCallCount: task.progress?.toolCalls ?? 0,
      lastToolUsed: task.progress?.lastTool,
      lastOutputSummary: task.progress?.lastMessage?.slice(0, 500),
      startedAt: task.startedAt,
      lastActivityAt: task.progress?.lastUpdate ?? task.startedAt,
    };
  }

  /**
   * 按 ID 获取任务
   */
  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * 按会话 ID 查找任务
   */
  findBySession(sessionId: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId) {
        return task;
      }
    }
    return undefined;
  }

  /**
   * 获取某父会话的全部任务
   */
  getTasksByParentSession(sessionId: string): BackgroundTask[] {
    const result: BackgroundTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.parentSessionId === sessionId) {
        result.push(task);
      }
    }
    return result;
  }

  /**
   * 获取全部任务（含嵌套）
   */
  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取所有运行中的任务
   */
  getRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'running');
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(
    taskId: string,
    status: BackgroundTaskStatus,
    result?: string,
    error?: string
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    if (result) task.result = result;
    if (error) task.error = error;

    if (status === 'completed' || status === 'error' || status === 'cancelled') {
      task.completedAt = new Date();

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey);
      }

      this.markForNotification(task);
    }

    this.persistTask(task);
  }

  /**
   * 更新任务进度
   */
  updateTaskProgress(taskId: string, progress: Partial<TaskProgress>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (!task.progress) {
      task.progress = { toolCalls: 0, lastUpdate: new Date() };
    }

    Object.assign(task.progress, progress, { lastUpdate: new Date() });
    this.persistTask(task);
  }

  /**
   * 标记任务需向父会话通知
   */
  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionId) ?? [];
    queue.push(task);
    this.notifications.set(task.parentSessionId, queue);
  }

  /**
   * 获取某会话的待处理通知
   */
  getPendingNotifications(sessionId: string): BackgroundTask[] {
    return this.notifications.get(sessionId) ?? [];
  }

  /**
   * 清除某会话的通知
   */
  clearNotifications(sessionId: string): void {
    this.notifications.delete(sessionId);
  }

  /**
   * 清除某具体任务的通知
   */
  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionId, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId);
      if (filtered.length === 0) {
        this.notifications.delete(sessionId);
      } else {
        this.notifications.set(sessionId, filtered);
      }
    }
  }

  /**
   * 完整移除一个任务
   */
  removeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task?.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey);
    }

    this.clearNotificationsForTask(taskId);
    this.unpersistTask(taskId);
    this.tasks.delete(taskId);
  }

  /**
   * 格式化时长用于展示
   */
  formatDuration(start: Date, end?: Date): string {
    const duration = (end ?? new Date()).getTime() - start.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * 生成所有任务的状态摘要
   */
  getStatusSummary(): string {
    const running = this.getRunningTasks();
    const queued = Array.from(this.tasks.values()).filter((t) => t.status === 'queued');
    const all = this.getAllTasks();

    if (all.length === 0) {
      return 'No background tasks.';
    }

    const lines: string[] = [
      `Background Tasks: ${running.length} running, ${queued.length} queued, ${all.length} total`,
      '',
    ];

    for (const task of all) {
      const duration = this.formatDuration(task.startedAt, task.completedAt);
      const status = task.status.toUpperCase();
      const progress = task.progress
        ? ` (${task.progress.toolCalls} tools)`
        : '';

      lines.push(`  [${status}] ${task.description} - ${duration}${progress}`);

      if (task.error) {
        lines.push(`    Error: ${task.error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 清理管理器（停止清理周期、清空状态）
   */
  cleanup(): void {
    this.stopPruning();
    this.tasks.clear();
    this.notifications.clear();
  }
}

/** 单例实例 */
let instance: BackgroundManager | undefined;

/**
 * 获取后台管理器的单例实例
 */
export function getBackgroundManager(config?: BackgroundTaskConfig): BackgroundManager {
  if (!instance) {
    instance = new BackgroundManager(config);
  }
  return instance;
}

/**
 * 重置单例（用于测试）
 */
export function resetBackgroundManager(): void {
  if (instance) {
    instance.cleanup();
    instance = undefined;
  }
}
