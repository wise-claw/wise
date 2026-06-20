/**
 * 速率限制等待 - 类型定义
 *
 * 速率限制自动恢复守护进程的类型。
 * 参考：https://github.com/EvanOman/cc-wait
 */

import type { UsageErrorReason } from '../../hud/types.js';

export interface RateLimitStatus {
  /** 是否在 5 小时窗口内受到速率限制 */
  fiveHourLimited: boolean;
  /** 是否在每周窗口内受到速率限制 */
  weeklyLimited: boolean;
  /** 是否在每月窗口内受到速率限制（如 API 可提供） */
  monthlyLimited: boolean;
  /** 综合：任一限制触发即为 true */
  isLimited: boolean;
  /** 5 小时限制的重置时间 */
  fiveHourResetsAt: Date | null;
  /** 每周限制的重置时间 */
  weeklyResetsAt: Date | null;
  /** 每月限制的重置时间（如 API 可提供） */
  monthlyResetsAt: Date | null;
  /** 最早的重置时间 */
  nextResetAt: Date | null;
  /** 距离重置的毫秒数 */
  timeUntilResetMs: number | null;
  /** 最新的 5 小时用量百分比（如可用） */
  fiveHourPercent?: number;
  /** 最新的每周用量百分比（如可用） */
  weeklyPercent?: number;
  /** 最新的每月用量百分比（如可用） */
  monthlyPercent?: number;
  /** 底层 usage API 调用的错误原因（如有） */
  apiErrorReason?: UsageErrorReason;
  /** 返回的用量数据是否来自陈旧缓存 */
  usingStaleData?: boolean;
  /** 上次检查的时间戳 */
  lastCheckedAt: Date;
}

export interface TmuxPane {
  /** 面板 ID（如 "%0"） */
  id: string;
  /** 会话名 */
  session: string;
  /** 窗口索引 */
  windowIndex: number;
  /** 窗口名 */
  windowName: string;
  /** 窗口内的面板索引 */
  paneIndex: number;
  /** 面板标题（如已设置） */
  title?: string;
  /** 该面板当前是否处于活动状态 */
  isActive: boolean;
}

export interface PaneAnalysisResult {
  /** 该面板是否疑似运行 Claude Code */
  hasClaudeCode: boolean;
  /** 是否可见速率限制消息 */
  hasRateLimitMessage: boolean;
  /** 该面板是否疑似被阻塞（等待输入） */
  isBlocked: boolean;
  /** 检测到的速率限制类型（如有） */
  rateLimitType?: 'five_hour' | 'weekly' | 'unknown';
  /** 置信度（0-1） */
  confidence: number;
}

export interface BlockedPane extends TmuxPane {
  /** 该面板的分析结果 */
  analysis: PaneAnalysisResult;
  /** 该面板首次被检测为阻塞的时间 */
  firstDetectedAt: Date;
  /** 是否已尝试恢复 */
  resumeAttempted: boolean;
  /** 恢复是否成功 */
  resumeSuccessful?: boolean;
}

export interface DaemonState {
  /** 守护进程是否运行中 */
  isRunning: boolean;
  /** 运行时的进程 ID */
  pid: number | null;
  /** 守护进程启动时间 */
  startedAt: Date | null;
  /** 上次轮询的时间戳 */
  lastPollAt: Date | null;
  /** 当前速率限制状态 */
  rateLimitStatus: RateLimitStatus | null;
  /** 当前跟踪的被阻塞面板 */
  blockedPanes: BlockedPane[];
  /** 已恢复的面板（避免重复发送） */
  resumedPaneIds: string[];
  /** 总恢复尝试次数 */
  totalResumeAttempts: number;
  /** 成功恢复次数 */
  successfulResumes: number;
  /** 错误次数 */
  errorCount: number;
  /** 上次的错误消息 */
  lastError?: string;
}

export interface DaemonConfig {
  /** 轮询间隔毫秒数（默认：60000 = 1 分钟） */
  pollIntervalMs?: number;
  /** 用于分析的面板捕获行数（默认：15） */
  paneLinesToCapture?: number;
  /** 是否记录详细输出（默认：false） */
  verbose?: boolean;
  /** 状态文件路径（默认：XDG 感知的全局 WISE 状态路径） */
  stateFilePath?: string;
  /** PID 文件路径（默认：XDG 感知的全局 WISE 状态路径） */
  pidFilePath?: string;
  /** 日志文件路径（默认：XDG 感知的全局 WISE 状态路径） */
  logFilePath?: string;
}

export interface ResumeResult {
  /** 面板 ID */
  paneId: string;
  /** 恢复是否成功 */
  success: boolean;
  /** 失败时的错误消息 */
  error?: string;
  /** 时间戳 */
  timestamp: Date;
}

export interface DaemonCommand {
  action: 'start' | 'stop' | 'status' | 'detect';
  options?: DaemonConfig;
}

export interface DaemonResponse {
  success: boolean;
  message: string;
  state?: DaemonState;
  error?: string;
}
