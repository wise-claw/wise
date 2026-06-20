/**
 * Code Simplifier Stop 钩子
 *
 * 拦截 Stop 事件，自动把最近修改的文件委派给
 * code-simplifier agent 做清理与简化。
 *
 * 通过全局 WISE config.json 显式开启（Linux/Unix 下感知 XDG，旧版回退 ~/.wise）
 * 默认：禁用（仅 opt-in）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { getGlobalWiseConfigCandidates } from '../../utils/paths.js';

/** code-simplifier 特性的配置形态 */
export interface CodeSimplifierConfig {
  enabled: boolean;
  /** 纳入的文件扩展名（默认：常见源码扩展名） */
  extensions?: string[];
  /** 每次 stop 事件最多简化的文件数（默认：10） */
  maxFiles?: number;
}

/** 全局 WISE 配置形态（与 code-simplifier 相关的子集） */
interface WiseGlobalConfig {
  codeSimplifier?: CodeSimplifierConfig;
}

/** 返回给 Stop 钩子派发器的结果 */
export interface CodeSimplifierHookResult {
  shouldBlock: boolean;
  message: string;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
const DEFAULT_MAX_FILES = 10;

/** 用于防止在同一轮次内重复触发的标记文件名 */
export const TRIGGER_MARKER_FILENAME = 'code-simplifier-triggered.marker';

/**
 * 从感知 XDG 的位置读取全局 WISE 配置，并回退到旧版
 * ~/.wise/config.json 以保持向后兼容。
 * 文件不存在或无法解析时返回 null。
 */
export function readWiseConfig(): WiseGlobalConfig | null {
  for (const configPath of getGlobalWiseConfigCandidates('config.json')) {
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as WiseGlobalConfig;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 检查 config 中是否启用了 code-simplifier 特性。
 * 默认禁用 —— 需要显式 opt-in。
 */
export function isCodeSimplifierEnabled(): boolean {
  const config = readWiseConfig();
  return config?.codeSimplifier?.enabled === true;
}

/**
 * 通过 `git diff HEAD --name-only` 获取最近修改的源码文件列表。
 * git 不可用或无文件被修改时返回空数组。
 */
export function getModifiedFiles(
  cwd: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
  maxFiles: number = DEFAULT_MAX_FILES,
): string[] {
  try {
    const output = execSync('git diff HEAD --name-only', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });

    return output
      .trim()
      .split('\n')
      .filter((file) => file.trim().length > 0)
      .filter((file) => extensions.some((ext) => file.endsWith(ext)))
      .slice(0, maxFiles);
  } catch {
    return [];
  }
}

/**
 * 检查本轮 code-simplifier 是否已被触发过
 *（state 目录中存在标记文件）。
 */
export function isAlreadyTriggered(stateDir: string): boolean {
  return existsSync(join(stateDir, TRIGGER_MARKER_FILENAME));
}

/**
 * 写入触发标记，防止在同一轮次内重复触发。
 */
export function writeTriggerMarker(stateDir: string): void {
  try {
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(join(stateDir, TRIGGER_MARKER_FILENAME), new Date().toISOString(), 'utf-8');
  } catch {
    // 忽略写入错误 —— 标记是尽力而为的
  }
}

/**
 * 在一轮简化完成后清除触发标记，
 * 使钩子能在下一轮再次触发。
 */
export function clearTriggerMarker(stateDir: string): void {
  try {
    const markerPath = join(stateDir, TRIGGER_MARKER_FILENAME);
    if (existsSync(markerPath)) {
      unlinkSync(markerPath);
    }
  } catch {
    // 忽略删除错误
  }
}

/**
 * 构建当 code-simplifier 触发时注入到 Claude 上下文中的消息。
 */
export function buildSimplifierMessage(files: string[]): string {
  const fileList = files.map((f) => `  - ${f}`).join('\n');
  const fileArgs = files.join('\\n');

  return `[CODE SIMPLIFIER] Recently modified files detected. Delegate to the code-simplifier agent to simplify the following files for clarity, consistency, and maintainability (without changing behavior):

${fileList}

Use: Task(subagent_type="wise:code-simplifier", prompt="Simplify the recently modified files:\\n${fileArgs}")`;
}

/**
 * 处理 code-simplifier stop 钩子。
 *
 * 逻辑：
 * 1. 若特性被禁用则提前返回（不阻断）
 * 2. 若本轮已触发过（存在标记），清除标记并允许 stop
 * 3. 通过 git diff HEAD 获取修改的文件
 * 4. 若无相关文件被修改则提前返回
 * 5. 写入触发标记并注入 simplifier 委派消息
 */
export function processCodeSimplifier(
  cwd: string,
  stateDir: string,
): CodeSimplifierHookResult {
  if (!isCodeSimplifierEnabled()) {
    return { shouldBlock: false, message: '' };
  }

  // 若本轮已触发过，清除标记并允许 stop
  if (isAlreadyTriggered(stateDir)) {
    clearTriggerMarker(stateDir);
    return { shouldBlock: false, message: '' };
  }

  const config = readWiseConfig();
  const extensions = config?.codeSimplifier?.extensions ?? DEFAULT_EXTENSIONS;
  const maxFiles = config?.codeSimplifier?.maxFiles ?? DEFAULT_MAX_FILES;
  const files = getModifiedFiles(cwd, extensions, maxFiles);

  if (files.length === 0) {
    return { shouldBlock: false, message: '' };
  }

  writeTriggerMarker(stateDir);

  return {
    shouldBlock: true,
    message: buildSimplifierMessage(files),
  };
}
