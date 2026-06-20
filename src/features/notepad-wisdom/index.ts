/**
 * Notepad Wisdom 模块
 *
 * 计划维度的 notepad 系统，用于记录 learnings、decisions、issues、problems。
 * wisdom 文件创建于：.wise/notepads/{plan-name}/
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type { WisdomEntry, WisdomCategory, PlanWisdom } from './types.js';
import { NOTEPAD_BASE_PATH } from '../boulder-state/constants.js';

// 常量
const WISDOM_FILES = {
  learnings: 'learnings.md',
  decisions: 'decisions.md',
  issues: 'issues.md',
  problems: 'problems.md',
} as const;

/**
 * 清理计划名以防止路径穿越
 */
function sanitizePlanName(planName: string): string {
  // 移除路径分隔符与危险字符
  return planName.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * 获取指定计划的 notepad 目录
 */
function getNotepadDir(planName: string, directory: string): string {
  const sanitized = sanitizePlanName(planName);
  return join(directory, NOTEPAD_BASE_PATH, sanitized);
}

/**
 * 获取 wisdom 文件的完整路径
 */
function getWisdomFilePath(
  planName: string,
  category: WisdomCategory,
  directory: string
): string {
  const notepadDir = getNotepadDir(planName, directory);
  return join(notepadDir, WISDOM_FILES[category]);
}

/**
 * 初始化计划的 notepad 目录
 * 创建 .wise/notepads/{plan-name}/ 及 4 个空的 markdown 文件
 */
export function initPlanNotepad(planName: string, directory: string = process.cwd()): boolean {
  const notepadDir = getNotepadDir(planName, directory);

  try {
    // 创建 notepad 目录
    if (!existsSync(notepadDir)) {
      mkdirSync(notepadDir, { recursive: true });
    }

    // 如不存在则创建所有 wisdom 文件
    const categories: WisdomCategory[] = ['learnings', 'decisions', 'issues', 'problems'];

    for (const category of categories) {
      const filePath = getWisdomFilePath(planName, category, directory);

      if (!existsSync(filePath)) {
        const header = `# ${category.charAt(0).toUpperCase() + category.slice(1)} - ${planName}\n\n`;
        writeFileSync(filePath, header, 'utf-8');
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to initialize plan notepad:', error);
    return false;
  }
}

/**
 * 读取指定类别的所有 wisdom 条目
 */
function readWisdomCategory(
  planName: string,
  category: WisdomCategory,
  directory: string
): WisdomEntry[] {
  const filePath = getWisdomFilePath(planName, category, directory);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const entries: WisdomEntry[] = [];

    // 解析格式如下的条目：## YYYY-MM-DD HH:MM:SS\ncontent\n
    const entryRegex = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\n([\s\S]*?)(?=\n## \d{4}-\d{2}-\d{2}|$)/gm;
    let match;

    while ((match = entryRegex.exec(content)) !== null) {
      entries.push({
        timestamp: match[1],
        content: match[2].trim(),
      });
    }

    return entries;
  } catch (error) {
    console.error(`Failed to read ${category}:`, error);
    return [];
  }
}

/**
 * 读取计划 notepad 的所有 wisdom
 * 返回 4 个类别拼接后的 wisdom
 */
export function readPlanWisdom(planName: string, directory: string = process.cwd()): PlanWisdom {
  return {
    planName,
    learnings: readWisdomCategory(planName, 'learnings', directory),
    decisions: readWisdomCategory(planName, 'decisions', directory),
    issues: readWisdomCategory(planName, 'issues', directory),
    problems: readWisdomCategory(planName, 'problems', directory),
  };
}

/**
 * 向 wisdom 类别添加带时间戳的条目
 */
function addWisdomEntry(
  planName: string,
  category: WisdomCategory,
  content: string,
  directory: string
): boolean {
  const filePath = getWisdomFilePath(planName, category, directory);

  // 确保 notepad 已初始化
  if (!existsSync(dirname(filePath))) {
    initPlanNotepad(planName, directory);
  }

  try {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const entry = `\n## ${timestamp}\n\n${content}\n`;

    appendFileSync(filePath, entry, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to add ${category} entry:`, error);
    return false;
  }
}

/**
 * 添加 learning 条目
 */
export function addLearning(
  planName: string,
  content: string,
  directory: string = process.cwd()
): boolean {
  return addWisdomEntry(planName, 'learnings', content, directory);
}

/**
 * 添加 decision 条目
 */
export function addDecision(
  planName: string,
  content: string,
  directory: string = process.cwd()
): boolean {
  return addWisdomEntry(planName, 'decisions', content, directory);
}

/**
 * 添加 issue 条目
 */
export function addIssue(
  planName: string,
  content: string,
  directory: string = process.cwd()
): boolean {
  return addWisdomEntry(planName, 'issues', content, directory);
}

/**
 * 添加 problem 条目
 */
export function addProblem(
  planName: string,
  content: string,
  directory: string = process.cwd()
): boolean {
  return addWisdomEntry(planName, 'problems', content, directory);
}

/**
 * 获取计划所有 wisdom 的格式化字符串
 */
export function getWisdomSummary(planName: string, directory: string = process.cwd()): string {
  const wisdom = readPlanWisdom(planName, directory);
  const sections: string[] = [];

  if (wisdom.learnings.length > 0) {
    sections.push('# Learnings\n\n' + wisdom.learnings.map(e => `- [${e.timestamp}] ${e.content}`).join('\n'));
  }

  if (wisdom.decisions.length > 0) {
    sections.push('# Decisions\n\n' + wisdom.decisions.map(e => `- [${e.timestamp}] ${e.content}`).join('\n'));
  }

  if (wisdom.issues.length > 0) {
    sections.push('# Issues\n\n' + wisdom.issues.map(e => `- [${e.timestamp}] ${e.content}`).join('\n'));
  }

  if (wisdom.problems.length > 0) {
    sections.push('# Problems\n\n' + wisdom.problems.map(e => `- [${e.timestamp}] ${e.content}`).join('\n'));
  }

  return sections.join('\n\n');
}

// 重新导出类型
export type { WisdomEntry, WisdomCategory, PlanWisdom } from './types.js';
