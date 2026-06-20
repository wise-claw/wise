/**
 * 实时数据注入
 *
 * 通过执行命令来解析技能/命令模板中的 `!command` 行，
 * 并用包裹在 <live-data> 标签中的输出替换该行。
 *
 * 支持：
 * - 基础：`!git status`
 * - 缓存：`!cache 300s git log -10`
 * - 条件：`!if-modified src/** then git diff src/`
 * - 条件：`!if-branch feat/* then echo "feature branch"`
 * - 每会话一次：`!only-once npm install`
 * - 输出格式：`!json docker inspect ...`、`!table ...`、`!diff git diff`
 * - 多行：`!begin-script bash` ... `!end-script`
 * - 通过 .wise/config/live-data-policy.json 配置安全允许列表
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import safe from "safe-regex";
import { getWorktreeRoot, getWiseRoot } from "../../lib/worktree-paths.js";

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_CACHE_SIZE = 200;
const MAX_ONCE_COMMANDS = 500;

// 为提升性能预编译的正则模式
const LIVE_DATA_LINE_PATTERN = /^\s*!(.+)/;
const CODE_BLOCK_FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
const CACHE_DIRECTIVE_PATTERN = /^cache\s+(\d+)s?\s+(.+)$/;
const IF_MODIFIED_DIRECTIVE_PATTERN = /^if-modified\s+(\S+)\s+then\s+(.+)$/;
const IF_BRANCH_DIRECTIVE_PATTERN = /^if-branch\s+(\S+)\s+then\s+(.+)$/;
const ONLY_ONCE_DIRECTIVE_PATTERN = /^only-once\s+(.+)$/;
const FORMAT_DIRECTIVE_PATTERN = /^(json|table|diff)\s+(.+)$/;
const REGEX_ESCAPE_PATTERN = /[.+^${}()|[\]\\]/g;
const DIFF_ADDED_LINES_PATTERN = /^\+[^+]/gm;
const DIFF_DELETED_LINES_PATTERN = /^-[^-]/gm;
const DIFF_FILE_HEADER_PATTERN = /^(?:diff --git|---|\+\+\+) [ab]\/(.+)/gm;
const DIFF_HEADER_PREFIX_PATTERN = /^(?:diff --git|---|\+\+\+) [ab]\//;
const SCRIPT_BEGIN_PATTERN = /^\s*!begin-script\s+(\S+)\s*$/;
const SCRIPT_END_PATTERN = /^\s*!end-script\s*$/;
const WHITESPACE_SPLIT_PATTERN = /\s/;

// ─── 类型 ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  output: string;
  error: boolean;
  cachedAt: number;
  ttl: number;
}

interface SecurityPolicy {
  allowed_commands?: string[];
  allowed_patterns?: string[];
  denied_commands?: string[];
  denied_patterns?: string[];
  require_approval?: string[];
}

type OutputFormat = "json" | "table" | "diff" | null;

// ─── 缓存 ───────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
const onceCommands = new Set<string>();

/** 常见命令的默认 TTL 启发式规则 */
const DEFAULT_TTL: Record<string, number> = {
  "git status": 1,
  "git branch": 5,
  "git log": 60,
  "docker ps": 5,
  "node --version": 3600,
  "npm --version": 3600,
};

function getDefaultTtl(command: string): number {
  for (const [pattern, ttl] of Object.entries(DEFAULT_TTL)) {
    if (command.startsWith(pattern)) return ttl;
  }
  return 0; // 默认不缓存
}

function getCached(command: string): CacheEntry | null {
  const entry = cache.get(command);
  if (!entry) return null;
  if (entry.ttl > 0 && Date.now() - entry.cachedAt > entry.ttl * 1000) {
    cache.delete(command);
    return null;
  }
  return entry;
}

function setCache(
  command: string,
  output: string,
  error: boolean,
  ttl: number,
): void {
  if (ttl <= 0) return;

  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  cache.set(command, { output, error, cachedAt: Date.now(), ttl });
}

function markCommandExecuted(command: string): void {
  if (onceCommands.has(command)) {
    return;
  }

  if (onceCommands.size >= MAX_ONCE_COMMANDS) {
    const firstKey = onceCommands.values().next().value;
    if (firstKey !== undefined) onceCommands.delete(firstKey);
  }

  onceCommands.add(command);
}

/** 清除所有缓存（测试时有用） */
export function clearCache(): void {
  cache.clear();
  onceCommands.clear();
}

// ─── 安全 ────────────────────────────────────────────────────────────────

let cachedPolicy: SecurityPolicy | null = null;
let policyLoadedFrom: string | null = null;

