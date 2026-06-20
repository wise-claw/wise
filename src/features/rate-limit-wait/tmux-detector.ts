/**
 * tmux 检测器
 *
 * 检测运行在 tmux 面板中的 Claude Code 会话，并识别
 * 因速率限制而被阻塞的会话。
 *
 * 安全考量：
 * - 面板 ID 在用于 shell 命令前会先校验
 * - 文本输入经过净化以防命令注入
 */

import { tmuxExec, tmuxSpawn } from '../../cli/tmux-utils.js';
import { getNewPaneTail } from './pane-fresh-capture.js';
import type { TmuxPane, PaneAnalysisResult, BlockedPane } from './types.js';

/**
 * 校验 tmux 面板 ID 格式以防止命令注入
 * 合法格式：%0、%1、%123 等
 */
function isValidPaneId(paneId: string): boolean {
  return /^%\d+$/.test(paneId);
}

/**
 * 净化用于 tmux send-keys 命令的文本
 * 转义单引号以防止命令注入
 */
function sanitizeForTmux(text: string): string {
  // 转义单引号：结束引号、加入转义引号、再重新开启引号
  return text.replace(/'/g, "'\\''");
}

/** 要在面板内容中检测的速率限制消息模式 */
const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /usage limit/i,
  /quota exceeded/i,
  /too many requests/i,
  /please wait/i,
  /try again later/i,
  /limit reached/i,
  /hit your limit/i,
  /hit .+ limit/i,
  /resets? .+ at/i,
  /5[- ]?hour/i,
  // 要求紧邻速率限制相关词汇，以避免 git 提交信息或文档中
  // 出现裸词 "weekly"（如 "fix weekly report generation"、"update weekly
  // standup notes"）造成误报。
  /\bweekly\s+(?:usage\s+)?(?:limit|quota|cap|allowance|allocation)\b/i,
];

/** 表明 Claude Code 正在运行的模式 */
const CLAUDE_CODE_PATTERNS = [
  /claude/i,
  /anthropic/i,
  /\$ claude/,
  /claude code/i,
  /conversation/i,
  /assistant/i,
];

/**
 * 收紧后的每周速率限制模式，提取出来以便 `analyzePaneContent` 在
 * `rateLimitType` 分类时复用同一断言。
 */
const WEEKLY_RATE_LIMIT_PATTERN =
  /\bweekly\s+(?:usage\s+)?(?:limit|quota|cap|allowance|allocation)\b/i;

/**
 * 识别 `git log` / `git show` / `git diff` 输出的行级模式。
 * 这些行会在速率限制模式匹配前被剥离，以防止提交信息
 * 产生 "weekly / assistant / conversation" 的误报命中。
 */
const GIT_OUTPUT_LINE_PATTERNS: RegExp[] = [
  /^commit\s+[0-9a-f]{6,40}\b/,         // git log 提交哈希
  /^Author:\s+\S/,                        // git log 作者行
  /^Date:\s+\S/,                          // git log 日期行
  /^Merge:\s+[0-9a-f]{6,}/,              // git log 合并行
  /^diff\s+--git\s+a\//,                 // git diff 头部
  /^(?:---|\+\+\+)\s+[ab]\//,            // git diff 文件路径
  /^@@\s+-\d+/,                           // git diff hunk 头部
];

/**
 * 剥离明显是 `git log` / `git diff` 输出的行，以防止提交信息文本
 * （如 "Fix weekly report"、"Update assistant config"）触发速率限制关键词模式。
 */
function stripGitOutputLines(content: string): string {
  return content
    .split('\n')
    .filter(line => !GIT_OUTPUT_LINE_PATTERNS.some(p => p.test(line.trimStart())))
    .join('\n');
}

/** 表明面板正在等待用户输入的模式 */
const WAITING_PATTERNS = [
  /\[\d+\]/,              // 菜单选择提示，如 [1]、[2]、[3]
  /^\s*❯?\s*\d+\.\s/m,     // 菜单选择提示，如 "❯ 1. ..." 或 "  2. ..."
  /continue\?/i,           // 继续提示
  /press enter/i,
  /waiting for/i,
  /select an option/i,
  /choice:/i,
  /enter to confirm/i,
];

/**
 * 检查 tmux 是否已安装且可用。
 * 在 Windows 上，可由 psmux 之类兼容 tmux 的二进制提供 tmux。
 */
