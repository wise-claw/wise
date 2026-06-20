/**
 * Notepad 支持
 *
 * 基于 notepad.md 格式实现抗压缩的内存持久化。
 * 提供三层内存系统：
 * 1. Priority Context - 始终加载，关键发现（最多 500 字符）
 * 2. Working Memory - 会话笔记，7 天后自动清理
 * 3. MANUAL - 用户内容，从不自动清理
 *
 * 结构：
 * ```markdown
 * # Notepad
 * <!-- Auto-managed by WISE. Manual edits preserved in MANUAL section. -->
 *
 * ## Priority Context
 * <!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->
 *
 * ## Working Memory
 * <!-- Session notes. Auto-pruned after 7 days. -->
 *
 * ## MANUAL
 * <!-- User content. Never auto-pruned. -->
 * ```
 */

import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getWiseRoot } from "../../lib/worktree-paths.js";
import { atomicWriteFileSync } from "../../lib/atomic-write.js";
import { lockPathFor, withFileLockSync } from "../../lib/file-lock.js";

// ============================================================================
// 类型
// ============================================================================

export interface NotepadConfig {
  /** Priority Context 分区的最大字符数 */
  priorityMaxChars: number;
  /** 清理前保留 Working Memory 条目的天数 */
  workingMemoryDays: number;
  /** 最大文件总大小（字节） */
  maxTotalSize: number;
}

export interface NotepadStats {
  /** notepad.md 是否存在 */
  exists: boolean;
  /** 文件总大小（字节） */
  totalSize: number;
  /** Priority Context 分区大小（字节） */
  prioritySize: number;
  /** Working Memory 条目数 */
  workingMemoryEntries: number;
  /** 最旧 Working Memory 条目的 ISO 时间戳 */
  oldestEntry: string | null;
}

export interface PriorityContextResult {
  /** 操作是否成功 */
  success: boolean;
  /** 内容超限时的警告消息 */
  warning?: string;
}

export interface PruneResult {
  /** 已清理的条目数 */
  pruned: number;
  /** 剩余条目数 */
  remaining: number;
}

// ============================================================================
// 常量
// ============================================================================

export const NOTEPAD_FILENAME = "notepad.md";

export const DEFAULT_CONFIG: NotepadConfig = {
  priorityMaxChars: 500,
  workingMemoryDays: 7,
  maxTotalSize: 8192, // 8KB
};

export const PRIORITY_HEADER = "## Priority Context";
export const WORKING_MEMORY_HEADER = "## Working Memory";
export const MANUAL_HEADER = "## MANUAL";

interface SectionRegexSet {
  extract: RegExp;
  replace: RegExp;
  comment: RegExp;
}

const SECTION_REGEXES: Record<string, SectionRegexSet> = {
  [PRIORITY_HEADER]: createSectionRegexSet(PRIORITY_HEADER),
  [WORKING_MEMORY_HEADER]: createSectionRegexSet(WORKING_MEMORY_HEADER),
  [MANUAL_HEADER]: createSectionRegexSet(MANUAL_HEADER),
};

function createSectionRegexSet(header: string): SectionRegexSet {
  return {
    extract: new RegExp(`${header}\\n([\\s\\S]*?)(?=\\n## [^#]|$)`),
    replace: new RegExp(`(${header}\\n)([\\s\\S]*?)(?=## |$)`),
    comment: new RegExp(`${header}\\n(<!--[\\s\\S]*?-->)`),
  };
}

function getSectionRegexSet(header: string): SectionRegexSet {
  return SECTION_REGEXES[header] ?? createSectionRegexSet(header);
}

// ============================================================================
// 文件操作
// ============================================================================

/**
 * 获取 .wise 子目录下的 notepad.md 路径
 */
export function getNotepadPath(directory: string): string {
  return join(getWiseRoot(directory), NOTEPAD_FILENAME);
}

/**
 * 若 notepad.md 不存在则初始化
 */
