/**
 * Deepinit 清单工具
 *
 * 用于增量 /deepinit 的确定性代码级清单系统。
 * 跟踪目录文件列表，使后续运行仅为结构实际发生变化的目录重新生成 AGENTS.md。
 *
 * 操作：
 * - diff：将当前文件系统与已保存的清单进行比较
 * - save：将当前文件系统状态写入清单
 * - check：返回清单是否存在且有效
 *
 * @see https://github.com/wise-claw/wise/issues/1719
 */

import { z } from 'zod';
import { readdirSync, statSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { validateWorkingDirectory, getWiseRoot } from '../lib/worktree-paths.js';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import { TOOL_CATEGORIES } from '../constants/names.js';
import type { ToolDefinition } from './types.js';

// =============================================================================
// 常量
// =============================================================================

const MANIFEST_VERSION = 1;

/** 最大递归深度，防止栈溢出 */
const MAX_DEPTH = 50;

/** 最大扫描目录数，防止内存耗尽 */
const MAX_DIRECTORIES = 10_000;

/** 按名称精确匹配排除的目录 */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', '__pycache__',
  'coverage', '.next', '.nuxt',
]);

// =============================================================================
// 类型
// =============================================================================

/** 单个目录的已排序文件列表 */
interface DirectoryEntry {
  readonly files: readonly string[];
}

/** 持久化的清单结构 */
interface DeepInitManifest {
  readonly version: 1;
  readonly generatedAt: string;
  readonly directories: Readonly<Record<string, DirectoryEntry>>;
}

/** 目录的变更状态 */
type ChangeStatus = 'added' | 'deleted' | 'modified' | 'unchanged';

/** 单个目录的差异结果 */
interface DiffEntry {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly reason?: string;
}

/** 完整差异结果 */
interface DiffResult {
  readonly entries: readonly DiffEntry[];
  readonly summary: {
    readonly total: number;
    readonly added: number;
    readonly deleted: number;
    readonly modified: number;
    readonly unchanged: number;
  };
}

// =============================================================================
// Schema
// =============================================================================

const deepinitManifestSchema = {
  action: z.enum(['diff', 'save', 'check']).describe(
    'Action: diff (compare current filesystem to saved manifest — compares directory file lists, not file contents), ' +
    'save (write current filesystem state as manifest), ' +
    'check (return whether manifest exists and is valid)'
  ),
  workingDirectory: z.string().optional().describe(
    'Project root directory. Auto-detected from git worktree if omitted.'
  ),
  mode: z.enum(['incremental', 'full']).optional().default('incremental').describe(
    'Only valid with action=diff. incremental (default) returns only changed dirs, full returns all dirs as added.'
  ),
  dryRun: z.boolean().optional().default(false).describe(
    'Only valid with action=save. If true, return what would be saved without writing.'
  ),
};

type DeepinitManifestInput = z.infer<z.ZodObject<typeof deepinitManifestSchema>>;

// =============================================================================
// 核心函数（导出供测试使用）
// =============================================================================

/**
 * 如果目录名应被排除扫描则返回 true。
 * 排除所有隐藏目录（以 '.' 开头）以及已知的构建/依赖目录。
 */
export function isExcluded(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name);
}

/**
 * 递归扫描项目目录并构建目录 → 文件列表的记录。
 * - 通过 isExcluded() 跳过被排除的目录
 * - 跳过空目录（无文件）
 * - 使用 inode 跟踪以防止符号链接环路
 * - 文件列表按字母顺序排序以保证比较的确定性
 * - 所有路径统一使用 '/' 分隔符，与平台无关
 *
 * @param projectRoot 项目根目录的绝对路径
 * @returns 以相对路径为键（根目录用 '.'）的记录，值为 DirectoryEntry
 */
