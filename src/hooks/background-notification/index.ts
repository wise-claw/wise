/**
 * 后台通知钩子
 *
 * 处理后台任务完成时的通知。
 * 与 BackgroundManager 集成以展示任务完成状态。
 *
 * 改编自 oh-my-opencode 的 background-notification 钩子，适配 Claude Code 的
 * shell 钩子系统。
 */

import { getBackgroundManager } from '../../features/background-agent/index.js';
import type { BackgroundManager, BackgroundTask } from '../../features/background-agent/index.js';
import type {
  BackgroundNotificationHookConfig,
  BackgroundNotificationHookInput,
  BackgroundNotificationHookOutput,
  NotificationCheckResult,
} from './types.js';

// 重新导出类型
export type {
  BackgroundNotificationHookConfig,
  BackgroundNotificationHookInput,
  BackgroundNotificationHookOutput,
  NotificationCheckResult,
} from './types.js';

/** 钩子名称标识 */
export const HOOK_NAME = 'background-notification';

/**
 * 格式化单个任务通知
 */
function formatTaskNotification(task: BackgroundTask): string {
  const status = task.status.toUpperCase();
  const duration = formatDuration(task.startedAt, task.completedAt);
  const emoji = task.status === 'completed' ? '✓' : task.status === 'error' ? '✗' : '○';

  const lines = [
    `${emoji} [${status}] ${task.description}`,
    `  Agent: ${task.agent}`,
    `  Duration: ${duration}`,
  ];

  if (task.progress?.toolCalls) {
    lines.push(`  Tool calls: ${task.progress.toolCalls}`);
  }

  if (task.result) {
    const resultPreview = task.result.substring(0, 200);
    const truncated = task.result.length > 200 ? '...' : '';
    lines.push(`  Result: ${resultPreview}${truncated}`);
  }

  if (task.error) {
    lines.push(`  Error: ${task.error}`);
  }

  return lines.join('\n');
}

/**
 * 格式化两个日期之间的时长
 */
function formatDuration(start: Date, end?: Date): string {
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
 * 通知消息的默认格式化器
 */
function defaultFormatNotification(tasks: BackgroundTask[]): string {
  if (tasks.length === 0) {
    return '';
  }

  const header = tasks.length === 1
    ? '\n[BACKGROUND TASK COMPLETED]\n'
    : `\n[${tasks.length} BACKGROUND TASKS COMPLETED]\n`;

  const taskDescriptions = tasks
    .map(task => formatTaskNotification(task))
    .join('\n\n');

  return `${header}\n${taskDescriptions}\n`;
}

/**
 * 检查待处理的后台通知
 */
export function checkBackgroundNotifications(
  sessionId: string,
  manager: BackgroundManager,
  config?: BackgroundNotificationHookConfig
): NotificationCheckResult {
  // 获取本会话的待处理通知
  const tasks = manager.getPendingNotifications(sessionId);

  if (tasks.length === 0) {
    return {
      hasNotifications: false,
      tasks: [],
    };
  }

  // 格式化通知消息
  const formatter = config?.formatNotification ?? defaultFormatNotification;
  const message = formatter(tasks);

  return {
    hasNotifications: true,
    tasks,
    message,
  };
}

/**
 * 处理后台通知事件
 */
export function processBackgroundNotification(
  input: BackgroundNotificationHookInput,
  config?: BackgroundNotificationHookConfig
): BackgroundNotificationHookOutput {
  const sessionId = input.sessionId;

  if (!sessionId) {
    return { continue: true };
  }

  // 获取后台管理器
  const manager = getBackgroundManager();

  // 检查通知
  const result = checkBackgroundNotifications(sessionId, manager, config);

  if (!result.hasNotifications) {
    return { continue: true };
  }

  // 若启用了自动清除则清除通知（默认：true）
  const autoClear = config?.autoClear ?? true;
  if (autoClear) {
    manager.clearNotifications(sessionId);
  }

  return {
    continue: true,
    message: result.message,
    notificationCount: result.tasks.length,
  };
}

/**
 * 处理来自 BackgroundManager 的事件
 * 当任务完成时由 BackgroundManager 调用
 */
export function handleBackgroundEvent(
  event: { type: string; properties?: Record<string, unknown> },
  manager: BackgroundManager
): void {
  // 处理任务完成事件
  if (event.type === 'task.completed' || event.type === 'task.failed') {
    const taskId = event.properties?.taskId as string;
    if (taskId) {
      const task = manager.getTask(taskId);
      if (task) {
        manager.markForNotification(task);
      }
    }
  }
}

/**
 * 创建后台通知钩子处理器
 */
export function createBackgroundNotificationHook(
  manager: BackgroundManager,
  config?: BackgroundNotificationHookConfig
) {
  return {
    /**
     * 钩子名称标识
     */
    name: HOOK_NAME,

    /**
     * 处理事件（用于 shell 钩子兼容）
     */
    event: async (input: BackgroundNotificationHookInput): Promise<BackgroundNotificationHookOutput> => {
      // 若提供了事件则处理
      if (input.event) {
        handleBackgroundEvent(input.event, manager);
      }

      // 处理通知
      return processBackgroundNotification(input, config);
    },

    /**
     * 检查待处理通知但不清除
     */
    check: (sessionId: string): NotificationCheckResult => {
      return checkBackgroundNotifications(sessionId, manager, config);
    },

    /**
     * 手动清除某会话的通知
     */
    clear: (sessionId: string): void => {
      manager.clearNotifications(sessionId);
    },

    /**
     * 获取所有待处理通知但不清除
     */
    getPending: (sessionId: string): BackgroundTask[] => {
      return manager.getPendingNotifications(sessionId);
    },
  };
}

/**
 * 用于 shell 钩子集成的简单工具函数
 */
export async function processBackgroundNotificationHook(
  input: BackgroundNotificationHookInput,
  config?: BackgroundNotificationHookConfig
): Promise<BackgroundNotificationHookOutput> {
  const manager = getBackgroundManager();
  const hook = createBackgroundNotificationHook(manager, config);
  return hook.event(input);
}
