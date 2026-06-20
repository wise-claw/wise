/**
 * Codebase Map 生成器
 *
 * 在会话启动时生成项目结构的压缩快照。
 * 作为上下文注入，可将盲目的文件探索减少 30-50%。
 *
 * Issue #804 - 启动时 codebase map 注入钩子
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface CodebaseMapOptions {
  /** map 中包含的最大文件数。默认：200 */
  maxFiles?: number;
  /** 扫描的最大目录深度。默认：4 */
  maxDepth?: number;
  /** 额外要忽略的模式（按条目名匹配） */
  ignorePatterns?: string[];
  /** 是否包含 package.json 元数据。默认：true */
  includeMetadata?: boolean;
}

export interface CodebaseMapResult {
  /** 格式化后的 codebase map 字符串 */
  map: string;
  /** 统计到的源码文件总数 */
  totalFiles: number;
  /** 结果是否因 maxFiles 限制而被截断 */
  truncated: boolean;
}

// 扫描时始终跳过的目录
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.cache', '.turbo', '.parcel-cache',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'target', '.gradle', 'vendor',
  '.venv', 'venv', 'env',
  '.wise', '.claude',
  'tmp', 'temp',
]);

// 视为源码/配置文件的扩展名
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp',
  '.cs', '.fs',
  '.vue', '.svelte',
  '.sh', '.bash', '.zsh',
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm',
]);

// 锁文件与生成的清单 —— 对导航无用
const SKIP_FILE_SUFFIXES = ['-lock.json', '.lock', '-lock.yaml', '-lock.toml'];

// 无论扩展名如何，始终包含的重要顶层文件
const IMPORTANT_FILES = new Set([
  'package.json', 'tsconfig.json', 'tsconfig.base.json',
  'pyproject.toml', 'Cargo.toml', 'go.mod', 'go.sum',
  'CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md',
  '.eslintrc.json', 'vitest.config.ts', 'jest.config.ts', 'jest.config.js',
  'Makefile', 'Dockerfile', '.gitignore',
]);

interface TreeNode {
  name: string;
  isDir: boolean;
  children?: TreeNode[];
}

/**
 * 判断一个目录条目是否应被跳过。
 */
export function shouldSkipEntry(
  name: string,
  isDir: boolean,
  ignorePatterns: string[],
): boolean {
  // 跳过隐藏目录（重要隐藏文件则放行）
  if (name.startsWith('.') && isDir && !IMPORTANT_FILES.has(name)) {
    return true;
  }

  // 跳过被屏蔽的目录
  if (isDir && SKIP_DIRS.has(name)) {
    return true;
  }

  // 文件：仅纳入源码/配置扩展名或重要文件
  if (!isDir) {
    // 无论扩展名如何，跳过锁文件与生成的清单
    if (SKIP_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
      return true;
    }
    const ext = extname(name);
    if (!SOURCE_EXTENSIONS.has(ext) && !IMPORTANT_FILES.has(name)) {
      return true;
    }
  }

  // 按条目名匹配的自定义忽略模式
  for (const pattern of ignorePatterns) {
    if (name.includes(pattern)) return true;
  }

  return false;
}

/**
 * 递归地为目录构建树形结构。
 */
export function buildTree(
  dir: string,
  depth: number,
  maxDepth: number,
  fileCount: { value: number },
  maxFiles: number,
  ignorePatterns: string[],
): TreeNode[] {
  if (depth > maxDepth || fileCount.value >= maxFiles) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  // 排序：目录优先，再是文件 —— 均按字母序
  const withMeta = entries.map((name) => {
    let isDir = false;
    try {
      isDir = statSync(join(dir, name)).isDirectory();
    } catch {
      // 忽略 stat 错误
    }
    return { name, isDir };
  });

  withMeta.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: TreeNode[] = [];

  for (const { name, isDir } of withMeta) {
    if (fileCount.value >= maxFiles) break;

    if (shouldSkipEntry(name, isDir, ignorePatterns)) continue;

    if (isDir) {
      const children = buildTree(
        join(dir, name),
        depth + 1,
        maxDepth,
        fileCount,
        maxFiles,
        ignorePatterns,
      );
      nodes.push({ name, isDir: true, children });
    } else {
      fileCount.value++;
      nodes.push({ name, isDir: false });
    }
  }

  return nodes;
}

/**
 * 将节点树渲染为 ASCII 字符画行。
 */
export function renderTree(nodes: TreeNode[], prefix: string, lines: string[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    lines.push(`${prefix}${connector}${node.name}${node.isDir ? '/' : ''}`);

    if (node.isDir && node.children && node.children.length > 0) {
      renderTree(node.children, prefix + childPrefix, lines);
    }
  }
}

/**
 * 从 package.json 提取简短摘要（name、description、关键 scripts）。
 */
export function extractPackageMetadata(directory: string): string {
  const pkgPath = join(directory, 'package.json');
  if (!existsSync(pkgPath)) return '';

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      name?: string;
      description?: string;
      scripts?: Record<string, string>;
    };

    const lines: string[] = [];
    if (pkg.name) lines.push(`Package: ${pkg.name}`);
    if (pkg.description) lines.push(`Description: ${pkg.description}`);
    if (pkg.scripts) {
      const scriptNames = Object.keys(pkg.scripts).slice(0, 8).join(', ');
      if (scriptNames) lines.push(`Scripts: ${scriptNames}`);
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * 为给定目录生成压缩的 codebase map。
 *
 * 返回源码文件的树形格式字符串，并附带可选的项目元数据。
 * 设计为在会话启动时注入，以减少探索性文件搜索工具调用 30-50%。
 */
export function generateCodebaseMap(
  directory: string,
  options: CodebaseMapOptions = {},
): CodebaseMapResult {
  const {
    maxFiles = 200,
    maxDepth = 4,
    ignorePatterns = [],
    includeMetadata = true,
  } = options;

  if (!existsSync(directory)) {
    return { map: '', totalFiles: 0, truncated: false };
  }

  const fileCount = { value: 0 };
  const tree = buildTree(directory, 0, maxDepth, fileCount, maxFiles, ignorePatterns);

  const treeLines: string[] = [];
  renderTree(tree, '', treeLines);
  const treeStr = treeLines.join('\n');

  const parts: string[] = [];

  if (includeMetadata) {
    const meta = extractPackageMetadata(directory);
    if (meta) parts.push(meta);
  }

  parts.push(treeStr);

  const truncated = fileCount.value >= maxFiles;
  if (truncated) {
    parts.push(`[Map truncated at ${maxFiles} files — use Glob/Grep for full search]`);
  }

  return {
    map: parts.join('\n\n'),
    totalFiles: fileCount.value,
    truncated,
  };
}