function loadSecurityPolicy(): SecurityPolicy {
  const root = getWorktreeRoot() || process.cwd();
  const policyPaths = [
    join(getWiseRoot(root), "config", "live-data-policy.json"),
    join(root, ".claude", "live-data-policy.json"),
  ];

  for (const p of policyPaths) {
    if (p === policyLoadedFrom && cachedPolicy) return cachedPolicy;
    if (existsSync(p)) {
      try {
        cachedPolicy = JSON.parse(readFileSync(p, "utf-8")) as SecurityPolicy;
        policyLoadedFrom = p;
        return cachedPolicy;
      } catch {
        // 忽略格式错误的策略
      }
    }
  }
  return {};
}

/** 重置已缓存策略（测试用） */
export function resetSecurityPolicy(): void {
  cachedPolicy = null;
  policyLoadedFrom = null;
}

function checkSecurity(command: string): { allowed: boolean; reason?: string } {
  const policy = loadSecurityPolicy();
  const cmdBase = command.split(WHITESPACE_SPLIT_PATTERN)[0];

  // 先检查拒绝模式（始终强制执行）
  if (policy.denied_patterns) {
    for (const pat of policy.denied_patterns) {
      try {
        if (!safe(pat)) {
          // 拒绝列表中的不安全正则：拦截命令以失败闭合。
          // 具备 ReDoS 能力的模式被视为一律拒绝。
          return { allowed: false, reason: `unsafe regex rejected: ${pat}` };
        }
        if (new RegExp(pat).test(command)) {
          return { allowed: false, reason: `denied by pattern: ${pat}` };
        }
      } catch {
        // 跳过无效正则
      }
    }
  }

  if (policy.denied_commands) {
    if (policy.denied_commands.includes(cmdBase)) {
      return { allowed: false, reason: `command '${cmdBase}' is denied` };
    }
  }

  // 默认拒绝：若配置了允许列表，命令必须命中它
  // 若完全未配置允许列表，出于安全默认拒绝
  const hasAllowlist =
    (policy.allowed_commands && policy.allowed_commands.length > 0) ||
    (policy.allowed_patterns && policy.allowed_patterns.length > 0);

  if (!hasAllowlist) {
    return {
      allowed: false,
      reason: `no allowlist configured - command execution blocked by default`,
    };
  }

  // 检查命令是否命中允许列表
  let baseAllowed = false;
  let patternAllowed = false;

  if (policy.allowed_commands) {
    baseAllowed = policy.allowed_commands.includes(cmdBase);
  }

  if (policy.allowed_patterns) {
    for (const pat of policy.allowed_patterns) {
      try {
        if (!safe(pat)) {
          // 允许列表中的不安全正则：跳过以失败闭合。
          // 该模式无法授予访问权限——其余模式
          // 或 allowed_commands 仍可能命中。
          continue;
        }
        if (new RegExp(pat).test(command)) {
          patternAllowed = true;
          break;
        }
      } catch {
        // 跳过无效正则
      }
    }
  }

  if (!baseAllowed && !patternAllowed) {
    return {
      allowed: false,
      reason: `command '${cmdBase}' not in allowlist`,
    };
  }

  return { allowed: true };
}

// ─── 行分类 ─────────────────────────────────────────────────────────────

export function isLiveDataLine(line: string): boolean {
  return LIVE_DATA_LINE_PATTERN.test(line);
}

function getCodeBlockRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let openIndex: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (CODE_BLOCK_FENCE_PATTERN.test(lines[i])) {
      if (openIndex === null) {
        openIndex = i;
      } else {
        ranges.push([openIndex, i]);
        openIndex = null;
      }
    }
  }
  // 未闭合的围栏：将起始围栏之后的每一行都视为在代码块内
  if (openIndex !== null) {
    ranges.push([openIndex, lines.length]);
  }
  return ranges;
}

function isInsideCodeBlock(
  lineIndex: number,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some(([start, end]) => lineIndex > start && lineIndex < end);
}

// ─── 命令解析 ─────────────────────────────────────────────────────────────────

interface ParsedDirective {
  type:
    | "basic"
    | "cache"
    | "if-modified"
    | "if-branch"
    | "only-once"
    | "format";
  command: string;
  format?: OutputFormat;
  ttl?: number;
  pattern?: string;
}

