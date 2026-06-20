/**
 * 状态管理器
 *
 * 统一的状态管理，标准化状态文件位置：
 * - 本地状态：.wise/state/{name}.json
 * - 全局状态：XDG 感知的用户 WISE 状态，兜底到旧版 ~/.wise/state
 *
 * 特性：
 * - 类型安全的读写操作
 * - 自动创建目录
 * - 支持旧版位置（用于迁移）
 * - 状态清理工具
 */

import * as fs from "fs";
import * as path from "path";
import { atomicWriteJsonSync } from "../../lib/atomic-write.js";
import {
  WisePaths,
  getWorktreeRoot,
  getWiseRoot,
  validateWorkingDirectory,
} from "../../lib/worktree-paths.js";
import { getGlobalWiseStateRoot, getLegacyWisePath } from "../../utils/paths.js";
import {
  StateLocation,
  StateConfig,
  StateReadResult,
  StateWriteResult,
  StateClearResult,
  StateMigrationResult,
  StateFileInfo,
  ListStatesOptions,
  CleanupOptions,
  CleanupResult,
  StateData,
  DEFAULT_STATE_CONFIG,
} from "./types.js";

// 标准状态目录
/** 获取本地状态目录的绝对路径，从 git worktree 根解析。 */
function getLocalStateDir(): string {
  return path.join(validateWorkingDirectory(), WisePaths.STATE);
}
/**
 * @deprecated 用于模式状态。全局状态目录仅用于分析和守护进程状态。
 * 模式状态应只用 LOCAL_STATE_DIR。
 */
const GLOBAL_STATE_DIR = getGlobalWiseStateRoot();

/** 状态文件被视为陈旧前的最大时长（4 小时） */
const MAX_STATE_AGE_MS = 4 * 60 * 60 * 1000;

// 读缓存：在 TTL 内避免重复读取未变化的状态文件
const STATE_CACHE_TTL_MS = 5_000; // 5 秒
const MAX_CACHE_SIZE = 200;
interface CacheEntry {
  data: unknown;
  mtime: number;
  cachedAt: number;
}
const stateCache = new Map<string, CacheEntry>();

/**
 * 清空状态读缓存。
 * 导出供测试以及写/清操作用于作废陈旧条目。
 */
export function clearStateCache(): void {
  stateCache.clear();
}

// 旧版状态位置（用于向后兼容）
const LEGACY_LOCATIONS: Record<string, string[]> = {
  boulder: [".wise/state/boulder.json"],
  autopilot: [".wise/state/autopilot-state.json"],
  "autopilot-state": [".wise/state/autopilot-state.json"],
  ralph: [".wise/state/ralph-state.json"],
  "ralph-state": [".wise/state/ralph-state.json"],
  "ralph-verification": [".wise/state/ralph-verification.json"],
  ultrawork: [".wise/state/ultrawork-state.json"],
  "ultrawork-state": [".wise/state/ultrawork-state.json"],
  ultraqa: [".wise/state/ultraqa-state.json"],
  "ultraqa-state": [".wise/state/ultraqa-state.json"],
  "hud-state": [".wise/state/hud-state.json"],
  prd: [".wise/state/prd.json"],
};

/**
 * 获取状态文件的标准路径
 */
export function getStatePath(name: string, location: StateLocation): string {
  const baseDir =
    location === StateLocation.LOCAL ? getLocalStateDir() : GLOBAL_STATE_DIR;
  return path.join(baseDir, `${name}.json`);
}

/**
 * 获取状态文件的旧版路径（用于迁移）
 */
export function getLegacyPaths(name: string, location: StateLocation = StateLocation.LOCAL): string[] {
  const legacyPaths = [...(LEGACY_LOCATIONS[name] || [])];

  if (location === StateLocation.GLOBAL) {
    legacyPaths.push(getLegacyWisePath("state", `${name}.json`));
  }

  return legacyPaths;
}

/**
 * 确保状态目录存在
 */
