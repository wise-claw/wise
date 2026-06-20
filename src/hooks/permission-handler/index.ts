import * as fs from 'fs';
import * as path from 'path';
import { getWiseRoot, getWorktreeRoot } from '../../lib/worktree-paths.js';
import { getClaudeConfigDir } from '../../utils/config-dir.js';

export interface PermissionRequestInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: {
    command?: string;
    file_path?: string;
    content?: string;
    [key: string]: unknown;
  };
  tool_use_id: string;
}

export interface HookOutput {
  continue: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    decision?: {
      behavior: 'allow' | 'deny' | 'ask';
      reason?: string;
    };
  };
}

const SAFE_PATTERNS = [
  /^git (status|diff|log|branch|show|fetch)/,
  /^npm run (lint|build|check|typecheck)/,
  /^pnpm (lint|build|check|typecheck|run (lint|build|check|typecheck))/,
  /^yarn (lint|build|check|typecheck|run (lint|build|check|typecheck))/,
  /^tsc( |$)/,
  /^gh (issue|pr) (view|list|status)\b/,
  /^eslint /,
  /^prettier /,
  /^cargo (check|clippy|build)/,
  /^ls( |$)/,
  // 已移除：cat、head、tail —— 它们允许读取任意文件
];

// 支持命令拼接与注入的 shell 元字符
// 完整危险字符列表参见 GitHub Issue #146
// 注意：引号 ("') 被刻意排除——带空格的路径需要它们，
// 且命令替换已由 $ 检测覆盖
const DANGEROUS_SHELL_CHARS = /[;&|`$()<>\n\r\t\0\\{}\[\]*?~!#]/;

// Heredoc 操作符检测（<<、<<-、<<~，定界符可选引用）
const HEREDOC_PATTERN = /<<[-~]?\s*['"]?\w+['"]?/;

/**
 * 即使包含 heredoc 内容也可安全自动放行的模式。
 * 与命令首行（heredoc 正文之前）进行匹配。
 * Issue #608：防止完整 heredoc 正文被写入 settings.local.json。
 */
const SAFE_HEREDOC_PATTERNS = [
  /^git commit\b/,
  /^git tag\b/,
];

const SAFE_RIPGREP_FLAGS = new Set([
  '-n',
  '--line-number',
  '-S',
  '--smart-case',
  '-F',
  '--fixed-strings',
  '-i',
  '--ignore-case',
  '--no-heading',
]);

const BACKGROUND_MUTATION_SUBAGENTS = new Set([
  'executor',
  'designer',
  'writer',
  'debugger',
  'git-master',
  'test-engineer',
  'qa-tester',
  'document-specialist',
]);

function readPermissionStringEntries(filePath: string, key: 'allow' | 'ask'): string[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const settings = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      permissions?: { allow?: unknown; ask?: unknown };
      allow?: unknown;
      ask?: unknown;
    };
    const entries = settings?.permissions?.[key] ?? settings?.[key];
    return Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function getClaudePermissionAllowEntries(directory: string): string[] {
  const projectSettingsPath = path.join(directory, '.claude', 'settings.local.json');
  const globalConfigDir = getClaudeConfigDir();
  const candidatePaths = [
    projectSettingsPath,
    path.join(globalConfigDir, 'settings.local.json'),
    path.join(globalConfigDir, 'settings.json'),
  ];

  const allowEntries = new Set<string>();
  for (const candidatePath of candidatePaths) {
    for (const entry of readPermissionStringEntries(candidatePath, 'allow')) {
      allowEntries.add(entry.trim());
    }
  }

  return [...allowEntries];
}

function hasGenericToolPermission(allowEntries: string[], toolName: string): boolean {
  return allowEntries.some(entry => entry === toolName || entry.startsWith(`${toolName}(`));
}

export function hasClaudePermissionApproval(
  directory: string,
  toolName: 'Edit' | 'Write' | 'Bash',
  command?: string,
): boolean {
  const allowEntries = getClaudePermissionAllowEntries(directory);

  if (toolName !== 'Bash') {
    return hasGenericToolPermission(allowEntries, toolName);
  }

  if (allowEntries.includes('Bash')) {
    return true;
  }

  const trimmedCommand = command?.trim();
  if (!trimmedCommand) {
    return false;
  }

  return allowEntries.includes(`Bash(${trimmedCommand})`);
}


export function getClaudePermissionAskEntries(directory: string): string[] {
  const projectSettingsPath = path.join(directory, '.claude', 'settings.local.json');
  const globalConfigDir = getClaudeConfigDir();
  const candidatePaths = [
    projectSettingsPath,
    path.join(globalConfigDir, 'settings.local.json'),
    path.join(globalConfigDir, 'settings.json'),
  ];

  const askEntries = new Set<string>();
  for (const candidatePath of candidatePaths) {
    for (const entry of readPermissionStringEntries(candidatePath, 'ask')) {
      askEntries.add(entry.trim());
    }
  }

  return [...askEntries];
}

function commandMatchesPermissionPattern(command: string, pattern: string): boolean {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return false;
  }

  if (!trimmedPattern.includes('*')) {
    return command === trimmedPattern;
  }

  const normalizedPrefix = trimmedPattern.replace(/[\s:]*\*+$/, '').trimEnd();
  if (!normalizedPrefix) {
    return false;
  }

  if (!command.startsWith(normalizedPrefix)) {
    return false;
  }

  const nextChar = command.charAt(normalizedPrefix.length);
  return nextChar === '' || /[\s:=(["']/.test(nextChar);
}

export function hasClaudePermissionAsk(
  directory: string,
  toolName: 'Edit' | 'Write' | 'Bash',
  command?: string,
): boolean {
  const askEntries = getClaudePermissionAskEntries(directory);

  if (toolName !== 'Bash') {
    return hasGenericToolPermission(askEntries, toolName);
  }

  const trimmedCommand = command?.trim();
  if (!trimmedCommand) {
    return false;
  }

  return askEntries.some(entry => {
    if (entry === 'Bash') {
      return true;
    }

    if (!entry.startsWith('Bash(') || !entry.endsWith(')')) {
      return false;
    }

    return commandMatchesPermissionPattern(trimmedCommand, entry.slice(5, -1));
  });
}

export interface BackgroundPermissionFallbackResult {
  shouldFallback: boolean;
  missingTools: string[];
}

export function getBackgroundTaskPermissionFallback(
  directory: string,
  subagentType?: string,
): BackgroundPermissionFallbackResult {
  const normalizedSubagentType = subagentType?.trim().toLowerCase();
  if (!normalizedSubagentType || !BACKGROUND_MUTATION_SUBAGENTS.has(normalizedSubagentType)) {
    return { shouldFallback: false, missingTools: [] };
  }

  const missingTools = ['Edit', 'Write'].filter(
    toolName => !hasClaudePermissionApproval(directory, toolName as 'Edit' | 'Write'),
  );

  return {
    shouldFallback: missingTools.length > 0,
    missingTools,
  };
}

export function getBackgroundBashPermissionFallback(
  directory: string,
  command?: string,
): BackgroundPermissionFallbackResult {
  if (!command) {
    return { shouldFallback: false, missingTools: [] };
  }

  if (hasClaudePermissionAsk(directory, 'Bash', command)) {
    return { shouldFallback: true, missingTools: ['Bash'] };
  }

  if (isSafeAutoApprovedCommand(command, directory)) {
    return { shouldFallback: false, missingTools: [] };
  }

  return hasClaudePermissionApproval(directory, 'Bash', command)
    ? { shouldFallback: false, missingTools: [] }
    : { shouldFallback: true, missingTools: ['Bash'] };
}

function tokenizeShellCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return null;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.length > 0 ? tokens : null;
}

function isSensitiveRepoRelativePath(repoRelativePath: string): boolean {
  const normalized = repoRelativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.') {
    return false;
  }

  return (
    normalized === '.git' ||
    normalized.startsWith('.git/') ||
    normalized.includes('/.git/') ||
    normalized === '.ssh' ||
    normalized.startsWith('.ssh/') ||
    normalized.includes('/.ssh/') ||
    normalized === 'secrets' ||
    normalized.startsWith('secrets/') ||
    normalized.includes('/secrets/') ||
    normalized === '.env' ||
    normalized.startsWith('.env.') ||
    normalized.includes('/.env') ||
    normalized.includes('/.env.') ||
    normalized === 'node_modules/.cache' ||
    normalized.startsWith('node_modules/.cache/') ||
    normalized.includes('/node_modules/.cache/')
  );
}

function isSafeRepoPath(
  cwd: string,
  inputPath: string,
  options: { allowDirectory?: boolean; requireExisting?: boolean } = {},
): boolean {
  const { allowDirectory = false, requireExisting = true } = options;
  if (!inputPath) {
    return false;
  }

  const worktreeRoot = getWorktreeRoot(cwd);
  if (!worktreeRoot) {
    return false;
  }
  const resolvedPath = path.resolve(cwd, inputPath);

  let canonicalPath = resolvedPath;
  const exists = fs.existsSync(resolvedPath);

  if (exists) {
    try {
      canonicalPath = fs.realpathSync(resolvedPath);
    } catch {
      return false;
    }
  } else if (requireExisting) {
    return false;
  }

  const relativePath = path.relative(worktreeRoot, canonicalPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false;
  }

  if (!relativePath || relativePath === '.') {
    return allowDirectory;
  }

  if (isSensitiveRepoRelativePath(relativePath)) {
    return false;
  }

  if (!allowDirectory && exists) {
    try {
      if (fs.statSync(resolvedPath).isDirectory()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

function areSafeRepoPaths(
  cwd: string,
  args: string[],
  options: { allowDirectory?: boolean; requireExisting?: boolean } = {},
): boolean {
  const pathArgs = args.filter(arg => arg !== '--');
  return pathArgs.length > 0 && pathArgs.every(arg => !arg.startsWith('-') && isSafeRepoPath(cwd, arg, options));
}

function isSafeCatCommand(tokens: string[], cwd: string): boolean {
  return tokens[0] === 'cat' && areSafeRepoPaths(cwd, tokens.slice(1));
}

function isSafeHeadOrTailCommand(tokens: string[], cwd: string): boolean {
  if (tokens[0] !== 'head' && tokens[0] !== 'tail') {
    return false;
  }

  let index = 1;
  if (tokens[index] === '-n') {
    index += 2;
  } else if (/^-n\d+$/.test(tokens[index] ?? '')) {
    index += 1;
  }

  return areSafeRepoPaths(cwd, tokens.slice(index));
}

function isSafeSedInspectionCommand(tokens: string[], cwd: string): boolean {
  if (tokens[0] !== 'sed' || tokens[1] !== '-n') {
    return false;
  }

  const script = tokens[2];
  if (!script || !/^\d+(,\d+)?p$/.test(script)) {
    return false;
  }

  return areSafeRepoPaths(cwd, tokens.slice(3));
}

function isSafeRipgrepInspectionCommand(tokens: string[], cwd: string): boolean {
  if (tokens[0] !== 'rg') {
    return false;
  }

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--') {
      index += 1;
      break;
    }
    if (!token.startsWith('-')) {
      break;
    }
    if (!SAFE_RIPGREP_FLAGS.has(token)) {
      return false;
    }
    index += 1;
  }

  const pattern = tokens[index];
  if (!pattern || pattern.startsWith('-')) {
    return false;
  }

  const searchPaths = tokens.slice(index + 1);
  return areSafeRepoPaths(cwd, searchPaths, { allowDirectory: false });
}

function isSafeTargetedVitestCommand(tokens: string[], cwd: string): boolean {
  const supportedPrefixes: string[][] = [
    ['vitest', 'run'],
    ['pnpm', 'vitest', 'run'],
    ['yarn', 'vitest', 'run'],
  ];

  const matchedPrefix = supportedPrefixes.find(prefix =>
    prefix.every((part, index) => tokens[index] === part),
  );

  if (!matchedPrefix) {
    return false;
  }

  const remaining = tokens.slice(matchedPrefix.length);
  return remaining.length === 1 && isSafeRepoPath(cwd, remaining[0], { allowDirectory: false });
}

function isSafeTargetedPackageManagerTestCommand(tokens: string[], cwd: string): boolean {
  const supportedPrefixes: string[][] = [
    ['npm', 'test', '--', '--run'],
    ['npm', 'run', 'test', '--', '--run'],
    ['pnpm', 'test', '--', '--run'],
    ['pnpm', 'run', 'test', '--', '--run'],
    ['yarn', 'test', '--run'],
  ];

  const matchedPrefix = supportedPrefixes.find(prefix =>
    prefix.every((part, index) => tokens[index] === part),
  );

  if (!matchedPrefix) {
    return false;
  }

  const remaining = tokens.slice(matchedPrefix.length);
  return remaining.length === 1 && isSafeRepoPath(cwd, remaining[0], { allowDirectory: false });
}

function isSafeTargetedNodeTestCommand(tokens: string[], cwd: string): boolean {
  return tokens[0] === 'node'
    && tokens[1] === '--test'
    && tokens.length === 3
    && isSafeRepoPath(cwd, tokens[2], { allowDirectory: false });
}

export function isSafeRepoInspectionCommand(command: string, cwd: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || DANGEROUS_SHELL_CHARS.test(trimmed)) {
    return false;
  }

  const tokens = tokenizeShellCommand(trimmed);
  if (!tokens) {
    return false;
  }

  return isSafeCatCommand(tokens, cwd)
    || isSafeHeadOrTailCommand(tokens, cwd)
    || isSafeSedInspectionCommand(tokens, cwd)
    || isSafeRipgrepInspectionCommand(tokens, cwd);
}

export function isSafeTargetedLocalTestCommand(command: string, cwd: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || DANGEROUS_SHELL_CHARS.test(trimmed)) {
    return false;
  }

  const tokens = tokenizeShellCommand(trimmed);
  if (!tokens) {
    return false;
  }

  return isSafeTargetedVitestCommand(tokens, cwd)
    || isSafeTargetedPackageManagerTestCommand(tokens, cwd)
    || isSafeTargetedNodeTestCommand(tokens, cwd);
}

export function isSafeAutoApprovedCommand(command: string, cwd: string): boolean {
  return isSafeCommand(command)
    || isSafeRepoInspectionCommand(command, cwd)
    || isSafeTargetedLocalTestCommand(command, cwd)
    || isHeredocWithSafeBase(command);
}

/**
 * 检查命令是否匹配安全模式
 */
export function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();

  // 安全：拒绝任何含 shell 元字符的命令
  // 这些字符允许命令拼接，从而绕过安全模式检查
  if (DANGEROUS_SHELL_CHARS.test(trimmed)) {
    return false;
  }

  return SAFE_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * 检查命令是否为带安全基础命令的 heredoc 命令。
 * Issue #608：heredoc 命令包含 shell 元字符（<<、\n、$ 等），会导致 isSafeCommand() 拒绝它们。
 * 当它们落入 Claude Code 原生权限流程且用户选择"始终允许"时，
 * 整段 heredoc 正文（可能上百行）会被写入 settings.local.json。
 *
 * 本函数检测 heredoc 命令并校验基础命令（首行）是否匹配已知安全模式，
 * 从而允许自动放行而不污染 settings.local.json。
 */
export function isHeredocWithSafeBase(command: string): boolean {
  const trimmed = command.trim();

  // 来自 Claude Code 的 heredoc 命令总是多行的
  if (!trimmed.includes('\n')) {
    return false;
  }

  // 必须包含 heredoc 操作符
  if (!HEREDOC_PATTERN.test(trimmed)) {
    return false;
  }

  // 提取首行作为基础命令
  const firstLine = trimmed.split('\n')[0].trim();

  // 检查首行是否以安全模式开头
  return SAFE_HEREDOC_PATTERNS.some(pattern => pattern.test(firstLine));
}

/**
 * 检查是否有活动模式（autopilot/ultrawork/ralph/team）正在运行
 */
export function isActiveModeRunning(directory: string): boolean {
  const stateDir = path.join(getWiseRoot(directory), 'state');

  if (!fs.existsSync(stateDir)) {
    return false;
  }

  const activeStateFiles = [
    'autopilot-state.json',
    'ralph-state.json',
    'ultrawork-state.json',
    'team-state.json',
    'wise-teams-state.json',
  ];

  for (const stateFile of activeStateFiles) {
    const statePath = path.join(stateDir, stateFile);
    if (fs.existsSync(statePath)) {
      // JSON 状态文件：检查 active/status 字段
      try {
        const content = fs.readFileSync(statePath, 'utf-8');
        const state = JSON.parse(content);

        // 检查模式是否处于活动状态
        if (state.active === true || state.status === 'running' || state.status === 'active') {
          return true;
        }
      } catch (_error) {
        // 忽略解析错误，继续检查
        continue;
      }
    }
  }

  return false;
}

/**
 * 处理权限请求并决定是否自动放行
 */
export function processPermissionRequest(input: PermissionRequestInput): HookOutput {
  // 仅处理 Bash 工具的命令自动放行
  // 规范化工具名——同时处理带 proxy_ 前缀与无前缀的版本
  const toolName = input.tool_name.replace(/^proxy_/, '');
  if (toolName !== 'Bash') {
    return { continue: true };
  }

  const command = input.tool_input.command;
  if (!command || typeof command !== 'string') {
    return { continue: true };
  }

  const shouldAskBashPermission = hasClaudePermissionAsk(input.cwd, 'Bash', command);

  // 自动放行安全命令
  if (!shouldAskBashPermission && isSafeAutoApprovedCommand(command, input.cwd)) {
    const reason = isHeredocWithSafeBase(command)
      ? 'Safe command with heredoc content'
      : 'Safe read-only or test command';
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          reason,
        },
      },
    };
  }

  // 默认：交由常规权限流程处理
  return { continue: true };
}

/**
 * 主钩子入口
 */
export async function handlePermissionRequest(input: PermissionRequestInput): Promise<HookOutput> {
  return processPermissionRequest(input);
}