export function scanDirectories(projectRoot: string): Record<string, DirectoryEntry> {
  const result: Record<string, DirectoryEntry> = {};
  const visitedInodes = new Set<number>();

  // 解析真实项目根目录，用于符号链接包含性检查
  let realProjectRoot: string;
  try {
    realProjectRoot = realpathSync(projectRoot);
  } catch {
    realProjectRoot = projectRoot;
  }

  let dirCount = 0;

  function walk(absDir: string, depth: number): void {
    // 防止深度或目录数过大
    if (depth > MAX_DEPTH || dirCount > MAX_DIRECTORIES) return;

    // 符号链接包含性校验：确认解析后的路径位于项目根目录之下
    try {
      const realDir = realpathSync(absDir);
      if (realDir !== realProjectRoot && !realDir.startsWith(realProjectRoot + sep)) {
        return; // 符号链接逃逸出项目根目录 — 跳过
      }
    } catch {
      return; // 跳过无法访问的目录
    }

    // 通过 inode 跟踪防止符号链接环路
    try {
      const stat = statSync(absDir);
      if (visitedInodes.has(stat.ino)) return;
      visitedInodes.add(stat.ino);
    } catch {
      return; // 跳过无法访问的目录
    }

    dirCount++;

    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // 跳过不可读的目录
    }

    const files: string[] = [];
    const subdirs: string[] = [];

    for (const entry of entries) {
      // 跳过符号链接，防止逃逸和信息泄露
      if (entry.isSymbolicLink()) continue;

      if (entry.isFile()) {
        files.push(entry.name);
      } else if (entry.isDirectory() && !isExcluded(entry.name)) {
        subdirs.push(entry.name);
      }
    }

    // 仅跟踪包含文件的目录
    if (files.length > 0) {
      const relPath = relative(projectRoot, absDir).split(sep).join('/') || '.';
      result[relPath] = { files: [...files].sort() };
    }

    // 递归进入子目录
    for (const sub of subdirs) {
      walk(join(absDir, sub), depth + 1);
    }
  }

  walk(projectRoot, 0);
  return result;
}

/**
 * 加载并解析清单文件。
 * 文件不存在、不可读、JSON 解析失败或版本不兼容时返回 null。
 */
export function loadManifest(manifestPath: string): DeepInitManifest | null {
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed.version !== MANIFEST_VERSION) return null;
    if (typeof parsed.directories !== 'object' || parsed.directories === null) return null;

    return parsed as unknown as DeepInitManifest;
  } catch {
    return null;
  }
}

/**
 * 计算前一个清单状态与当前目录树之间的差异。
 * - 如果 previous 为 null，则所有当前目录均为 'added'（首次运行）
 * - 应用祖先级联：当子目录被新增/删除时，所有祖先目录都标记为 'modified'（以更新其 Subdirectories 表）
 *
 * @param previous 前一个目录状态（null = 首次运行）
 * @param current 来自 scanDirectories() 的当前目录状态
 * @returns DiffResult，条目按路径排序
 */
export function computeDiff(
  previous: Readonly<Record<string, DirectoryEntry>> | null,
  current: Readonly<Record<string, DirectoryEntry>>,
): DiffResult {
  const entries = new Map<string, DiffEntry>();

  if (previous === null) {
    // 首次运行：全部视为 added
    for (const path of Object.keys(current)) {
      entries.set(path, { path, status: 'added', reason: 'first run (no manifest)' });
    }
  } else {
    // 将当前目录与 previous 进行对比
    for (const [path, entry] of Object.entries(current)) {
      const prev = previous[path];
      if (!prev) {
        entries.set(path, { path, status: 'added', reason: 'new directory' });
      } else {
        const prevFiles = [...prev.files].sort();
        const currFiles = [...entry.files].sort();

        if (prevFiles.length !== currFiles.length || prevFiles.some((f, i) => f !== currFiles[i])) {
          // 使用 Set 计算变更，复杂度为 O(n+m) 而非 O(n*m)
          const prevSet = new Set(prevFiles);
          const currSet = new Set(currFiles);
          const added = currFiles.filter(f => !prevSet.has(f));
          const removed = prevFiles.filter(f => !currSet.has(f));
          const parts: string[] = [];
          if (added.length > 0) parts.push(`files added: ${added.join(', ')}`);
          if (removed.length > 0) parts.push(`files removed: ${removed.join(', ')}`);
          entries.set(path, { path, status: 'modified', reason: parts.join('; ') });
        } else {
          entries.set(path, { path, status: 'unchanged' });
        }
      }
    }

    // 检查被删除的目录
    for (const path of Object.keys(previous)) {
      if (!(path in current)) {
        entries.set(path, { path, status: 'deleted', reason: 'directory no longer exists' });
      }
    }
  }

  // 祖先级联：将被新增/删除目录的父目录标记为 modified
  const cascadeTargets = [...entries.values()]
    .filter(e => e.status === 'added' || e.status === 'deleted');

  for (const target of cascadeTargets) {
    const parts = target.path.split('/');
    // 从父目录逐级向上走到根目录
    for (let i = parts.length - 1; i > 0; i--) {
      const ancestor = parts.slice(0, i).join('/');
      const existing = entries.get(ancestor);
      if (existing && existing.status === 'unchanged') {
        entries.set(ancestor, {
          path: ancestor,
          status: 'modified',
          reason: `child directory ${target.status}: ${target.path}`,
        });
      }
    }
    // 处理根目录（'.'）
    if (target.path !== '.') {
      const rootEntry = entries.get('.');
      if (rootEntry && rootEntry.status === 'unchanged') {
        entries.set('.', {
          path: '.',
          status: 'modified',
          reason: `child directory ${target.status}: ${target.path}`,
        });
      }
    }
  }

  // 按路径排序并构建结果
  const sorted = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  const summary = {
    total: sorted.length,
    added: sorted.filter(e => e.status === 'added').length,
    deleted: sorted.filter(e => e.status === 'deleted').length,
    modified: sorted.filter(e => e.status === 'modified').length,
    unchanged: sorted.filter(e => e.status === 'unchanged').length,
  };

  return { entries: sorted, summary };
}

