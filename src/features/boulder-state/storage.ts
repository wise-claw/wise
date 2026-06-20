/**
 * Boulder State 存储
 *
 * 负责读写 boulder.json 以追踪活跃计划。
 *
 * 移植自 oh-my-opencode 的 boulder-state。
 */

import { readFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { dirname, join, basename } from "path";
import type { BoulderState, PlanProgress, PlanSummary } from "./types.js";
import {
  BOULDER_DIR,
  BOULDER_FILE,
  PLANNER_PLANS_DIR,
  PLAN_EXTENSION,
} from "./constants.js";
import { atomicWriteSync } from "../../lib/atomic-write.js";
import { withFileLockSync } from "../../lib/file-lock.js";

/**
 * 获取 boulder 状态文件的完整路径
 */
export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE);
}

/**
 * 从磁盘读取 boulder 状态
 */
export function readBoulderState(directory: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory);

  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as BoulderState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * 将 boulder 状态写入磁盘
 */
export function writeBoulderState(
  directory: string,
  state: BoulderState,
): boolean {
  const filePath = getBoulderFilePath(directory);

  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });

    atomicWriteSync(filePath, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * 向 boulder 状态追加一个会话 ID
 */
export function appendSessionId(
  directory: string,
  sessionId: string,
): BoulderState | null {
  const filePath = getBoulderFilePath(directory);
  const lockPath = filePath + '.lock';
  return withFileLockSync(lockPath, () => {
    const state = readBoulderState(directory);
    if (!state) return null;

    if (!state.session_ids.includes(sessionId)) {
      state.session_ids.push(sessionId);
      if (writeBoulderState(directory, state)) {
        return state;
      }
    }

    return state;
  });
}

/**
 * 清除 boulder 状态（删除该文件）
 */
export function clearBoulderState(directory: string): boolean {
  const filePath = getBoulderFilePath(directory);

  try {
    unlinkSync(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true; // 已不存在——视为成功
    }
    return false;
  }
}

/**
 * 查找本项目的 Planner 计划文件。
 * Planner 将计划存储于：{project}/.wise/plans/{name}.md
 */
export function findPlannerPlans(directory: string): string[] {
  const plansDir = join(directory, PLANNER_PLANS_DIR);

  try {
    const files = readdirSync(plansDir);
    return files
      .filter((f) => f.endsWith(PLAN_EXTENSION))
      .map((f) => join(plansDir, f))
      .sort((a, b) => {
        // 按修改时间排序，最新的在前
        const aStat = statSync(a);
        const bStat = statSync(b);
        return bStat.mtimeMs - aStat.mtimeMs;
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    return [];
  }
}

/**
 * 解析计划文件并统计复选框进度。
 */
export function getPlanProgress(planPath: string): PlanProgress {
  try {
    const content = readFileSync(planPath, "utf-8");

    // 匹配 markdown 复选框：- [ ] 或 - [x] 或 - [X]
    const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || [];
    const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || [];

    const total = uncheckedMatches.length + checkedMatches.length;
    const completed = checkedMatches.length;

    return {
      total,
      completed,
      isComplete: total === 0 || completed === total,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { total: 0, completed: 0, isComplete: true };
    }
    return { total: 0, completed: 0, isComplete: true };
  }
}

/**
 * 从文件路径中提取计划名称。
 */
export function getPlanName(planPath: string): string {
  return basename(planPath, PLAN_EXTENSION);
}

/**
 * 为某个计划创建新的 boulder 状态。
 */
export function createBoulderState(
  planPath: string,
  sessionId: string,
): BoulderState {
  const now = new Date().toISOString();
  return {
    active_plan: planPath,
    started_at: now,
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
    active: true,
    updatedAt: now,
  };
}

/**
 * 获取所有可用计划的摘要
 */
export function getPlanSummaries(directory: string): PlanSummary[] {
  const plans = findPlannerPlans(directory);

  return plans.map((planPath) => {
    const stat = statSync(planPath);
    return {
      path: planPath,
      name: getPlanName(planPath),
      progress: getPlanProgress(planPath),
      lastModified: new Date(stat.mtimeMs),
    };
  });
}

/**
 * 检查是否当前有活跃的 boulder
 */
export function hasBoulder(directory: string): boolean {
  return readBoulderState(directory) !== null;
}

/**
 * 从 boulder 状态获取活跃计划路径
 */
export function getActivePlanPath(directory: string): string | null {
  const state = readBoulderState(directory);
  return state?.active_plan ?? null;
}