function parseDirective(raw: string): ParsedDirective {
  const trimmed = raw.replace(/^\s*!/, "").trim();

  const cacheMatch = trimmed.match(CACHE_DIRECTIVE_PATTERN);
  if (cacheMatch) {
    return {
      type: "cache",
      ttl: parseInt(cacheMatch[1], 10),
      command: cacheMatch[2],
    };
  }

  const ifModifiedMatch = trimmed.match(IF_MODIFIED_DIRECTIVE_PATTERN);
  if (ifModifiedMatch) {
    return {
      type: "if-modified",
      pattern: ifModifiedMatch[1],
      command: ifModifiedMatch[2],
    };
  }

  const ifBranchMatch = trimmed.match(IF_BRANCH_DIRECTIVE_PATTERN);
  if (ifBranchMatch) {
    return {
      type: "if-branch",
      pattern: ifBranchMatch[1],
      command: ifBranchMatch[2],
    };
  }

  const onlyOnceMatch = trimmed.match(ONLY_ONCE_DIRECTIVE_PATTERN);
  if (onlyOnceMatch) {
    return { type: "only-once", command: onlyOnceMatch[1] };
  }

  const formatMatch = trimmed.match(FORMAT_DIRECTIVE_PATTERN);
  if (formatMatch) {
    return {
      type: "format",
      format: formatMatch[1] as OutputFormat,
      command: formatMatch[2],
    };
  }

  return { type: "basic", command: trimmed };
}

