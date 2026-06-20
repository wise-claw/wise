/**
 * 目录 README 注入器钩子
 *
 * 当文件被访问时，自动注入其所在目录的相关 README 内容。
 * 从被访问文件开始向上遍历目录树，查找并注入 README.md 文件。
 *
 * 移植自 oh-my-opencode 的 directory-readme-injector 钩子。
 * 已适配 Claude Code 的 shell 钩子系统。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
} from './storage.js';
import { CONTEXT_FILENAMES, TRACKED_TOOLS } from './constants.js';

// 重新导出子模块
export * from './types.js';
export * from './constants.js';
export * from './storage.js';

/**
 * 简单的 token 估算（每 4 个字符为 1 个 token）
 */
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_README_TOKENS = 5000;

/**
 * 截断结果
 */
interface TruncationResult {
  result: string;
  truncated: boolean;
}

/**
 * 对 README 内容的简单截断
 */
function truncateContent(
  content: string,
  maxTokens: number = DEFAULT_MAX_README_TOKENS
): TruncationResult {
  const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

  if (estimatedTokens <= maxTokens) {
    return { result: content, truncated: false };
  }

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const truncated = content.slice(0, maxChars);

  return {
    result: truncated,
    truncated: true,
  };
}

/**
 * 为 Claude Code 创建目录 README 注入器钩子。
 *
 * @param workingDirectory - 用于解析路径的工作目录
 * @returns 工具执行用的钩子处理器
 */
export function createDirectoryReadmeInjectorHook(workingDirectory: string) {
  const sessionCaches = new Map<string, Set<string>>();

  function getSessionCache(sessionID: string): Set<string> {
    if (!sessionCaches.has(sessionID)) {
      sessionCaches.set(sessionID, loadInjectedPaths(sessionID));
    }
    return sessionCaches.get(sessionID)!;
  }

  function resolveFilePath(filePath: string): string | null {
    if (!filePath) return null;
    if (isAbsolute(filePath)) return filePath;
    return resolve(workingDirectory, filePath);
  }

  /**
   * 向上遍历目录树查找上下文文件（README.md、AGENTS.md）。
   * 返回路径按从根到叶的顺序排列。
   */
  function findContextFilesUp(startDir: string): string[] {
    const found: string[] = [];
    let current = startDir;

    while (true) {
      for (const filename of CONTEXT_FILENAMES) {
        const filePath = join(current, filename);
        if (existsSync(filePath)) {
          found.push(filePath);
        }
      }

      // 到达工作目录根时停止
      if (current === workingDirectory) break;

      const parent = dirname(current);
      // 到达文件系统根时停止
      if (parent === current) break;
      // 超出工作目录范围时停止
      if (!parent.startsWith(workingDirectory)) break;

      current = parent;
    }

    // 按从根到叶的顺序返回（反转数组）
    return found.reverse();
  }

  /**
   * 获取上下文文件的可读标签。
   */
  function getContextLabel(filePath: string): string {
    if (filePath.endsWith('AGENTS.md')) return 'Project AGENTS';
    return 'Project README';
  }

  /**
   * 处理文件路径并返回要注入的上下文文件内容。
   * 向上遍历目录树查找 README.md 与 AGENTS.md 文件。
   */
  function processFilePathForContextFiles(
    filePath: string,
    sessionID: string
  ): string {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return '';

    const dir = dirname(resolved);
    const cache = getSessionCache(sessionID);
    const contextPaths = findContextFilesUp(dir);

    let output = '';

    for (const contextPath of contextPaths) {
      // 按完整文件路径追踪，以允许同一目录下的 README.md 与 AGENTS.md
      // 被独立注入
      if (cache.has(contextPath)) continue;

      try {
        const content = readFileSync(contextPath, 'utf-8');
        const { result, truncated } = truncateContent(content);

        const truncationNotice = truncated
          ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${contextPath}]`
          : '';

        const label = getContextLabel(contextPath);
        output += `\n\n[${label}: ${contextPath}]\n${result}${truncationNotice}`;
        cache.add(contextPath);
      } catch {
        // 跳过无法读取的文件
      }
    }

    if (output) {
      saveInjectedPaths(sessionID, cache);
    }

    return output;
  }

  return {
    /**
     * 处理工具执行并在相关时注入 README。
     */
    processToolExecution: (
      toolName: string,
      filePath: string,
      sessionID: string
    ): string => {
      if (!TRACKED_TOOLS.includes(toolName.toLowerCase())) {
        return '';
      }

      return processFilePathForContextFiles(filePath, sessionID);
    },

    /**
     * 获取指定文件的上下文文件（README.md、AGENTS.md），不标记为已注入。
     */
    getContextFilesForFile: (filePath: string): string[] => {
      const resolved = resolveFilePath(filePath);
      if (!resolved) return [];

      const dir = dirname(resolved);
      return findContextFilesUp(dir);
    },

    /**
     * @deprecated 请改用 getContextFilesForFile
     */
    getReadmesForFile: (filePath: string): string[] => {
      const resolved = resolveFilePath(filePath);
      if (!resolved) return [];

      const dir = dirname(resolved);
      return findContextFilesUp(dir);
    },

    /**
     * 会话结束时清除会话缓存。
     */
    clearSession: (sessionID: string): void => {
      sessionCaches.delete(sessionID);
      clearInjectedPaths(sessionID);
    },

    /**
     * 检查某工具是否会触发 README 注入。
     */
    isTrackedTool: (toolName: string): boolean => {
      return TRACKED_TOOLS.includes(toolName.toLowerCase());
    },
  };
}

/**
 * 获取某文件的 README 路径（简单的工具函数）。
 */
export function getReadmesForPath(
  filePath: string,
  workingDirectory?: string
): string[] {
  const cwd = workingDirectory || process.cwd();
  const hook = createDirectoryReadmeInjectorHook(cwd);
  return hook.getReadmesForFile(filePath);
}