export function initNotepad(directory: string): boolean {
  const wiseDir = getWiseRoot(directory);
  if (!existsSync(wiseDir)) {
    try {
      mkdirSync(wiseDir, { recursive: true });
    } catch {
      return false;
    }
  }

  const notepadPath = getNotepadPath(directory);
  if (existsSync(notepadPath)) {
    return true; // 已存在
  }

  const content = `# Notepad
<!-- Auto-managed by WISE. Manual edits preserved in MANUAL section. -->

${PRIORITY_HEADER}
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->

${WORKING_MEMORY_HEADER}
<!-- Session notes. Auto-pruned after 7 days. -->

${MANUAL_HEADER}
<!-- User content. Never auto-pruned. -->

`;

  try {
    atomicWriteFileSync(notepadPath, content);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取整个 notepad 内容
 */
export function readNotepad(directory: string): string | null {
  const notepadPath = getNotepadPath(directory);
  if (!existsSync(notepadPath)) {
    return null;
  }

  try {
    return readFileSync(notepadPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 使用正则从 notepad 内容中提取分区
 */
function extractSection(content: string, header: string): string | null {
  // 从标题匹配到下一分区（## 后跟空格，位于行首）
  // 需要匹配行首的 ##，而非作为子分区的 ###
  const match = content.match(getSectionRegexSet(header).extract);
  if (!match) {
    return null;
  }

  // 清理内容 - 移除 HTML 注释并 trim
  let section = match[1];
  section = section.replace(/<!--[\s\S]*?-->/g, "").trim();

  return section || null;
}

/**
 * 替换 notepad 内容中的某个分区
 */
function replaceSection(
  content: string,
  header: string,
  newContent: string,
): string {
  const { replace, comment: commentPattern } = getSectionRegexSet(header);

  // 若存在注释则保留
  const commentMatch = content.match(commentPattern);
  const preservedComment = commentMatch ? commentMatch[1] + "\n" : "";

  return content.replace(replace, `$1${preservedComment}${newContent}\n\n`);
}

// ============================================================================
// 分区访问
// ============================================================================

/**
 * 仅获取 Priority Context 分区（用于注入）
 */
export function getPriorityContext(directory: string): string | null {
  const content = readNotepad(directory);
  if (!content) {
    return null;
  }

  return extractSection(content, PRIORITY_HEADER);
}

/**
 * 获取 Working Memory 分区
 */
export function getWorkingMemory(directory: string): string | null {
  const content = readNotepad(directory);
  if (!content) {
    return null;
  }

  return extractSection(content, WORKING_MEMORY_HEADER);
}

/**
 * 获取 MANUAL 分区
 */
export function getManualSection(directory: string): string | null {
  const content = readNotepad(directory);
  if (!content) {
    return null;
  }

  return extractSection(content, MANUAL_HEADER);
}

// ============================================================================
// 分区更新
// ============================================================================

/**
 * 新增/更新 Priority Context（替换内容，超限时发出警告）
 */
export function setPriorityContext(
  directory: string,
  content: string,
  config: NotepadConfig = DEFAULT_CONFIG,
): PriorityContextResult {
  // 需要时初始化
  if (!existsSync(getNotepadPath(directory))) {
    if (!initNotepad(directory)) {
      return { success: false };
    }
  }

  const notepadPath = getNotepadPath(directory);

  try {
    return withFileLockSync(lockPathFor(notepadPath), () => {
      let notepadContent = readFileSync(notepadPath, "utf-8");

      // 检查大小
      const warning =
        content.length > config.priorityMaxChars
          ? `Priority Context exceeds ${config.priorityMaxChars} chars (${content.length} chars). Consider condensing.`
          : undefined;

      // 替换该分区
      notepadContent = replaceSection(notepadContent, PRIORITY_HEADER, content);

      atomicWriteFileSync(notepadPath, notepadContent);
      return { success: true, warning } as PriorityContextResult;
    }, { timeoutMs: 5000 });
  } catch {
    return { success: false };
  }
}

/**
 * 向 Working Memory 添加带时间戳的条目
 */
export function addWorkingMemoryEntry(
  directory: string,
  content: string,
): boolean {
  // 需要时初始化
  if (!existsSync(getNotepadPath(directory))) {
    if (!initNotepad(directory)) {
      return false;
    }
  }

  const notepadPath = getNotepadPath(directory);

  try {
    return withFileLockSync(lockPathFor(notepadPath), () => {
      let notepadContent = readFileSync(notepadPath, "utf-8");

      // 获取当前 Working Memory 内容
      const currentMemory =
        extractSection(notepadContent, WORKING_MEMORY_HEADER) || "";

      // 格式化时间戳
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM

      // 添加新条目
      const newEntry = `### ${timestamp}\n${content}\n`;
      const updatedMemory = currentMemory
        ? currentMemory + "\n" + newEntry
        : newEntry;

      // 替换该分区
      notepadContent = replaceSection(
        notepadContent,
        WORKING_MEMORY_HEADER,
        updatedMemory,
      );

      atomicWriteFileSync(notepadPath, notepadContent);
      return true;
    }, { timeoutMs: 5000 });
  } catch {
    return false;
  }
}

/**
 * 添加到 MANUAL 分区
 */
export function addManualEntry(directory: string, content: string): boolean {
  // 需要时初始化
  if (!existsSync(getNotepadPath(directory))) {
    if (!initNotepad(directory)) {
      return false;
    }
  }

  const notepadPath = getNotepadPath(directory);

  try {
    return withFileLockSync(lockPathFor(notepadPath), () => {
      let notepadContent = readFileSync(notepadPath, "utf-8");

      // 获取当前 MANUAL 内容
      const currentManual = extractSection(notepadContent, MANUAL_HEADER) || "";

      // 添加带时间戳的新条目
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM
      const newEntry = `### ${timestamp}\n${content}\n`;
      const updatedManual = currentManual
        ? currentManual + "\n" + newEntry
        : newEntry;

      // 替换该分区
      notepadContent = replaceSection(notepadContent, MANUAL_HEADER, updatedManual);

      atomicWriteFileSync(notepadPath, notepadContent);
      return true;
    }, { timeoutMs: 5000 });
  } catch {
    return false;
  }
}

// ============================================================================
// 清理
// ============================================================================

/**
 * 清理超过 N 天的 Working Memory 条目
 */
export function pruneOldEntries(
  directory: string,
  daysOld: number = DEFAULT_CONFIG.workingMemoryDays,
): PruneResult {
  const notepadPath = getNotepadPath(directory);
  if (!existsSync(notepadPath)) {
    return { pruned: 0, remaining: 0 };
  }

  try {
    return withFileLockSync(lockPathFor(notepadPath), () => {
      let notepadContent = readFileSync(notepadPath, "utf-8");
      const workingMemory = extractSection(notepadContent, WORKING_MEMORY_HEADER);

      if (!workingMemory) {
        return { pruned: 0, remaining: 0 } as PruneResult;
      }

      // 解析条目
      const entryRegex =
        /### (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\n([\s\S]*?)(?=### |$)/g;
      const entries: Array<{ timestamp: string; content: string }> = [];
      let match: RegExpExecArray | null = entryRegex.exec(workingMemory);

      while (match !== null) {
        entries.push({
          timestamp: match[1],
          content: match[2].trim(),
        });
        match = entryRegex.exec(workingMemory);
      }

      // 计算截止日期
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysOld);

      // 过滤条目
      const kept = entries.filter((entry) => {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= cutoff;
      });

      const pruned = entries.length - kept.length;

      // 重建 Working Memory 分区
      const newContent = kept
        .map((entry) => `### ${entry.timestamp}\n${entry.content}`)
        .join("\n\n");

      notepadContent = replaceSection(
        notepadContent,
        WORKING_MEMORY_HEADER,
        newContent,
      );

      atomicWriteFileSync(notepadPath, notepadContent);
      return { pruned, remaining: kept.length } as PruneResult;
    }, { timeoutMs: 5000 });
  } catch {
    return { pruned: 0, remaining: 0 };
  }
}

// ============================================================================
// 统计信息
// ============================================================================

/**
 * 获取 notepad 统计信息
 */
export function getNotepadStats(directory: string): NotepadStats {
  const notepadPath = getNotepadPath(directory);

  if (!existsSync(notepadPath)) {
    return {
      exists: false,
      totalSize: 0,
      prioritySize: 0,
      workingMemoryEntries: 0,
      oldestEntry: null,
    };
  }

  const content = readFileSync(notepadPath, "utf-8");
  const priorityContext = extractSection(content, PRIORITY_HEADER) || "";
  const workingMemory = extractSection(content, WORKING_MEMORY_HEADER) || "";

  // 统计条目数 — 同时支持旧版 ### 和新版 HTML 注释分隔符格式
  const wmMatches = workingMemory.match(
    /<\!-- WM:\d{4}-\d{2}-\d{2} \d{2}:\d{2} -->/g,
  );
  const legacyMatches = workingMemory.match(/### \d{4}-\d{2}-\d{2} \d{2}:\d{2}/g);
  const entryMatches = wmMatches ?? legacyMatches;
  const entryCount = entryMatches ? entryMatches.length : 0;

  // 查找最旧条目
  let oldestEntry: string | null = null;
  if (entryMatches && entryMatches.length > 0) {
    // 仅提取时间戳部分
    const timestamps = entryMatches.map((m) =>
      m.startsWith("<!--") ? m.replace(/^<\!-- WM:| -->$/g, "") : m.replace("### ", "")
    );
    timestamps.sort();
    oldestEntry = timestamps[0];
  }

  return {
    exists: true,
    totalSize: Buffer.byteLength(content, "utf-8"),
    prioritySize: Buffer.byteLength(priorityContext, "utf-8"),
    workingMemoryEntries: entryCount,
    oldestEntry,
  };
}

// ============================================================================
// 上下文格式化
// ============================================================================

/**
 * 格式化上下文以注入会话
 */
export function formatNotepadContext(directory: string): string | null {
  const notepadPath = getNotepadPath(directory);
  if (!existsSync(notepadPath)) {
    return null;
  }

  const priorityContext = getPriorityContext(directory);

  if (!priorityContext) {
    return null;
  }

  const lines = [
    "<notepad-priority>",
    "",
    "## Priority Context",
    "",
    priorityContext,
    "",
    "</notepad-priority>",
    "",
  ];

  return lines.join("\n");
}

/**
 * 格式化完整 notepad 以供展示
 */
export function formatFullNotepad(directory: string): string | null {
  const content = readNotepad(directory);
  if (!content) {
    return null;
  }

  return content;
}
