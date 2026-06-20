/**
 * Rate Limit Wait 功能
 *
 * 当速率限制重置时自动恢复 Claude Code 会话。
 *
 * 用法：
 *   wise wait status         - 显示当前速率限制状态
 *   wise wait daemon start   - 启动后台守护进程
 *   wise wait daemon stop    - 停止守护进程
 *   wise wait detect         - 扫描被阻塞的 Claude Code 会话
 */

// 类型导出
export type {
  RateLimitStatus,
  TmuxPane,
  PaneAnalysisResult,
  BlockedPane,
  DaemonState,
  DaemonConfig,
  ResumeResult,
  DaemonCommand,
  DaemonResponse,
} from './types.js';

// 速率限制监控导出
export {
  checkRateLimitStatus,
  formatTimeUntilReset,
  formatRateLimitStatus,
  isRateLimitStatusDegraded,
  shouldMonitorBlockedPanes,
} from './rate-limit-monitor.js';

// tmux 检测器导出
export {
  isTmuxAvailable,
  isInsideTmux,
  isPaneAlive,
  listTmuxPanes,
  capturePaneContent,
  analyzePaneContent,
  scanForBlockedPanes,
  sendResumeSequence,
  sendToPane,
  formatBlockedPanesSummary,
} from './tmux-detector.js';

// 守护进程导出
export {
  readDaemonState,
  isDaemonRunning,
  startDaemon,
  runDaemonForeground,
  stopDaemon,
  getDaemonStatus,
  detectBlockedPanes,
  formatDaemonState,
} from './daemon.js';