export function ensureStateDir(location: StateLocation): void {
  const dir =
    location === StateLocation.LOCAL ? getLocalStateDir() : GLOBAL_STATE_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveLegacyStatePath(legacyPath: string): string {
  return path.isAbsolute(legacyPath)
    ? legacyPath
    : path.join(getWorktreeRoot() || process.cwd(), legacyPath);
}

function warnStateReadFailure(kind: "state" | "legacy state", filePath: string, error: unknown): void {
  console.warn(`Failed to read ${kind} from ${filePath}:`, error);
}

/**
 * 从文件读取状态
 *
 * 先检查标准位置，启用时再检查旧版位置。
 * 返回数据及其所在位置。
 */
export function readState<T = StateData>(
  name: string,
  location: StateLocation = StateLocation.LOCAL,
  options?: { checkLegacy?: boolean },
): StateReadResult<T> {
  const checkLegacy = options?.checkLegacy ?? DEFAULT_STATE_CONFIG.checkLegacy;
  const standardPath = getStatePath(name, location);
  const legacyPaths = checkLegacy ? getLegacyPaths(name, location) : [];

  // 先尝试标准位置
  if (fs.existsSync(standardPath)) {
    try {
      // 在读取前获取 mtime，以防 TOCTOU 缓存投毒。
      // 此前 mtime 在 readFileSync 之后读取，因此两次操作间的
      // 并发写入可能以新的 mtime 缓存陈旧数据。
      const statBefore = fs.statSync(standardPath);
      const mtimeBefore = statBefore.mtimeMs;

      // 检查缓存：条目存在、mtime 匹配、TTL 未过期
      const cached = stateCache.get(standardPath);
      if (
        cached &&
        cached.mtime === mtimeBefore &&
        Date.now() - cached.cachedAt < STATE_CACHE_TTL_MS
      ) {
        return {
          exists: true,
          data: structuredClone(cached.data) as T,
          foundAt: standardPath,
          legacyLocations: [],
        };
      }

      // 缓存未命中或陈旧 —— 从磁盘读取
      const content = fs.readFileSync(standardPath, "utf-8");
      const data = JSON.parse(content) as T;

      // 校验读取期间 mtime 未变，以防缓存不一致的数据。
      // 若文件在 statBefore 与 readFileSync 之间被修改，仍
      // 返回数据但不缓存 —— 下次读取会重新从磁盘读取。
      try {
        const statAfter = fs.statSync(standardPath);
        if (statAfter.mtimeMs === mtimeBefore) {
          if (stateCache.size >= MAX_CACHE_SIZE) {
            const firstKey = stateCache.keys().next().value;
            if (firstKey !== undefined) stateCache.delete(firstKey);
          }
          stateCache.set(standardPath, {
            data: structuredClone(data),
            mtime: mtimeBefore,
            cachedAt: Date.now(),
          });
        }
      } catch {
        // statSync 失败 —— 跳过缓存，数据仍会返回
      }

      return {
        exists: true,
        data: structuredClone(data) as T,
        foundAt: standardPath,
        legacyLocations: [],
      };
    } catch (error) {
      // 非法 JSON 或读取错误 —— 视为未找到
      warnStateReadFailure("state", standardPath, error);
    }
  }

  // 尝试旧版位置
  if (checkLegacy) {
    for (const legacyPath of legacyPaths) {
      const resolvedPath = resolveLegacyStatePath(legacyPath);

      if (fs.existsSync(resolvedPath)) {
        try {
          const content = fs.readFileSync(resolvedPath, "utf-8");
          const data = JSON.parse(content) as T;
          return {
            exists: true,
            data: structuredClone(data) as T,
            foundAt: resolvedPath,
            legacyLocations: legacyPaths,
          };
        } catch (error) {
          warnStateReadFailure("legacy state", resolvedPath, error);
        }
      }
    }
  }

  return {
    exists: false,
    legacyLocations: checkLegacy ? legacyPaths : [],
  };
}

/**
 * 将状态写入文件
 *
 * 始终写入标准位置。
 * 目录不存在时自动创建。
 */
export function writeState<T = StateData>(
  name: string,
  data: T,
  location: StateLocation = StateLocation.LOCAL,
  options?: { createDirs?: boolean },
): StateWriteResult {
  const createDirs = options?.createDirs ?? DEFAULT_STATE_CONFIG.createDirs;
  const statePath = getStatePath(name, location);

  // 写入时作废缓存
  stateCache.delete(statePath);

  try {
    // 确保目录存在
    if (createDirs) {
      ensureStateDir(location);
    }

    atomicWriteJsonSync(statePath, data);

    return {
      success: true,
      path: statePath,
    };
  } catch (error) {
    return {
      success: false,
      path: statePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 从所有位置（标准 + 旧版）清除状态
 *
 * 从标准和旧版位置删除状态文件。
 * 返回已删除内容的信息。
 */
export function clearState(
  name: string,
  location?: StateLocation,
): StateClearResult {
  // 作废所有可能位置的缓存
  const locationsForCache: StateLocation[] = location
    ? [location]
    : [StateLocation.LOCAL, StateLocation.GLOBAL];
  for (const loc of locationsForCache) {
    stateCache.delete(getStatePath(name, loc));
  }

  const result: StateClearResult = {
    removed: [],
    notFound: [],
    errors: [],
  };

  // 确定要检查哪些位置
  const locationsToCheck: StateLocation[] = location
    ? [location]
    : [StateLocation.LOCAL, StateLocation.GLOBAL];

  // 从标准位置删除
  for (const loc of locationsToCheck) {
    const standardPath = getStatePath(name, loc);
    try {
      if (fs.existsSync(standardPath)) {
        fs.unlinkSync(standardPath);
        result.removed.push(standardPath);
      } else {
        result.notFound.push(standardPath);
      }
    } catch (error) {
      result.errors.push({
        path: standardPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 从旧版位置删除
  const legacyPaths = getLegacyPaths(name, location ?? StateLocation.LOCAL);
  for (const legacyPath of legacyPaths) {
    const resolvedPath = resolveLegacyStatePath(legacyPath);

    try {
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
        result.removed.push(resolvedPath);
      } else {
        result.notFound.push(resolvedPath);
      }
    } catch (error) {
      result.errors.push({
        path: resolvedPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * 将状态从旧版位置迁移到标准位置
 *
 * 在旧版位置查找状态并移动到标准位置。
 * 迁移成功后删除旧版文件。
 */
export function migrateState(
  name: string,
  location: StateLocation = StateLocation.LOCAL,
): StateMigrationResult {
  // 检查是否已在标准位置
  const standardPath = getStatePath(name, location);
  if (fs.existsSync(standardPath)) {
    return {
      migrated: false,
    };
  }

  // 查找旧版状态
  const readResult = readState(name, location, { checkLegacy: true });
  if (!readResult.exists || !readResult.foundAt || !readResult.data) {
    return {
      migrated: false,
      error: "No legacy state found",
    };
  }

  // 检查是否确实来自旧版位置
  const isLegacy = readResult.foundAt !== standardPath;
  if (!isLegacy) {
    return {
      migrated: false,
    };
  }

  // 写入标准位置
  const writeResult = writeState(name, readResult.data, location);
  if (!writeResult.success) {
    return {
      migrated: false,
      error: `Failed to write to standard location: ${writeResult.error}`,
    };
  }

  // 删除旧版文件
  try {
    fs.unlinkSync(readResult.foundAt);
  } catch (error) {
    // 迁移成功但清理失败 —— 非关键
    console.warn(
      `Failed to delete legacy state at ${readResult.foundAt}:`,
      error,
    );
  }

  return {
    migrated: true,
    from: readResult.foundAt,
    to: writeResult.path,
  };
}

/**
 * 列出所有状态文件
 *
 * 返回指定位置中所有状态文件的信息。
 */
export function listStates(options?: ListStatesOptions): StateFileInfo[] {
  const results: StateFileInfo[] = [];
  const includeLegacy = options?.includeLegacy ?? false;
  const pattern = options?.pattern;

  // 辅助：检查名称是否匹配模式
  const matchesPattern = (name: string): boolean => {
    if (!pattern) return true;
    // 简单 glob：* 匹配任意内容
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return regex.test(name);
  };

  // 辅助：从目录添加状态文件
  const addStatesFromDir = (
    dir: string,
    location: StateLocation,
    isLegacy: boolean = false,
  ) => {
    if (!fs.existsSync(dir)) return;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const name = file.slice(0, -5); // 去除 .json
        if (!matchesPattern(name)) continue;

        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        results.push({
          name,
          path: filePath,
          location,
          size: stats.size,
          modified: stats.mtime,
          isLegacy,
        });
      }
    } catch (error) {
      console.warn(`Failed to list states from ${dir}:`, error);
    }
  };

  // 检查标准位置
  if (!options?.location || options.location === StateLocation.LOCAL) {
    addStatesFromDir(getLocalStateDir(), StateLocation.LOCAL);
  }
  if (!options?.location || options.location === StateLocation.GLOBAL) {
    addStatesFromDir(GLOBAL_STATE_DIR, StateLocation.GLOBAL);
  }

  // 如有要求则检查旧版位置
  if (includeLegacy) {
    // 补充扫描旧版位置的逻辑
    // 这需要知道所有可能的旧版位置
    // 暂且跳过，因为旧版位置与名称一一对应
  }

  return results;
}

/**
 * 清理孤立状态文件
 *
 * 删除长时间未修改的状态文件。
 * 适合清理被遗弃的状态。
 */
export function cleanupOrphanedStates(options?: CleanupOptions): CleanupResult {
  const maxAgeDays = options?.maxAgeDays ?? 30;
  const dryRun = options?.dryRun ?? false;
  const exclude = options?.exclude ?? [];

  const result: CleanupResult = {
    deleted: [],
    wouldDelete: dryRun ? [] : undefined,
    spaceFreed: 0,
    errors: [],
  };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  const states = listStates({ includeLegacy: false });

  for (const state of states) {
    // 跳过被排除的模式
    if (
      exclude.some((pattern) => {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        return regex.test(state.name);
      })
    ) {
      continue;
    }

    // 检查是否足够陈旧
    if (state.modified > cutoffDate) {
      continue;
    }

    // 删除或为 dry run 记录
    if (dryRun) {
      result.wouldDelete?.push(state.path);
      result.spaceFreed += state.size;
    } else {
      try {
        fs.unlinkSync(state.path);
        result.deleted.push(state.path);
        result.spaceFreed += state.size;
      } catch (error) {
        result.errors.push({
          path: state.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}

/**
 * 判断状态的元数据是否表明其已陈旧。
 *
 * 当 `updatedAt` 和 `heartbeatAt`（如存在）都早于
 * `maxAgeMs` 时，状态即为陈旧。任一时间戳较新则视为存活 ——
 * 这让发送心跳的长时间运行工作流能通过陈旧检查。
 */
export function isStateStale(
  meta: { updatedAt?: string; heartbeatAt?: string },
  now: number,
  maxAgeMs: number,
): boolean {
  const updatedAt = meta.updatedAt
    ? new Date(meta.updatedAt).getTime()
    : undefined;
  const heartbeatAt = meta.heartbeatAt
    ? new Date(meta.heartbeatAt).getTime()
    : undefined;

  // 若 updatedAt 较新，则不陈旧
  if (updatedAt && !isNaN(updatedAt) && now - updatedAt <= maxAgeMs) {
    return false;
  }

  // 若 heartbeatAt 较新，则不陈旧
  if (heartbeatAt && !isNaN(heartbeatAt) && now - heartbeatAt <= maxAgeMs) {
    return false;
  }

  // 至少存在一个可解析的时间戳才能判定为陈旧
  const hasValidTimestamp =
    (updatedAt !== undefined && !isNaN(updatedAt)) ||
    (heartbeatAt !== undefined && !isNaN(heartbeatAt));

  return hasValidTimestamp;
}

/**
 * 扫描目录中所有状态文件，将陈旧的标记为非活动。
 *
 * 当 `_meta.updatedAt` 和 `_meta.heartbeatAt` 都早于
 * `maxAgeMs`（默认 MAX_STATE_AGE_MS = 4 小时）时，状态即视为陈旧。
 * 心跳较新的状态会被跳过，避免长时间运行的工作流被提前终止。
 *
 * 这是停用陈旧状态的**唯一**位置 —— 读路径（`readState`）
 * 是无副作用的纯读。
 *
 * @returns 被标记为非活动的状态数量。
 */
export function cleanupStaleStates(
  directory?: string,
  maxAgeMs: number = MAX_STATE_AGE_MS,
): number {
  const stateDir = directory
    ? path.join(getWiseRoot(directory), "state")
    : getLocalStateDir();

  if (!fs.existsSync(stateDir)) return 0;

  let cleaned = 0;
  const now = Date.now();

  // 辅助：扫描目录中的 JSON 文件，将陈旧的活动状态标记为非活动
  const scanDir = (dir: string): void => {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(dir, file);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(content) as Record<string, unknown>;

          if (data.active !== true) continue;

          const meta =
            (data._meta as Record<string, unknown> | undefined) ?? {};

          if (
            isStateStale(
              meta as { updatedAt?: string; heartbeatAt?: string },
              now,
              maxAgeMs,
            )
          ) {
            console.warn(
              `[state-manager] cleanupStaleStates: marking "${file}" inactive (last updated ${meta.updatedAt ?? "unknown"})`,
            );
            data.active = false;
            // 作废该路径的缓存
            stateCache.delete(filePath);
            try {
              atomicWriteJsonSync(filePath, data);
              cleaned++;
            } catch {
              /* 尽力而为 */
            }
          }
        } catch {
          // 跳过无法读取/解析的文件
        }
      }
    } catch {
      // 目录读取错误
    }
  };

  // 扫描顶层状态文件（.wise/state/*.json）
  scanDir(stateDir);

  // 扫描会话目录（.wise/state/sessions/*/*.json）
  const sessionsDir = path.join(stateDir, "sessions");
  if (fs.existsSync(sessionsDir)) {
    try {
      const sessionEntries = fs.readdirSync(sessionsDir, {
        withFileTypes: true,
      });
      for (const entry of sessionEntries) {
        if (entry.isDirectory()) {
          scanDir(path.join(sessionsDir, entry.name));
        }
      }
    } catch {
      // 会话目录读取错误
    }
  }

  return cleaned;
}

// 用于原子读-改-写操作的文件锁
const LOCK_STALE_MS = 30_000; // 超过 30s 的锁视为陈旧
const LOCK_TIMEOUT_MS = 5_000; // 获取锁的最大等待时间
const LOCK_POLL_MS = 10; // 锁尝试之间的忙等间隔

/**
 * 在持有独占文件锁的情况下执行函数。
 * 使用 O_EXCL 锁文件实现跨进程互斥。
 * 陈旧锁（超过 LOCK_STALE_MS）会被自动打破。
 *
 * @throws 若在 LOCK_TIMEOUT_MS 内无法获取锁则抛出错误
 */
function withFileLock<R>(filePath: string, fn: () => R): R {
  const lockPath = `${filePath}.lock`;
  const lockDir = path.dirname(lockPath);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  // 确保锁文件所在目录存在
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  // 通过独占创建文件获取锁
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // 锁已存在 —— 检查是否陈旧
      try {
        const lockStat = fs.statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            /* 竞态可接受 */
          }
          continue;
        }
      } catch {
        // 锁已消失 —— 立即重试
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring state lock: ${lockPath}`);
      }

      // 重试前短暂暂停（刻意同步自旋 —— 这是一个同步锁函数）
      const waitEnd = Date.now() + LOCK_POLL_MS;
      while (Date.now() < waitEnd) {
        /* 自旋 */
      }
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* 尽力而为 */
    }
  }
}

/**
 * 状态管理器类
 *
 * 用于管理特定状态的面向对象接口。
 *
 * @deprecated 对于模式状态（autopilot、ralph、ultrawork 等），请改用 `src/lib/mode-state-io.ts` 中的 `writeModeState`/`readModeState`。StateManager 仅保留用于非模式状态。
 */
export class StateManager<T = StateData> {
  constructor(
    private name: string,
    private location: StateLocation = StateLocation.LOCAL,
  ) {}

  read(options?: { checkLegacy?: boolean }): StateReadResult<T> {
    return readState<T>(this.name, this.location, options);
  }

  write(data: T, options?: { createDirs?: boolean }): StateWriteResult {
    return writeState(this.name, data, this.location, options);
  }

  clear(): StateClearResult {
    return clearState(this.name, this.location);
  }

  migrate(): StateMigrationResult {
    return migrateState(this.name, this.location);
  }

  exists(): boolean {
    return this.read({ checkLegacy: false }).exists;
  }

  get(): T | undefined {
    return this.read().data;
  }

  set(data: T): boolean {
    return this.write(data).success;
  }

  update(updater: (current: T | undefined) => T): boolean {
    const statePath = getStatePath(this.name, this.location);
    return withFileLock(statePath, () => {
      // 作废缓存以强制在锁内重新读取，
      // 防止以陈旧缓存数据作为更新的基础。
      stateCache.delete(statePath);
      const current = this.get();
      const updated = updater(current);
      return this.set(updated);
    });
  }
}

/**
 * 为特定状态创建状态管理器
 */
export function createStateManager<T = StateData>(
  name: string,
  location: StateLocation = StateLocation.LOCAL,
): StateManager<T> {
  return new StateManager<T>(name, location);
}

// 重导出类型供外部使用
export type {
  StateConfig,
  StateReadResult,
  StateWriteResult,
  StateClearResult,
  StateMigrationResult,
  StateFileInfo,
  ListStatesOptions,
  CleanupOptions,
  CleanupResult,
  StateData,
};

// 从 types 重导出枚举、常量和函数
export {
  StateLocation,
  DEFAULT_STATE_CONFIG,
  isStateLocation,
} from "./types.js";
