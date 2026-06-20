/**
 * Boulder State 类型
 *
 * 管理 WISE 编排器的活跃工作计划状态。
 * 以 WISE 的 boulder 命名——那必须不断推滚的永恒任务。
 *
 * 移植自 oh-my-opencode 的 boulder-state。
 */

/**
 * 活跃工作计划的状态追踪
 */
export interface BoulderState {
  /** 活跃计划文件的绝对路径 */
  active_plan: string;
  /** 工作开始时的 ISO 时间戳 */
  started_at: string;
  /** 参与过该计划的会话 ID 列表 */
  session_ids: string[];
  /** 从文件名派生的计划名称 */
  plan_name: string;
  /** 该 boulder 当前是否活跃 */
  active: boolean;
  /** 最近一次状态更新的 ISO 时间戳（用于过期检测） */
  updatedAt: string;
  /** 可选的元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 计划复选框的进度追踪
 */
export interface PlanProgress {
  /** 复选框总数 */
  total: number;
  /** 已完成的复选框数量 */
  completed: number;
  /** 是否所有任务都已完成 */
  isComplete: boolean;
}

/**
 * 可用计划的摘要
 */
export interface PlanSummary {
  /** 计划文件路径 */
  path: string;
  /** 计划名称 */
  name: string;
  /** 进度统计 */
  progress: PlanProgress;
  /** 最近修改时间 */
  lastModified: Date;
}
