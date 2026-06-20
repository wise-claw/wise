/**
 * 已学习技能常量
 */

import { join } from 'path';
import { homedir } from 'os';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { WisePaths } from '../../lib/worktree-paths.js';

/** 用户级技能目录（由 skill-injector.mjs 钩子读取） */
export const USER_SKILLS_DIR = join(getClaudeConfigDir(), 'skills', 'wise-learned');

/** 全局技能目录（新的首选位置：~/.wise/skills） */
export const GLOBAL_SKILLS_DIR = join(homedir(), '.wise', 'skills');

/** 项目级技能子目录 */
export const PROJECT_SKILLS_SUBDIR = WisePaths.SKILLS;

/** 项目级兼容技能子目录（只读兼容来源） */
export const PROJECT_AGENT_SKILLS_SUBDIR = join('.agents', 'skills');

/** 技能文件发现的最大递归深度 */
export const MAX_RECURSION_DEPTH = 10;

/** 有效的技能文件扩展名 */
export const SKILL_EXTENSION = '.md';

/** 启用/禁用的功能开关键名 */
export const FEATURE_FLAG_KEY = 'learner.enabled';

/** 功能开关默认值 */
export const FEATURE_FLAG_DEFAULT = true;

/** 技能内容的最大长度（字符数） */
export const MAX_SKILL_CONTENT_LENGTH = 4000;

/** 自动注入的最低质量分数 */
export const MIN_QUALITY_SCORE = 50;

/** 必需的元数据字段 */
export const REQUIRED_METADATA_FIELDS = ['id', 'name', 'description', 'triggers', 'source'];

/** 每个会话最多注入的技能数 */
export const MAX_SKILLS_PER_SESSION = 10;

/** 是否启用调试模式 */
export const DEBUG_ENABLED = process.env.WISE_DEBUG === '1';
