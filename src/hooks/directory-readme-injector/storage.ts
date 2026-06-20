/**
 * 目录 README 注入器存储
 *
 * 持久化存储，用于按会话追踪已注入的目录 README。
 *
 * 移植自 oh-my-opencode 的 directory-readme-injector 钩子。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { README_INJECTOR_STORAGE } from './constants.js';
import type { InjectedPathsData } from './types.js';

/**
 * 获取指定会话的存储文件路径。
 */
function getStoragePath(sessionID: string): string {
  return join(README_INJECTOR_STORAGE, `${sessionID}.json`);
}

/**
 * 加载指定会话已注入的目录路径集合。
 */
export function loadInjectedPaths(sessionID: string): Set<string> {
  const filePath = getStoragePath(sessionID);
  if (!existsSync(filePath)) return new Set();

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data: InjectedPathsData = JSON.parse(content);
    return new Set(data.injectedPaths);
  } catch {
    return new Set();
  }
}

/**
 * 保存指定会话已注入的目录路径集合。
 */
export function saveInjectedPaths(sessionID: string, paths: Set<string>): void {
  if (!existsSync(README_INJECTOR_STORAGE)) {
    mkdirSync(README_INJECTOR_STORAGE, { recursive: true });
  }

  const data: InjectedPathsData = {
    sessionID,
    injectedPaths: Array.from(paths),
    updatedAt: Date.now(),
  };

  writeFileSync(getStoragePath(sessionID), JSON.stringify(data, null, 2));
}

/**
 * 清除指定会话的已注入路径。
 */
export function clearInjectedPaths(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