// =============================================================================
// 操作处理器
// =============================================================================

function resolveManifestPath(root: string): string {
  return join(getWiseRoot(root), 'deepinit-manifest.json');
}

function handleDiff(root: string, mode: string): { content: Array<{ type: 'text'; text: string }> } {
  const current = scanDirectories(root);
  const manifestPath = resolveManifestPath(root);

  let diff: DiffResult;
  if (mode === 'full') {
    // full 模式：将全部视为 added
    diff = computeDiff(null, current);
  } else {
    const manifest = loadManifest(manifestPath);
    diff = computeDiff(manifest?.directories ?? null, current);
  }

  const output = {
    mode,
    manifestExists: existsSync(manifestPath),
    ...diff,
  };

  return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
}

function handleSave(root: string, dryRun: boolean): { content: Array<{ type: 'text'; text: string }> } {
  const current = scanDirectories(root);
  const manifest: DeepInitManifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    directories: current,
  };

  if (dryRun) {
    return {
      content: [{
        type: 'text' as const,
        text: `Dry run — manifest NOT written.\n\nDirectories tracked: ${Object.keys(current).length}\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\``,
      }],
    };
  }

  const manifestPath = resolveManifestPath(root);
  atomicWriteJsonSync(manifestPath, manifest);

  return {
    content: [{
      type: 'text' as const,
      text: `Manifest saved successfully.\n\nPath: ${manifestPath}\nDirectories tracked: ${Object.keys(current).length}\nGenerated at: ${manifest.generatedAt}`,
    }],
  };
}

function handleCheck(root: string): { content: Array<{ type: 'text'; text: string }> } {
  const manifestPath = resolveManifestPath(root);
  const exists = existsSync(manifestPath);

  if (!exists) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ exists: false, valid: false, directoryCount: 0, generatedAt: null }, null, 2),
      }],
    };
  }

  const manifest = loadManifest(manifestPath);
  const valid = manifest !== null;
  const directoryCount = valid ? Object.keys(manifest!.directories).length : 0;
  const generatedAt = valid ? manifest!.generatedAt : null;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ exists, valid, directoryCount, generatedAt }, null, 2),
    }],
  };
}

// =============================================================================
// 工具定义
// =============================================================================

export const deepinitManifestTool: ToolDefinition<typeof deepinitManifestSchema> = {
  name: 'deepinit_manifest',
  description:
    'Manage the deepinit manifest for incremental AGENTS.md regeneration. ' +
    'Compares directory file lists (not file contents) to detect structural changes. ' +
    'Actions: diff (find changed directories), save (persist current state), check (validate manifest).',
  category: TOOL_CATEGORIES.DEEPINIT,
  schema: deepinitManifestSchema,
  handler: async (args: DeepinitManifestInput) => {
    const { action, workingDirectory, mode, dryRun } = args;

    // 按操作校验参数
    if (action !== 'diff' && mode !== undefined && mode !== 'incremental') {
      return {
        content: [{ type: 'text' as const, text: `Error: 'mode' parameter is only valid with action='diff'. Got action='${action}'.` }],
        isError: true,
      };
    }
    if (action !== 'save' && dryRun) {
      return {
        content: [{ type: 'text' as const, text: `Error: 'dryRun' parameter is only valid with action='save'. Got action='${action}'.` }],
        isError: true,
      };
    }

    try {
      const root = validateWorkingDirectory(workingDirectory);

      switch (action) {
        case 'diff':
          return handleDiff(root, mode ?? 'incremental');
        case 'save':
          return handleSave(root, dryRun ?? false);
        case 'check':
          return handleCheck(root);
        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown action: ${action}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error in deepinit_manifest (${action}): ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};
