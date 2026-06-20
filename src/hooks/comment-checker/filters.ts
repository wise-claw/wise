/**
 * 注释检查器过滤器
 *
 * 用于判断哪些注释应被标记、哪些应被跳过的过滤器。
 *
 * 改编自 oh-my-opencode 的 comment-checker 钩子。
 */

import { BDD_KEYWORDS, TYPE_CHECKER_PREFIXES } from './constants.js';
import type { CommentInfo, FilterResult, CommentFilter } from './types.js';

/**
 * shebang 注释过滤器 (#!/usr/bin/env ...)
 */
export function filterShebangComments(comment: CommentInfo): FilterResult {
  const text = comment.text.trim();
  if (text.startsWith('#!') && comment.lineNumber === 1) {
    return { shouldSkip: true, reason: 'shebang' };
  }
  return { shouldSkip: false };
}

/**
 * BDD（行为驱动开发）注释过滤器
 */
export function filterBddComments(comment: CommentInfo): FilterResult {
  // 不过滤文档字符串
  if (comment.isDocstring) {
    return { shouldSkip: false };
  }

  const text = comment.text.toLowerCase().trim();

  // 检查 BDD 关键字
  for (const keyword of BDD_KEYWORDS) {
    if (text.startsWith(`#${keyword}`) || text.startsWith(`// ${keyword}`)) {
      return { shouldSkip: true, reason: `BDD keyword: ${keyword}` };
    }
    if (text.includes(keyword)) {
      // 更宽松地检查注释中任意位置的关键字
      const words = text.split(/\s+/);
      if (words.some(w => BDD_KEYWORDS.has(w.replace(/[^a-z&]/g, '')))) {
        return { shouldSkip: true, reason: `BDD keyword detected` };
      }
    }
  }

  return { shouldSkip: false };
}

/**
 * 类型检查器与 linter 指令注释过滤器
 */
export function filterDirectiveComments(comment: CommentInfo): FilterResult {
  const text = comment.text.toLowerCase().trim();

  for (const prefix of TYPE_CHECKER_PREFIXES) {
    if (text.includes(prefix.toLowerCase())) {
      return { shouldSkip: true, reason: `directive: ${prefix}` };
    }
  }

  return { shouldSkip: false };
}

/**
 * 非公开函数中的文档字符串注释过滤器
 *（更宽松——仅标记过度的文档字符串）
 */
export function filterDocstringComments(_comment: CommentInfo): FilterResult {
  // 默认不跳过文档字符串——它们应被审查
  // 此过滤器用于可扩展性
  return { shouldSkip: false };
}

/**
 * 版权/许可证头过滤器
 */
export function filterCopyrightComments(comment: CommentInfo): FilterResult {
  const text = comment.text.toLowerCase();
  const copyrightPatterns = [
    'copyright',
    'license',
    'licensed under',
    'spdx-license-identifier',
    'all rights reserved',
    'mit license',
    'apache license',
    'gnu general public',
    'bsd license',
  ];

  for (const pattern of copyrightPatterns) {
    if (text.includes(pattern)) {
      return { shouldSkip: true, reason: 'copyright/license' };
    }
  }

  return { shouldSkip: false };
}

/**
 * TODO/FIXME 注释过滤器（这些是可接受的）
 */
export function filterTodoComments(comment: CommentInfo): FilterResult {
  const text = comment.text.toUpperCase();
  const todoPatterns = ['TODO', 'FIXME', 'HACK', 'XXX', 'NOTE', 'REVIEW'];

  for (const pattern of todoPatterns) {
    if (text.includes(pattern)) {
      return { shouldSkip: true, reason: `todo marker: ${pattern}` };
    }
  }

  return { shouldSkip: false };
}

/**
 * 按应用顺序排列的全部过滤器
 */
const ALL_FILTERS: CommentFilter[] = [
  filterShebangComments,
  filterBddComments,
  filterDirectiveComments,
  filterCopyrightComments,
  filterTodoComments,
  filterDocstringComments,
];

/**
 * 对注释列表应用全部过滤器
 * 仅返回应被标记的注释
 */
export function applyFilters(comments: CommentInfo[]): CommentInfo[] {
  return comments.filter((comment) => {
    for (const filter of ALL_FILTERS) {
      const result = filter(comment);
      if (result.shouldSkip) {
        return false;
      }
    }
    return true;
  });
}
