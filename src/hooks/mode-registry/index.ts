/**
 * 模式注册表 - 集中式模式状态检测
 *
 * 关键：本模块仅使用基于文件的检测。
 * 绝不从模式模块导入，以避免循环依赖。
 *
 * 模式模块从本注册表导入（单向）。
 *
 * 所有模式统一将状态存储在 `.wise/state/` 子目录下。
 */

import {
  existsSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmdirSync,
  rmSync,
} from "fs";
import { atomicWriteJsonSync } from "../../lib/atomic-write.js";
import { join, dirname } from "path";
import type {
  ExecutionMode,
  ModeConfig,
  ModeStatus,
  CanStartResult,
} from "./types.js";
import {
  listSessionIds,
  resolveSessionStatePath,
  getSessionStateDir,
  getWiseRoot,
} from "../../lib/worktree-paths.js";
import { MODE_STATE_FILE_MAP, MODE_NAMES } from "../../lib/mode-names.js";

export type {
  ExecutionMode,
  ModeConfig,
  ModeStatus,
  CanStartResult,
} from "./types.js";

/**
 * 模式配置注册表
 *
 * 将每个模式映射到其状态文件位置与检测方式。
 * 所有路径均相对于 .wise/state/ 目录。
 */
const MODE_CONFIGS: Record<ExecutionMode, ModeConfig> = {
  [MODE_NAMES.AUTOPILOT]: {
    name: "Autopilot",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.AUTOPILOT],
    activeProperty: "active",
  },
  [MODE_NAMES.AUTORESEARCH]: {
    name: "Autoresearch",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.AUTORESEARCH],
    activeProperty: "active",
    hasGlobalState: false,
  },
  [MODE_NAMES.TEAM]: {
    name: "Team",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.TEAM],
    activeProperty: "active",
    hasGlobalState: false,
  },
  [MODE_NAMES.RALPH]: {
    name: "Ralph",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.RALPH],
    markerFile: "ralph-verification.json",
    activeProperty: "active",
    hasGlobalState: false,
  },
  [MODE_NAMES.ULTRAWORK]: {
    name: "Ultrawork",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAWORK],
    activeProperty: "active",
    hasGlobalState: false,
  },
  [MODE_NAMES.ULTRAQA]: {
    name: "UltraQA",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.ULTRAQA],
    activeProperty: "active",
  },
  [MODE_NAMES.DEEP_INTERVIEW]: {
    name: "Deep Interview",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.DEEP_INTERVIEW],
    activeProperty: "active",
  },
  [MODE_NAMES.SELF_IMPROVE]: {
    name: "Self Improve",
    stateFile: MODE_STATE_FILE_MAP[MODE_NAMES.SELF_IMPROVE],
    activeProperty: "active",
  },
};

// 导出供其他模块使用
export { MODE_CONFIGS };

/**
 * 互斥模式（不能并发运行）
 */
const EXCLUSIVE_MODES: ExecutionMode[] = [MODE_NAMES.AUTOPILOT, MODE_NAMES.AUTORESEARCH];

/**
 * 获取状态目录路径
 */
export function getStateDir(cwd: string): string {
  return join(getWiseRoot(cwd), "state");
}

/**
 * 确保状态目录存在
 */
export function ensureStateDir(cwd: string): void {
  const stateDir = getStateDir(cwd);
  mkdirSync(stateDir, { recursive: true });
}

/**
 * 获取模式状态文件的完整路径
 */
export function getStateFilePath(
  cwd: string,
  mode: ExecutionMode,
  sessionId?: string,
): string {
  const config = MODE_CONFIGS[mode];
  if (sessionId) {
    return resolveSessionStatePath(mode, sessionId, cwd);
  }
  return join(getStateDir(cwd), config.stateFile);
}

/**
 * 获取模式标记文件的完整路径
 */
export function getMarkerFilePath(
  cwd: string,
  mode: ExecutionMode,
): string | null {
  const config = MODE_CONFIGS[mode];
  if (!config.markerFile) return null;
  return join(getStateDir(cwd), config.markerFile);
}

