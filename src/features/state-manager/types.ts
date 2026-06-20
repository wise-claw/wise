/**
 * 状态管理器类型
 *
 * 跨本地（.wise/state/）与全局（XDG 感知的用户 WISE 状态路径，读取时兜底回退到旧版 ~/.wise/state）位置的统一状态管理类型定义。
 */

/**
 * 状态应存储的位置
 */
export enum StateLocation {
  /** 本地项目状态：.wise/state/{name}.json */
  LOCAL = 'local',
  /** 全局用户状态：XDG 感知的 WISE 状态路径，读取时兜底回退到旧版 ~/.wise/state */
  GLOBAL = 'global'
}

/**
 * 状态操作的配置
 */
export interface StateConfig {
  /** 状态文件名（不含 .json 扩展名） */
  name: string;
  /** 状态存储位置 */
  location: StateLocation;
  /** 目录不存在时是否自动创建 */
  createDirs?: boolean;
  /** 读取时是否检查旧版位置 */
  checkLegacy?: boolean;
}

/**
 * 状态读取操作的结果
 */
export interface StateReadResult<T = unknown> {
  /** 是否找到状态 */
  exists: boolean;
  /** 状态数据（若找到） */
  data?: T;
  /** 状态被找到的位置 */
  foundAt?: string;
  /** 已检查的旧版位置 */
  legacyLocations?: string[];
}

/**
 * 状态写入操作的结果
 */
export interface StateWriteResult {
  /** 写入是否成功 */
  success: boolean;
  /** 状态写入的路径 */
  path: string;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * 状态清除操作的结果
 */
export interface StateClearResult {
  /** 已移除的路径 */
  removed: string[];
  /** 不存在的路径 */
  notFound: string[];
  /** 移除失败的路径 */
  errors: Array<{ path: string; error: string }>;
}

/**
 * 状态迁移操作的结果
 */
export interface StateMigrationResult {
  /** 是否发生了迁移 */
  migrated: boolean;
  /** 源路径（旧版位置） */
  from?: string;
  /** 目标路径（标准位置） */
  to?: string;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * 状态文件信息
 */
export interface StateFileInfo {
  /** 状态名 */
  name: string;
  /** 完整文件路径 */
  path: string;
  /** 位置类型 */
  location: StateLocation;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间戳 */
  modified: Date;
  /** 是否为旧版位置 */
  isLegacy: boolean;
}

/**
 * 列出状态的选项
 */
export interface ListStatesOptions {
  /** 按位置过滤 */
  location?: StateLocation;
  /** 是否包含旧版位置 */
  includeLegacy?: boolean;
  /** 按名称模式（glob）过滤 */
  pattern?: string;
}

/**
 * 清理操作的选项
 */
export interface CleanupOptions {
  /** 孤立状态的最大保留天数 */
  maxAgeDays?: number;
  /** 试运行 - 不实际删除 */
  dryRun?: boolean;
  /** 清理时排除的模式 */
  exclude?: string[];
}

/**
 * 清理操作的结果
 */
export interface CleanupResult {
  /** 已删除的文件 */
  deleted: string[];
  /** 将被删除的文件（试运行） */
  wouldDelete?: string[];
  /** 释放的总空间（字节） */
  spaceFreed: number;
  /** 遇到的错误 */
  errors: Array<{ path: string; error: string }>;
}

/**
 * 通用状态数据结构
 */
export type StateData = Record<string, unknown>;

/**
 * StateLocation 的类型守卫
 */
export function isStateLocation(value: unknown): value is StateLocation {
  return value === StateLocation.LOCAL || value === StateLocation.GLOBAL;
}

/**
 * 默认状态配置
 */
export const DEFAULT_STATE_CONFIG: Partial<StateConfig> = {
  createDirs: true,
  checkLegacy: true
};
