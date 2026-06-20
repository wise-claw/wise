/**
 * Background Agent 类型
 *
 * 后台任务管理的类型定义。
 *
 * 改编自 oh-my-opencode 的 background-agent 功能。
 */

/**
 * 后台任务的状态
 */
export type BackgroundTaskStatus =
  | 'queued'      // 等待并发槽位
  | 'pending'     // @deprecated 改用 'queued'。保留仅为向后兼容。
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

/**
 * 后台任务的进度跟踪
 */
export interface TaskProgress {
  /** 已发起的工具调用次数 */
  toolCalls: number;
  /** 最近使用的工具 */
  lastTool?: string;
  /** 最近一次更新时间戳 */
  lastUpdate: Date;
  /** 最近一条消息内容（已截断） */
  lastMessage?: string;
  /** 最近一条消息的时间戳 */
  lastMessageAt?: Date;
}

/**
 * 受管理的后台任务
 */
export interface BackgroundTask {
  /** 任务唯一标识 */
  id: string;
  /** 该任务对应的会话 ID */
  sessionId: string;
  /** 发起该任务的父会话 */
  parentSessionId: string;
  /** 任务简短描述 */
  description: string;
  /** 任务原始 prompt */
  prompt: string;
  /** 处理该任务的智能体 */
  agent: string;
  /** 当前状态 */
  status: BackgroundTaskStatus;
  /** 任务进入排队等待并发的时间 */
  queuedAt?: Date;
  /** 任务开始时间 */
  startedAt: Date;
  /** 任务完成时间（若已完成） */
  completedAt?: Date;
  /** 结果输出（若已完成） */
  result?: string;
  /** 错误信息（若失败） */
  error?: string;
  /** 进度跟踪 */
  progress?: TaskProgress;
  /** 用于并发跟踪的键 */
  concurrencyKey?: string;
  /** 父模型（从启动输入中保留） */
  parentModel?: string;
}

/**
 * 启动新后台任务的输入
 */
export interface LaunchInput {
  /** 任务简短描述 */
  description: string;
  /** 任务的 prompt */
  prompt: string;
  /** 处理该任务的智能体 */
  agent: string;
  /** 父会话 ID */
  parentSessionId: string;
  /** 模型配置（可选） */
  model?: string;
}

/**
 * 恢复后台任务的输入
 */
export interface ResumeInput {
  /** 要恢复的会话 ID */
  sessionId: string;
  /** 要发送的新 prompt */
  prompt: string;
  /** 父会话 ID */
  parentSessionId: string;
}

/**
 * 恢复后台任务的上下文
 */
export interface ResumeContext {
  /** 任务对应的会话 ID */
  sessionId: string;
  /** 任务原始 prompt */
  previousPrompt: string;
  /** 目前已发起的工具调用次数 */
  toolCallCount: number;
  /** 最近使用的工具（若有） */
  lastToolUsed?: string;
  /** 最近输出的摘要（已截断） */
  lastOutputSummary?: string;
  /** 任务开始时间 */
  startedAt: Date;
  /** 任务最近活跃时间 */
  lastActivityAt: Date;
}

/**
 * 后台任务并发配置
 */
export interface BackgroundTaskConfig {
  /** 默认并发上限（0 = 不限） */
  defaultConcurrency?: number;
  /** 按模型设置的并发上限 */
  modelConcurrency?: Record<string, number>;
  /** 按提供商设置的并发上限 */
  providerConcurrency?: Record<string, number>;
  /** 后台任务总数上限 */
  maxTotalTasks?: number;
  /** 任务超时时间（毫秒） */
  taskTimeoutMs?: number;
  /** 队列大小上限（等待槽位的任务数）。未设置时隐式以 maxTotalTasks - running 作为上限 */
  maxQueueSize?: number;
  /** 检测僵尸会话的阈值（毫秒，默认 5 分钟） */
  staleThresholdMs?: number;
  /** 检测到僵尸会话时的回调 */
  onStaleSession?: (task: BackgroundTask) => void;
}
