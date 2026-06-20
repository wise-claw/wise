/**
 * 目录 README 注入器常量
 *
 * 用于查找并注入各目录下 README 文件的常量。
 *
 * 移植自 oh-my-opencode 的 directory-readme-injector 钩子。
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

/** directory-readme-injector 状态的存储目录 */
export const WISE_STORAGE_DIR = join(homedir(), '.wise');
export const README_INJECTOR_STORAGE = join(
  WISE_STORAGE_DIR,
  'directory-readme',
);

/** 要查找的 README 文件名 */
export const README_FILENAME = 'README.md';

/** 要查找的 AGENTS.md 文件名（deepinit 产物） */
export const AGENTS_FILENAME = 'AGENTS.md';

/** 目录遍历时要查找的全部上下文文件名 */
export const CONTEXT_FILENAMES = [README_FILENAME, AGENTS_FILENAME];

/** 触发上下文文件注入的工具 */
export const TRACKED_TOOLS = ['read', 'write', 'edit', 'multiedit'];
