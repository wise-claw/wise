/**
 * Agents 覆盖层
 *
 * 集成层，在首条代理消息之前将启动上下文（代码库地图、项目提示）
 * 注入 Claude Code 会话。
 *
 * 由 bridge.ts 中的 processSessionStart 调用。
 * Issue #804 - 启动代码库地图注入钩子
 */

import { generateCodebaseMap, type CodebaseMapOptions } from './codebase-map.js';
import { loadConfig } from '../config/loader.js';

export interface AgentsOverlayResult {
  /** 待前置的上下文消息，若无内容可注入则为空字符串 */
  message: string;
  /** 是否包含代码库地图 */
  hasCodebaseMap: boolean;
}

/**
 * 为会话构建启动覆盖层上下文。
 *
 * 生成压缩的代码库地图并格式化为 session-restore 块。
 * 禁用或目录不存在时返回空结果。
 */
export function buildAgentsOverlay(
  directory: string,
  options?: CodebaseMapOptions,
): AgentsOverlayResult {
  const config = loadConfig();
  const mapConfig = config.startupCodebaseMap ?? {};

  // 遵循 enabled 标志（默认：true）
  if (mapConfig.enabled === false) {
    return { message: '', hasCodebaseMap: false };
  }

  const mergedOptions: CodebaseMapOptions = {
    maxFiles: mapConfig.maxFiles ?? options?.maxFiles ?? 200,
    maxDepth: mapConfig.maxDepth ?? options?.maxDepth ?? 4,
    ignorePatterns: options?.ignorePatterns ?? [],
    includeMetadata: options?.includeMetadata ?? true,
  };

  const result = generateCodebaseMap(directory, mergedOptions);

  if (!result.map) {
    return { message: '', hasCodebaseMap: false };
  }

  const message = `<session-restore>

[CODEBASE MAP]

Project structure for: ${directory}
Use this map to navigate efficiently. Prefer Glob/Grep over blind file exploration.

${result.map}

</session-restore>

---

`;

  return { message, hasCodebaseMap: true };
}
