/**
 * 后台通知钩子类型
 *
 * 后台任务通知处理的类型定义。
 * 改编自 oh-my-opencode 的 background-notification 钩子。
 */

import type { BackgroundTask } from '../../features/background-agent/index.js';

/**
 * 后台通知钩子的配置
 */
export interface BackgroundNotificationHookConfig {
  /**
   * 通知消息的自定义格式化器
   * 未提供时使用默认格式化
   */
  formatNotification?: (tasks: BackgroundTask[]) => string;

  /**
   * 通知展示后是否自动清除
   * 默认：true
   */
  autoClear?: boolean;

  /**
   * 是否仅展示当前会话的通知
   * 默认：true（仅展示当前会话启动的任务的通知）
   */
  currentSessionOnly?: boolean;
}

/**
 * 后台通知钩子的输入
 */
export interface BackgroundNotificationHookInput {
  /** 当前会话 ID */
  sessionId?: string;
  /** 工作目录 */
  directory?: string;
  /** 事件类型（用于 shell 钩子兼容） */
  event?: {
    type: string;
    properties?: Record<string, unknown>;
  };
}

/**
 * 后台通知钩子的输出
 */
export interface BackgroundNotificationHookOutput {
  /** 是否继续该操作 */
  continue: boolean;
  /** 要注入到上下文中的通知消息 */
  message?: string;
  /** 带有通知的任务数量 */
  notificationCount?: number;
}

/**
 * 检查后台通知的结果
 */
export interface NotificationCheckResult {
  /** 是否有待处理通知 */
  hasNotifications: boolean;
  /** 需要通知的已完成任务 */
  tasks: BackgroundTask[];
  /** 格式化后的通知消息 */
  message?: string;
}