// ─── 条件辅助 ─────────────────────────────────────────────────────────────

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(REGEX_ESCAPE_PATTERN, "\\$&")
    .replace(/\*\*/g, "⟨GLOBSTAR⟩")
    .replace(/\*/g, "[^/]*")
    .replace(/⟨GLOBSTAR⟩/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function checkIfModified(pattern: string): boolean {
  try {
    const output = execSync("git diff --name-only 2>/dev/null || true", {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const regex = globToRegex(pattern);
    return output.split("\n").some((f) => regex.test(f.trim()));
  } catch {
    return false;
  }
}

function checkIfBranch(pattern: string): boolean {
  try {
    const branch = execSync("git branch --show-current 2>/dev/null || true", {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return globToRegex(pattern).test(branch);
  } catch {
    return false;
  }
}

// ─── 执行 ───────────────────────────────────────────────────────────────

function executeCommand(command: string): { stdout: string; error: boolean } {
  try {
    const stdout = execSync(command, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES + 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = stdout ?? "";
    let truncated = false;

    if (Buffer.byteLength(output, "utf-8") > MAX_OUTPUT_BYTES) {
      const buf = Buffer.from(output, "utf-8").subarray(0, MAX_OUTPUT_BYTES);
      output = buf.toString("utf-8");
      truncated = true;
    }

    if (truncated) {
      output += "\n... [output truncated at 50KB]";
    }

    return { stdout: output, error: false };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? (err as { stderr?: string }).stderr || err.message
        : String(err);
    return { stdout: String(message), error: true };
  }
}

// ─── HTML 转义 ───────────────────────────────────────────────────────────────

/** 转义在 XML/HTML 属性和内容中具有特殊含义的字符。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── 输出格式化 ──────────────────────────────────────────────────────────────

function formatOutput(
  command: string,
  output: string,
  error: boolean,
  format: OutputFormat,
): string {
  const escapedCommand = escapeHtml(command);
  const escapedOutput = escapeHtml(output);
  const formatAttr = format ? ` format="${format}"` : "";
  const errorAttr = error ? ' error="true"' : "";

  if (format === "diff" && !error) {
    const addLines = (output.match(DIFF_ADDED_LINES_PATTERN) || []).length;
    const delLines = (output.match(DIFF_DELETED_LINES_PATTERN) || []).length;
    const files = new Set(
      (output.match(DIFF_FILE_HEADER_PATTERN) || []).map((l) =>
        l.replace(DIFF_HEADER_PREFIX_PATTERN, ""),
      ),
    ).size;
    return `<live-data command="${escapedCommand}"${formatAttr} files="${files}" +="${addLines}" -="${delLines}"${errorAttr}>${escapedOutput}</live-data>`;
  }

  return `<live-data command="${escapedCommand}"${formatAttr}${errorAttr}>${escapedOutput}</live-data>`;
}

// ─── 多行脚本支持 ───────────────────────────────────────────────────────────────

interface ScriptBlock {
  startLine: number;
  endLine: number;
  shell: string;
  body: string;
}

function extractScriptBlocks(
  lines: string[],
  codeBlockRanges: Array<[number, number]>,
): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  let current: {
    startLine: number;
    shell: string;
    bodyLines: string[];
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (isInsideCodeBlock(i, codeBlockRanges)) continue;

    const beginMatch = lines[i].match(SCRIPT_BEGIN_PATTERN);
    if (beginMatch && !current) {
      current = { startLine: i, shell: beginMatch[1], bodyLines: [] };
      continue;
    }

    if (SCRIPT_END_PATTERN.test(lines[i]) && current) {
      blocks.push({
        startLine: current.startLine,
        endLine: i,
        shell: current.shell,
        body: current.bodyLines.join("\n"),
      });
      current = null;
      continue;
    }

    if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  return blocks;
}

// ─── 主解析器 ───────────────────────────────────────────────────────────

/**
 * 解析内容中所有 live-data 指令。
 * 围栏代码块内的行会被跳过。
 */
export function resolveLiveData(content: string): string {
  const lines = content.split("\n");
  const codeBlockRanges = getCodeBlockRanges(lines);

  // 第一遍：提取并解析多行脚本块
  const scriptBlocks = extractScriptBlocks(lines, codeBlockRanges);
  const scriptLineSet = new Set<number>();
  const scriptReplacements = new Map<number, string>();

  for (const block of scriptBlocks) {
    for (let i = block.startLine; i <= block.endLine; i++) {
      scriptLineSet.add(i);
    }

    const security = checkSecurity(block.shell);
    if (!security.allowed) {
      scriptReplacements.set(
        block.startLine,
        `<live-data command="script:${escapeHtml(block.shell)}" error="true">blocked: ${escapeHtml(security.reason ?? "")}</live-data>`,
      );
      continue;
    }

    // 将脚本写入 shell 的 stdin
    try {
      const result = execSync(block.shell, {
        input: block.body,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES + 1024,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      scriptReplacements.set(
        block.startLine,
        `<live-data command="script:${escapeHtml(block.shell)}">${escapeHtml(result ?? "")}</live-data>`,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? (err as { stderr?: string }).stderr || err.message
          : String(err);
      scriptReplacements.set(
        block.startLine,
        `<live-data command="script:${escapeHtml(block.shell)}" error="true">${escapeHtml(message)}</live-data>`,
      );
    }
  }

  // 第二遍：逐行处理
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // 脚本块行：在起始行输出替换结果，跳过其余行
    if (scriptLineSet.has(i)) {
      const replacement = scriptReplacements.get(i);
      if (replacement) result.push(replacement);
      continue;
    }

    const line = lines[i];
    if (!isLiveDataLine(line) || isInsideCodeBlock(i, codeBlockRanges)) {
      result.push(line);
      continue;
    }

    const directive = parseDirective(line);

    // 安全检查
    const security = checkSecurity(directive.command);
    if (!security.allowed) {
      result.push(
        `<live-data command="${escapeHtml(directive.command)}" error="true">blocked: ${escapeHtml(security.reason ?? "")}</live-data>`,
      );
      continue;
    }

    switch (directive.type) {
      case "if-modified": {
        if (!checkIfModified(directive.pattern!)) {
          result.push(
            `<live-data command="${escapeHtml(directive.command)}" skipped="true">condition not met: no files matching '${escapeHtml(directive.pattern!)}' modified</live-data>`,
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case "if-branch": {
        if (!checkIfBranch(directive.pattern!)) {
          result.push(
            `<live-data command="${escapeHtml(directive.command)}" skipped="true">condition not met: branch does not match '${escapeHtml(directive.pattern!)}'</live-data>`,
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case "only-once": {
        if (onceCommands.has(directive.command)) {
          result.push(
            `<live-data command="${escapeHtml(directive.command)}" skipped="true">already executed this session</live-data>`,
          );
        } else {
          markCommandExecuted(directive.command);
          const { stdout, error } = executeCommand(directive.command);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case "cache": {
        const ttl = directive.ttl!;
        const cached = getCached(directive.command);
        if (cached) {
          result.push(
            formatOutput(
              directive.command,
              cached.output,
              cached.error,
              null,
            ).replace("<live-data", '<live-data cached="true"'),
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          setCache(directive.command, stdout, error, ttl);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case "format": {
        const ttl = getDefaultTtl(directive.command);
        const cached = ttl > 0 ? getCached(directive.command) : null;
        if (cached) {
          result.push(
            formatOutput(
              directive.command,
              cached.output,
              cached.error,
              directive.format!,
            ).replace("<live-data", '<live-data cached="true"'),
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          if (ttl > 0) setCache(directive.command, stdout, error, ttl);
          result.push(
            formatOutput(directive.command, stdout, error, directive.format!),
          );
        }
        break;
      }

      case "basic":
      default: {
        const ttl = getDefaultTtl(directive.command);
        const cached = ttl > 0 ? getCached(directive.command) : null;
        if (cached) {
          result.push(
            formatOutput(
              directive.command,
              cached.output,
              cached.error,
              null,
            ).replace("<live-data", '<live-data cached="true"'),
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          if (ttl > 0) setCache(directive.command, stdout, error, ttl);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }
    }
  }

  return result.join("\n");
}
