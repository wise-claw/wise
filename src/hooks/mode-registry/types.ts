/**
 * 模式注册表类型
 *
 * 定义支持的执行模式及其状态文件位置。
 */

export type ExecutionMode =
  | 'autopilot'
  | 'autoresearch'
  | 'team'
  | 'ralph'
  | 'ultrawork'
  | 'ultraqa'
  | 'deep-interview'
  | 'self-improve';

export interface ModeConfig {
  /** 模式的显示名称 */
  name: string;
  /** 主状态文件路径（相对于 .wise/state/） */
  stateFile: string;
  /** 备用/标记文件路径（相对于 .wise/state/） */
  markerFile?: string;
  /** 在 JSON 状态中检查的属性（若基于 JSON） */
  activeProperty?: string;
  /** 状态是否基于 SQLite（需要标记文件） */
  isSqlite?: boolean;
  /** 模式是否在 ~/.claude/ 中存在全局状态 */
  hasGlobalState?: boolean;
}

export interface ModeStatus {
  mode: ExecutionMode;
  active: boolean;
  stateFilePath: string;
}

export interface CanStartResult {
  allowed: boolean;
  blockedBy?: ExecutionMode;
  message?: string;
}