/**
 * 获取支持全局状态的模式的全局状态文件路径（位于 ~/.claude/ 下）
 * @deprecated 全局状态已不再支持。所有模式均使用 .wise/state/ 下的本地状态
 * @returns 始终返回 null
 */
export function getGlobalStateFilePath(_mode: ExecutionMode): string | null {
  // 全局状态已弃用 - 所有模式现在都使用本地状态
  return null;
}

/**
 * 工作流槽位墓碑 TTL。与
 * `src/hooks/skill-state/index.ts` 中的 `WORKFLOW_TOMBSTONE_TTL_MS` 保持一致 ——
 * 此处保留为本地常量，以维持
 * "mode-registry 仅使用基于文件检测"的不变量（不从
 * 依赖本注册表的钩子模块导入）。
 */
const WORKFLOW_SLOT_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 查询会话本地的工作流账本，检查对应槽位是否已设墓碑。
 *
 * 当工作流账本记录该模式为已设墓碑（软完成）且墓碑尚未超过 TTL 过期时，返回 `true`。
 * 用于否决崩溃会话遗留的陈旧模式文件（这些会话未能自行清理状态）。
 *
 * 对于任何无法解析的结构、缺失文件、活跃槽位，以及墓碑已过期的槽位，均返回 `false`
 * —— 因此当账本无记录时，旧的模式文件兜底逻辑仍是权威。
 */
