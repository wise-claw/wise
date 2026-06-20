/**
 * Boulder State 模块
 *
 * 管理 WISE 编排器的活跃工作计划状态。
 * 以 WISE 的 boulder 命名——那必须不断推滚的永恒任务。
 *
 * 移植自 oh-my-opencode 的 boulder-state。
 */

// 类型
export type {
  BoulderState,
  PlanProgress,
  PlanSummary
} from './types.js';

// 常量
export {
  BOULDER_DIR,
  BOULDER_FILE,
  BOULDER_STATE_PATH,
  NOTEPAD_DIR,
  NOTEPAD_BASE_PATH,
  PLANNER_PLANS_DIR,
  PLAN_EXTENSION
} from './constants.js';

// 存储操作
export {
  getBoulderFilePath,
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  clearBoulderState,
  findPlannerPlans,
  getPlanProgress,
  getPlanName,
  createBoulderState,
  getPlanSummaries,
  hasBoulder,
  getActivePlanPath
} from './storage.js';
