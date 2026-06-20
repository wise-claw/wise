/**
 * Boulder State 常量
 *
 * 移植自 oh-my-opencode 的 boulder-state。
 */

import { WisePaths } from '../../lib/worktree-paths.js';

/** WISE 状态目录 */
export const BOULDER_DIR = WisePaths.ROOT;

/** Boulder 状态文件名 */
export const BOULDER_FILE = 'boulder.json';

/** boulder 状态的完整路径模式 */
export const BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`;

/** learnings 的 notepad 目录 */
export const NOTEPAD_DIR = 'notepads';

/** notepads 的完整路径 */
export const NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`;

/** Planner 计划目录 */
export const PLANNER_PLANS_DIR = WisePaths.PLANS;

/** 计划文件扩展名 */
export const PLAN_EXTENSION = '.md';