function isWorkflowSlotTombstonedForMode(
  cwd: string,
  mode: ExecutionMode,
  sessionId?: string,
  now: number = Date.now(),
): boolean {
  try {
    const ledgerPath = sessionId
      ? resolveSessionStatePath("skill-active", sessionId, cwd)
      : join(getStateDir(cwd), "skill-active-state.json");
    if (!existsSync(ledgerPath)) return false;

    const raw = JSON.parse(readFileSync(ledgerPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const slots = raw.active_skills;
    if (!slots || typeof slots !== "object") return false;

    const slot = (slots as Record<string, unknown>)[mode];
    if (!slot || typeof slot !== "object") return false;

    const completedAt = (slot as Record<string, unknown>).completed_at;
    if (typeof completedAt !== "string" || completedAt.length === 0)
      return false;

    const tombstonedAt = new Date(completedAt).getTime();
    if (!Number.isFinite(tombstonedAt)) return false;
    return now - tombstonedAt < WORKFLOW_SLOT_TOMBSTONE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * 通过读取状态文件判断基于 JSON 的模式是否处于活跃状态。
 *
 * 工作流槽位覆盖：当会话工作流账本记录该模式为已设墓碑（软完成）时，会忽略陈旧的
 * 单模式状态文件，使新的调用无需手动清理产物即可继续。活跃槽位与缺失槽位
 * 均以单模式状态文件为准（过渡期内保留旧兜底逻辑）。
 */
function isJsonModeActive(
  cwd: string,
  mode: ExecutionMode,
  sessionId?: string,
): boolean {
  if (isWorkflowSlotTombstonedForMode(cwd, mode, sessionId)) {
    return false;
  }
  const config = MODE_CONFIGS[mode];

  // 当提供 sessionId 时，仅检查会话作用域路径 —— 不走旧兜底逻辑。
  // 这可防止跨会话状态泄漏：某会话的旧文件
  // 不会导致另一会话误判模式为活跃。
  if (sessionId) {
    const sessionStateFile = resolveSessionStatePath(mode, sessionId, cwd);
    try {
      const content = readFileSync(sessionStateFile, "utf-8");
      const state = JSON.parse(content);

      // 校验会话身份：状态必须属于当前会话
      if (state.session_id && state.session_id !== sessionId) {
        return false;
      }

      if (config.activeProperty) {
        return state[config.activeProperty] === true;
      }

      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      return false;
    }
  }

  // 无 sessionId：检查旧的共享路径（向后兼容）
  const stateFile = getStateFilePath(cwd, mode);
  try {
    const content = readFileSync(stateFile, "utf-8");
    const state = JSON.parse(content);

    if (config.activeProperty) {
      return state[config.activeProperty] === true;
    }

    // 默认：文件存在即视为活跃
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return false;
  }
}

/**
 * 检查特定模式当前是否处于活跃状态
 *
 * @param mode - 要检查的模式
 * @param cwd - 工作目录
 * @param sessionId - 可选会话 ID，用于检查会话作用域状态
 * @returns 模式活跃则返回 true
 */
export function isModeActive(
  mode: ExecutionMode,
  cwd: string,
  sessionId?: string,
): boolean {
  return isJsonModeActive(cwd, mode, sessionId);
}

/**
 * 检查模式是否具有活跃状态（文件存在）
 * @param sessionId - 提供时仅检查会话作用域路径（不走旧兜底逻辑）
 */
export function hasModeState(
  cwd: string,
  mode: ExecutionMode,
  sessionId?: string,
): boolean {
  const stateFile = getStateFilePath(cwd, mode, sessionId);
  return existsSync(stateFile);
}

/**
 * 获取当前具有状态文件的所有模式
 */
export function getActiveModes(
  cwd: string,
  sessionId?: string,
): ExecutionMode[] {
  const modes: ExecutionMode[] = [];

  for (const mode of Object.keys(MODE_CONFIGS) as ExecutionMode[]) {
    if (isModeActive(mode, cwd, sessionId)) {
      modes.push(mode);
    }
  }

  return modes;
}

/**
 * 检查是否有任意 WISE 模式当前处于活跃状态
 *
 * @param cwd - 工作目录
 * @returns 有任意模式活跃则返回 true
 */
export function isAnyModeActive(cwd: string): boolean {
  return getActiveModes(cwd).length > 0;
}

/**
 * 获取当前活跃的互斥模式（若有）
 *
 * @param cwd - 工作目录
 * @returns 活跃的模式或 null
 */
export function getActiveExclusiveMode(cwd: string): ExecutionMode | null {
  for (const mode of EXCLUSIVE_MODES) {
    if (isModeActive(mode, cwd)) {
      return mode;
    }
  }
  return null;
}

/**
 * 检查能否启动新模式
 *
 * @param mode - 要启动的模式
 * @param cwd - 工作目录
 * @returns CanStartResult，包含允许状态与阻塞信息
 */
export function canStartMode(mode: ExecutionMode, cwd: string): CanStartResult {
  // 检查所有会话中是否存在互斥模式
  if (EXCLUSIVE_MODES.includes(mode)) {
    for (const exclusiveMode of EXCLUSIVE_MODES) {
      if (
        exclusiveMode !== mode &&
        isModeActiveInAnySession(exclusiveMode, cwd)
      ) {
        const config = MODE_CONFIGS[exclusiveMode];
        return {
          allowed: false,
          blockedBy: exclusiveMode,
          message: `Cannot start ${MODE_CONFIGS[mode].name} while ${config.name} is active. Cancel ${config.name} first with /wise:cancel.`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * 获取所有模式的状态
 *
 * @param cwd - 工作目录
 * @param sessionId - 可选会话 ID，用于检查会话作用域状态
 * @returns 模式状态数组
 */
export function getAllModeStatuses(
  cwd: string,
  sessionId?: string,
): ModeStatus[] {
  return (Object.keys(MODE_CONFIGS) as ExecutionMode[]).map((mode) => ({
    mode,
    active: isModeActive(mode, cwd, sessionId),
    stateFilePath: getStateFilePath(cwd, mode, sessionId),
  }));
}

/**
 * 清除某个模式的所有状态文件
 *
 * 删除：
 * - 本地状态文件（.wise/state/{mode}-state.json）
 * - 提供 sessionId 时删除会话作用域状态文件
 * - 适用时删除本地标记文件
 * - 适用时删除全局状态文件（~/.claude/{mode}-state.json）
 *
 * @returns 所有文件删除成功（或本不存在）时返回 true
 */
export function clearModeState(
  mode: ExecutionMode,
  cwd: string,
  sessionId?: string,
): boolean {
  const config = MODE_CONFIGS[mode];
  let success = true;
  const markerFile = getMarkerFilePath(cwd, mode);
  const isSessionScopedClear = Boolean(sessionId);

  // 提供 sessionId 时删除会话作用域状态文件
  if (isSessionScopedClear && sessionId) {
    const sessionStateFile = resolveSessionStatePath(mode, sessionId, cwd);
    try {
      unlinkSync(sessionStateFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        success = false;
      }
    }

    // 清理会话作用域的标记产物（如 ralph-verification-state.json）。
    // 为保持隔离，旧的共享标记文件保持不动。
    if (config.markerFile) {
      const markerStateName = config.markerFile.replace(/\.json$/i, "");
      const sessionMarkerFile = resolveSessionStatePath(
        markerStateName,
        sessionId,
        cwd,
      );
      try {
        unlinkSync(sessionMarkerFile);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          success = false;
        }
      }
    }

    // 同时尽力清理该模式的旧标记（best-effort）。
    // 为保持隔离，仅删除无主标记或属于当前会话的标记。
    if (markerFile) {
      try {
        const markerRaw = JSON.parse(readFileSync(markerFile, "utf-8")) as {
          session_id?: string;
          sessionId?: string;
        };
        const markerSessionId = markerRaw.session_id ?? markerRaw.sessionId;
        if (!markerSessionId || markerSessionId === sessionId) {
          try {
            unlinkSync(markerFile);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
              success = false;
            }
          }
        }
      } catch {
        // 若标记不是 JSON（或不可读），尽力删除以清理。
        try {
          unlinkSync(markerFile);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            success = false;
          }
        }
      }
    }
  }

  // 非会话清理时删除本地状态文件（旧路径）
  const stateFile = getStateFilePath(cwd, mode);
  if (!isSessionScopedClear) {
    try {
      unlinkSync(stateFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        success = false;
      }
    }
  }

  // 适用时删除标记文件，但在会话作用域下须尊重归属。
  if (markerFile) {
    if (isSessionScopedClear) {
      // 仅当标记无主或属于当前会话时才删除。
      try {
        const markerRaw = JSON.parse(readFileSync(markerFile, "utf-8")) as {
          session_id?: string;
          sessionId?: string;
        };
        const markerSessionId = markerRaw.session_id ?? markerRaw.sessionId;
        if (!markerSessionId || markerSessionId === sessionId) {
          try {
            unlinkSync(markerFile);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
              success = false;
            }
          }
        }
      } catch {
        // 标记不是有效 JSON 或不可读 —— 尽力删除以清理。
        try {
          unlinkSync(markerFile);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            success = false;
          }
        }
      }
    } else {
      try {
        unlinkSync(markerFile);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          success = false;
        }
      }
    }
  }

  // 注意：全局状态文件已不再使用（仅本地状态迁移）

  return success;
}

/**
 * 清除所有模式状态（强制清除）
 */
export function clearAllModeStates(cwd: string): boolean {
  let success = true;

  for (const mode of Object.keys(MODE_CONFIGS) as ExecutionMode[]) {
    if (!clearModeState(mode, cwd)) {
      success = false;
    }
  }

  // 清理 skill-active-state.json（issue #1033）
  const skillStatePath = join(getStateDir(cwd), "skill-active-state.json");
  try {
    unlinkSync(skillStatePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      success = false;
    }
  }

  // 同时清理会话目录
  try {
    const sessionIds = listSessionIds(cwd);
    for (const sid of sessionIds) {
      const sessionDir = getSessionStateDir(sid, cwd);
      rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch {
    success = false;
  }

  return success;
}

/**
 * 检查某模式是否在任意会话中活跃
 *
 * @param mode - 要检查的模式
 * @param cwd - 工作目录
 * @returns 模式在任意会话或旧路径中活跃则返回 true
 */
export function isModeActiveInAnySession(
  mode: ExecutionMode,
  cwd: string,
): boolean {
  // 先检查旧路径
  if (isJsonModeActive(cwd, mode)) {
    return true;
  }

  // 扫描所有会话目录
  const sessionIds = listSessionIds(cwd);
  for (const sid of sessionIds) {
    if (isJsonModeActive(cwd, mode, sid)) {
      return true;
    }
  }

  return false;
}

/**
 * 获取具有特定活跃模式的所有会话 ID
 *
 * @param mode - 要检查的模式
 * @param cwd - 工作目录
 * @returns 该模式活跃的会话 ID 数组
 */
export function getActiveSessionsForMode(
  mode: ExecutionMode,
  cwd: string,
): string[] {
  const sessionIds = listSessionIds(cwd);
  return sessionIds.filter((sid) => isJsonModeActive(cwd, mode, sid));
}

/**
 * 清理陈旧的会话目录
 *
 * 移除为空或近期无活动的会话目录。
 *
 * @param cwd - 工作目录
 * @param maxAgeMs - 最大存活时间（毫秒，默认 24 小时）
 * @returns 已移除的会话 ID 数组
 */
export function clearStaleSessionDirs(
  cwd: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): string[] {
  const removed: string[] = [];
  const sessionIds = listSessionIds(cwd);

  for (const sid of sessionIds) {
    const sessionDir = getSessionStateDir(sid, cwd);
    try {
      const files = readdirSync(sessionDir);

      // 移除空目录
      if (files.length === 0) {
        rmdirSync(sessionDir);
        removed.push(sid);
        continue;
      }

      // 检查任意状态文件的修改时间
      let newest = 0;
      for (const f of files) {
        const stat = statSync(join(sessionDir, f));
        if (stat.mtimeMs > newest) {
          newest = stat.mtimeMs;
        }
      }

      // 若陈旧则移除
      if (Date.now() - newest > maxAgeMs) {
        rmSync(sessionDir, { recursive: true, force: true });
        removed.push(sid);
      }
    } catch {
      // 出错时跳过
    }
  }

  return removed;
}

// ============================================================================
// 标记文件管理
// ============================================================================

/**
 * 创建标记文件以表示某模式处于活跃状态
 *
 * @param mode - 正在启动的模式
 * @param cwd - 工作目录
 * @param metadata - 可选的要存入标记的元数据
 */
export function createModeMarker(
  mode: ExecutionMode,
  cwd: string,
  metadata?: Record<string, unknown>,
): boolean {
  const markerPath = getMarkerFilePath(cwd, mode);
  if (!markerPath) {
    console.error(`Mode ${mode} does not use a marker file`);
    return false;
  }

  try {
    // 确保目录存在
    const dir = dirname(markerPath);
    mkdirSync(dir, { recursive: true });

    atomicWriteJsonSync(markerPath, {
      mode,
      startedAt: new Date().toISOString(),
      ...metadata,
    });
    return true;
  } catch (error) {
    console.error(`Failed to create marker file for ${mode}:`, error);
    return false;
  }
}

/**
 * 移除标记文件以表示某模式已停止
 *
 * @param mode - 正在停止的模式
 * @param cwd - 工作目录
 */
export function removeModeMarker(mode: ExecutionMode, cwd: string): boolean {
  const markerPath = getMarkerFilePath(cwd, mode);
  if (!markerPath) {
    return true; // 没有可移除的标记
  }

  try {
    unlinkSync(markerPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    console.error(`Failed to remove marker file for ${mode}:`, error);
    return false;
  }
}

/**
 * 从标记文件读取元数据
 *
 * @param mode - 要读取的模式
 * @param cwd - 工作目录
 */
export function readModeMarker(
  mode: ExecutionMode,
  cwd: string,
): Record<string, unknown> | null {
  const markerPath = getMarkerFilePath(cwd, mode);
  if (!markerPath) {
    return null;
  }

  try {
    const content = readFileSync(markerPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

/**
 * 强制移除标记文件，不考虑陈旧程度
 * 供用户手动清理使用
 *
 * @param mode - 要清理的模式
 * @param cwd - 工作目录
 */
export function forceRemoveMarker(mode: ExecutionMode, cwd: string): boolean {
  const markerPath = getMarkerFilePath(cwd, mode);
  if (!markerPath) {
    return true; // 没有可移除的标记
  }

  try {
    unlinkSync(markerPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    console.error(`Failed to force remove marker file for ${mode}:`, error);
    return false;
  }
}