export function isTmuxAvailable(): boolean {
  try {
    const result = tmuxSpawn(['-V'], { stripTmux: true, stdio: 'pipe', timeout: 3000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 检查当前是否运行在 tmux 会话内
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * 列出所有会话中的全部 tmux 面板
 */
export function listTmuxPanes(): TmuxPane[] {
  if (!isTmuxAvailable()) {
    return [];
  }

  try {
    // 格式：session_name:window_index.pane_index pane_id pane_active window_name pane_title
    const format = '#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_active} #{window_name} #{pane_title}';
    const result = tmuxExec(['list-panes', '-a', '-F', format], {
      stripTmux: true,
      timeout: 5000,
    });

    const panes: TmuxPane[] = [];

    for (const line of result.trim().split('\n')) {
      if (!line.trim()) continue;

      const parts = line.split(' ');
      if (parts.length < 4) continue;

      const [location, paneId, activeStr, windowName, ...titleParts] = parts;
      const [sessionWindow, paneIndexStr] = location.split('.');
      const [session, windowIndexStr] = sessionWindow.split(':');

      panes.push({
        id: paneId,
        session,
        windowIndex: parseInt(windowIndexStr, 10),
        windowName,
        paneIndex: parseInt(paneIndexStr, 10),
        title: titleParts.join(' ') || undefined,
        isActive: activeStr === '1',
      });
    }

    return panes;
  } catch (error) {
    console.error('[TmuxDetector] Error listing panes:', error);
    return [];
  }
}

/**
 * 检查 tmux 面板是否存活（未处于 dead/exited 状态）。
 *
 * 一旦面板中的子进程退出，tmux 就把 #{pane_dead} 置为 "1"。
 * 从已死亡的面板捕获内容会返回陈旧回滚内容，可能
 * 触发虚假关键词告警 —— 当本函数返回 false 时调用方应跳过捕获。
 *
 * 面板已死亡、面板 ID 非法以及 tmux 不可用时均返回 false。
 * 刻意做成同步，以便用于即发即忘的钩子路径。
 */
export function isPaneAlive(paneId: string): boolean {
  if (!isTmuxAvailable()) {
    return false;
  }
  if (!isValidPaneId(paneId)) {
    return false;
  }
  try {
    const result = tmuxExec(
      ['display-message', '-t', paneId, '-p', '#{pane_dead}'],
      { stripTmux: true, stdio: 'pipe', timeout: 3000 },
    );
    return result.trim() === '0';
  } catch {
    // 面板消失或会话已死亡 —— 视为不存活
    return false;
  }
}

/**
 * 捕获指定 tmux 面板的内容
 *
 * @param paneId - tmux 面板 ID（如 "%0"）
 * @param lines - 捕获的行数（默认：15）
 */
export function capturePaneContent(paneId: string, lines = 15): string {
  if (!isTmuxAvailable()) {
    return '';
  }

  // 校验面板 ID 以防止命令注入
  if (!isValidPaneId(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return '';
  }

  // 校验 lines 为合理的正整数
  const safeLines = Math.max(1, Math.min(100, Math.floor(lines)));

  try {
    // 捕获面板最后 N 行
    const result = tmuxExec(['capture-pane', '-t', paneId, '-p', '-S', `-${safeLines}`], {
      stripTmux: true,
      timeout: 5000,
    });
    return result;
  } catch (error) {
    console.error(`[TmuxDetector] Error capturing pane ${paneId}:`, error);
    return '';
  }
}

/**
 * 分析面板内容，判断是否显示了被速率限制的 Claude Code 会话
 */
export function analyzePaneContent(content: string): PaneAnalysisResult {
  if (!content.trim()) {
    return {
      hasClaudeCode: false,
      hasRateLimitMessage: false,
      isBlocked: false,
      confidence: 0,
    };
  }

  // 剥离 git log / diff 行，以防止提交信息文本（如 "Fix weekly report"、
  // "Update assistant config"）产生误报关键词匹配。
  const cleanedContent = stripGitOutputLines(content);

  // 检查 Claude Code 指示特征
  const hasClaudeCode = CLAUDE_CODE_PATTERNS.some((pattern) =>
    pattern.test(cleanedContent)
  );

  // 检查速率限制消息
  const rateLimitMatches = RATE_LIMIT_PATTERNS.filter((pattern) =>
    pattern.test(cleanedContent)
  );
  const hasRateLimitMessage = rateLimitMatches.length > 0;

  // 检查是否在等待用户输入
  const isWaiting = WAITING_PATTERNS.some((pattern) => pattern.test(cleanedContent));

  // 确定速率限制类型
  let rateLimitType: 'five_hour' | 'weekly' | 'unknown' | undefined;
  if (hasRateLimitMessage) {
    if (/5[- ]?hour/i.test(cleanedContent)) {
      rateLimitType = 'five_hour';
    } else if (WEEKLY_RATE_LIMIT_PATTERN.test(cleanedContent)) {
      rateLimitType = 'weekly';
    } else {
      rateLimitType = 'unknown';
    }
  }

  // 计算置信度
  let confidence = 0;
  if (hasClaudeCode) confidence += 0.4;
  if (hasRateLimitMessage) confidence += 0.4;
  if (isWaiting) confidence += 0.2;
  if (rateLimitMatches.length > 1) confidence += 0.1; // 多个匹配 = 更高置信度

  // 判断是否被阻塞
  const isBlocked = hasClaudeCode && hasRateLimitMessage && confidence >= 0.6;

  return {
    hasClaudeCode,
    hasRateLimitMessage,
    isBlocked,
    rateLimitType,
    confidence: Math.min(1, confidence),
  };
}

/**
 * 扫描所有 tmux 面板，查找被阻塞的 Claude Code 会话。
 *
 * @param lines    - 每个面板捕获的行数
 * @param stateDir - 提供时使用游标跟踪捕获（getNewPaneTail），使
 *                   守护进程的重复轮询只输出自上次扫描以来写入的行。
 *                   无新输出的面板会被跳过，防止陈旧速率限制消息
 *                   在阻塞解除后重复告警。
 *                   省略时回退为普通的 capturePaneContent 调用。
 */
export function scanForBlockedPanes(lines = 15, stateDir?: string): BlockedPane[] {
  const panes = listTmuxPanes();
  const blocked: BlockedPane[] = [];

  for (const pane of panes) {
    let content: string;
    if (stateDir) {
      // 游标跟踪：仅返回自上次扫描以来新增的行。
      // 结果为空表示没有新内容 —— 跳过以避免陈旧重复告警。
      content = getNewPaneTail(pane.id, stateDir, lines);
      if (!content) continue;
    } else {
      content = capturePaneContent(pane.id, lines);
    }
    const analysis = analyzePaneContent(content);

    if (analysis.isBlocked) {
      blocked.push({
        ...pane,
        analysis,
        firstDetectedAt: new Date(),
        resumeAttempted: false,
      });
    }
  }

  return blocked;
}

/**
 * 向 tmux 面板发送恢复序列
 *
 * 先发送 "1" 加回车以选择第一项（通常是 "Continue"），
 * 然后短暂等待，必要时再发送 "continue"。
 *
 * @param paneId - tmux 面板 ID
 * @returns 命令是否发送成功
 */
export function sendResumeSequence(paneId: string): boolean {
  if (!isTmuxAvailable()) {
    return false;
  }

  // 校验面板 ID 以防止命令注入
  if (!isValidPaneId(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return false;
  }

  try {
    // 发送 "1" 以选择第一项（通常是 "Continue" 或类似选项）
    tmuxExec(['send-keys', '-t', paneId, '1', 'Enter'], {
      stripTmux: true,
      timeout: 2000,
    });

    // 稍作等待以接收响应
    // 注意：实际使用中应校验面板状态是否已改变
    return true;
  } catch (error) {
    console.error(`[TmuxDetector] Error sending resume to pane ${paneId}:`, error);
    return false;
  }
}

/**
 * 向 tmux 面板发送自定义文本
 */
export function sendToPane(paneId: string, text: string, pressEnter = true): boolean {
  if (!isTmuxAvailable()) {
    return false;
  }

  // 校验面板 ID 以防止命令注入
  if (!isValidPaneId(paneId)) {
    console.error(`[TmuxDetector] Invalid pane ID format: ${paneId}`);
    return false;
  }

  try {
    const sanitizedText = sanitizeForTmux(text);
    // 用 -l 标志（字面量）发送文本，以避免 TUI 应用中的按键解析问题
    tmuxExec(['send-keys', '-t', paneId, '-l', sanitizedText], {
      stripTmux: true,
      timeout: 2000,
    });
    // 将回车作为独立命令发送，使其被解析为一次按键
    if (pressEnter) {
      tmuxExec(['send-keys', '-t', paneId, 'Enter'], {
        stripTmux: true,
        timeout: 2000,
      });
    }
    return true;
  } catch (error) {
    console.error(`[TmuxDetector] Error sending to pane ${paneId}:`, error);
    return false;
  }
}

/**
 * 获取被阻塞面板的汇总信息以供显示
 */
export function formatBlockedPanesSummary(blockedPanes: BlockedPane[]): string {
  if (blockedPanes.length === 0) {
    return 'No blocked Claude Code sessions detected.';
  }

  const lines: string[] = [
    `Found ${blockedPanes.length} blocked Claude Code session(s):`,
    '',
  ];

  for (const pane of blockedPanes) {
    const location = `${pane.session}:${pane.windowIndex}.${pane.paneIndex}`;
    const confidence = Math.round(pane.analysis.confidence * 100);
    const limitType = pane.analysis.rateLimitType || 'unknown';
    const status = pane.resumeAttempted
      ? pane.resumeSuccessful
        ? ' [RESUMED]'
        : ' [RESUME FAILED]'
      : '';

    lines.push(`  • ${location} (${pane.id}) - ${limitType} limit, ${confidence}% confidence${status}`);
  }

  return lines.join('\n');
}
