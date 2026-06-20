/**
 * 技能查找器
 *
 * 通过混合搜索（用户 + 项目）发现技能文件。
 * 项目技能会覆盖同 ID 的用户技能。
 */

import { existsSync, readdirSync, realpathSync, mkdirSync } from 'fs';
import { join, normalize, sep } from 'path';
import { USER_SKILLS_DIR, PROJECT_SKILLS_SUBDIR, PROJECT_AGENT_SKILLS_SUBDIR, SKILL_EXTENSION, DEBUG_ENABLED, GLOBAL_SKILLS_DIR, MAX_RECURSION_DEPTH } from './constants.js';
import type { SkillFileCandidate } from './types.js';

/**
 * 递归查找目录中的所有技能文件。
 */
function findSkillFilesRecursive(dir: string, results: string[], depth: number = 0): void {
  if (!existsSync(dir)) return;
  if (depth > MAX_RECURSION_DEPTH) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        findSkillFilesRecursive(fullPath, results, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(SKILL_EXTENSION)) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    if (DEBUG_ENABLED) {
      console.error('[learner] Error scanning directory:', error);
    }
  }
}

/**
 * 安全地解析符号链接，失败时兜底。
 */
function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * 检查解析后的路径是否在边界目录内。
 * 用于防止符号链接逃逸。
 */
function isWithinBoundary(realPath: string, boundary: string): boolean {
  const normalizedReal = normalize(realPath);
  const normalizedBoundary = normalize(safeRealpathSync(boundary));
  return normalizedReal === normalizedBoundary ||
         normalizedReal.startsWith(normalizedBoundary + sep);
}

/**
 * 查找指定项目的所有技能文件。
 * 优先返回项目技能（优先级更高），然后是用户技能。
 */
export function findSkillFiles(
  projectRoot: string | null,
  options?: { scope?: 'project' | 'user' | 'all' }
): SkillFileCandidate[] {
  const candidates: SkillFileCandidate[] = [];
  const seenRealPaths = new Set<string>();
  const scope = options?.scope ?? 'all';

  // 1. 搜索项目级技能（若作用域允许）
  if (projectRoot && (scope === 'project' || scope === 'all')) {
    const projectSkillDirs = [
      join(projectRoot, PROJECT_SKILLS_SUBDIR),
      join(projectRoot, PROJECT_AGENT_SKILLS_SUBDIR),
    ];

    for (const projectSkillsDir of projectSkillDirs) {
      const projectFiles: string[] = [];
      findSkillFilesRecursive(projectSkillsDir, projectFiles);

      for (const filePath of projectFiles) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        // 符号链接边界检查
        if (!isWithinBoundary(realPath, projectSkillsDir)) {
          if (DEBUG_ENABLED) {
            console.warn('[learner] Symlink escape blocked:', filePath);
          }
          continue;
        }
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          scope: 'project',
          sourceDir: projectSkillsDir,
        });
      }
    }
  }

  // 2. 从两个目录搜索用户级技能（若作用域允许）
  if (scope === 'user' || scope === 'all') {
    const userDirs = [GLOBAL_SKILLS_DIR, USER_SKILLS_DIR];

    for (const userDir of userDirs) {
      const userFiles: string[] = [];
      findSkillFilesRecursive(userDir, userFiles);

      for (const filePath of userFiles) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        // 符号链接边界检查
        if (!isWithinBoundary(realPath, userDir)) {
          if (DEBUG_ENABLED) {
            console.warn('[learner] Symlink escape blocked:', filePath);
          }
          continue;
        }
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          scope: 'user',
          sourceDir: userDir,
        });
      }
    }
  }

  return candidates;
}

/**
 * 获取指定作用域的技能目录路径。
 */
export function getSkillsDir(scope: 'user' | 'project', projectRoot?: string, sourceDir?: string): string {
  if (sourceDir) return sourceDir;
  if (scope === 'user') {
    return USER_SKILLS_DIR;
  }
  if (!projectRoot) {
    throw new Error('Project root is required for project-scoped skills');
  }
  return join(projectRoot, PROJECT_SKILLS_SUBDIR);
}

/**
 * 确保技能目录存在。
 */
export function ensureSkillsDir(scope: 'user' | 'project', projectRoot?: string): boolean {
  const dir = getSkillsDir(scope, projectRoot);

  if (existsSync(dir)) {
    return true;
  }

  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (error) {
    if (DEBUG_ENABLED) {
      console.error('[learner] Error creating skills directory:', error);
    }
    return false;
  }
}
