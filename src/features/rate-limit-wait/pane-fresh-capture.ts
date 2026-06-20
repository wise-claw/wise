/**
 * 面板增量捕获
 *
 * 在状态文件中跟踪每个面板的回滚位置（history_size）。
 * 仅返回自上次扫描以来新增的面板行，
 * 防止在阻塞解除后，旧的面板历史再次触发告警。
 *
 * 安全：在 shell 命令中使用面板 ID 前会先校验。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmuxExec } from '../../cli/tmux-utils.js';

const STATE_FILE = 'pane-tail-positions.json';

/** 每次捕获默认输出的最大新增行数。 */
const DEFAULT_MAX_LINES = 15;

/** 合法的 tmux 面板 ID 格式：%0、%1、%123 等。 */
function isValidPaneId(paneId: string): boolean {
  return /^%\d+$/.test(paneId);
}

type PaneTailState = Record<string, number>;

function readPaneTailState(stateDir: string): PaneTailState {
  const path = join(stateDir, STATE_FILE);
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as PaneTailState;
      }
    }
  } catch {
    // 损坏或缺失 —— 从头开始
  }
  return {};
}

function writePaneTailState(stateDir: string, state: PaneTailState): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, STATE_FILE), JSON.stringify(state), { mode: 0o600 });
  } catch {
    // 尽力而为 —— 写入失败绝不阻塞告警路径
  }
}

/**
 * 获取 tmux 面板当前的回滚历史大小。
 * 当面板已死亡、不存在或 tmux 不可用时返回 null。
 */
export function getPaneHistorySize(paneId: string): number | null {
  try {
    const raw = tmuxExec(
      ['display-message', '-t', paneId, '-p', '#{pane_dead} #{history_size}'],
      { stripTmux: true, timeout: 3000 },
    ).trim();

    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const [paneDeadRaw, historySizeRaw] = parts;
      if (paneDeadRaw === '1') {
        return null;
      }
      const n = parseInt(historySizeRaw ?? '', 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }

    // 向后兼容兜底：当 tmux 仅返回 history_size 时。
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * 捕获面板内容的最后 `lines` 行。
 */
function capturePaneLines(paneId: string, lines: number): string {
  try {
    const safeLines = Math.max(1, Math.min(500, Math.floor(lines)));
    return tmuxExec(
      ['capture-pane', '-t', paneId, '-p', '-S', `-${safeLines}`],
      { stripTmux: true, timeout: 5000 },
    );
  } catch {
    return '';
  }
}

/**
 * 仅返回自上次针对该面板 ID 调用以来新增的面板行。
 *
 * 当出现以下情况时返回空字符串：
 * - 面板已不存在（会话终止/被取代）
 * - 自上次扫描以来没有新行写入（陈旧）
 * - 面板 ID 格式非法
 *
 * 针对某个面板的首次扫描会返回最近的尾部内容（最多
 * `maxLines` 行），确保首次停止事件通知总是带有上下文。
 * 后续扫描仅返回增量，防止陈旧内容重复告警。
 *
 * @param paneId   tmux 面板 ID（如 "%3"）
 * @param stateDir 用于持久化各面板位置的目录
 * @param maxLines 输出的最大新增行数（默认 15）
 */
export function getNewPaneTail(
  paneId: string,
  stateDir: string,
  maxLines: number = DEFAULT_MAX_LINES,
): string {
  if (!isValidPaneId(paneId)) {
    return '';
  }

  const currentSize = getPaneHistorySize(paneId);
  if (currentSize === null) {
    // 面板消失或 tmux 不可用 —— 静默跳过，而非重放陈旧内容。
    return '';
  }

  const state = readPaneTailState(stateDir);
  const lastSize = state[paneId] ?? -1;

  // 在捕获前更新已存位置，这样捕获出错也不会
  // 导致下次调用重复输出相同的行。
  state[paneId] = currentSize;
  writePaneTailState(stateDir, state);

  if (lastSize < 0) {
    // 该面板的首次扫描 —— 输出有界最近尾部作为初始上下文。
    return capturePaneLines(paneId, maxLines);
  }

  const newLines = currentSize - lastSize;
  if (newLines <= 0) {
    // 自上次扫描以来没有新输出 —— 陈旧，抑制。
    return '';
  }

  // 仅输出增量，以 maxLines 为上限以限制载荷大小。
  return capturePaneLines(paneId, Math.min(newLines, maxLines));
}
