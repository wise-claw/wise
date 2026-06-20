/**
 * wise 原生 shell 启动的 tmux 工具函数
 * 改编自 oh-my-codex 模式用于 wise
 */

import {
  exec,
  execFile,
  execFileSync,
  execSync,
  spawnSync,
  type ExecFileSyncOptionsWithStringEncoding,
  type ExecSyncOptionsWithStringEncoding,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'child_process';
import { basename, isAbsolute, win32 as win32Path } from 'path';
import { promisify } from 'util';

// ── tmux 环境与执行包装器 ────────────────────────────────────

export interface TmuxExecOptions {
  /** 剥离 TMUX 环境变量,使命令指向默认的 tmux server。
   *  默认: false — 保留 TMUX (指向当前 server)。
   *  设为 true 用于 WISE 拥有的后台会话和跨会话扫描。 */
  stripTmux?: boolean;
}

export function tmuxEnv(): NodeJS.ProcessEnv {
  // 同时剥离 TMUX (真正的 tmux) 和 PSMUX_SESSION (psmux 在原生
  // Windows 上的 tmux 替代品)。psmux 基于 PSMUX_SESSION 而非 TMUX
  // 来控制 `new-session -d` 的嵌套,因此只剥离 TMUX 会导致 psmux
  // 静默跳过分离式会话创建。见 issue #3265。
  const { TMUX: _, PSMUX_SESSION: __, ...env } = process.env;
  return env;
}

function resolveEnv(opts?: TmuxExecOptions): NodeJS.ProcessEnv {
  return opts?.stripTmux ? tmuxEnv() : process.env;
}

interface TmuxCommandInvocation {
  command: string;
  args: string[];
}

function isUnixLikeOnWindows(): boolean {
  return process.platform === 'win32' &&
    !!(process.env.MSYSTEM || process.env.MINGW_PREFIX);
}

export function isNativeWindowsShell(): boolean {
  return process.platform === 'win32' && !isUnixLikeOnWindows();
}

function quoteForCmd(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"%^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/(["%])/g, '$1$1')}"`;
}

function escapeForCmdSet(value: string): string {
  return value.replace(/"/g, '""');
}

function resolveTmuxInvocation(args: string[]): TmuxCommandInvocation {
  const resolvedBinary = resolveTmuxBinaryPath();
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedBinary)) {
    const comspec = process.env.COMSPEC || 'cmd.exe';
    const commandLine = [quoteForCmd(resolvedBinary), ...args.map(quoteForCmd)].join(' ');
    return {
      command: comspec,
      args: ['/d', '/s', '/c', commandLine],
    };
  }

  return {
    command: resolvedBinary,
    args,
  };
}

export function tmuxExec(
  args: string[],
  opts?: TmuxExecOptions & Omit<ExecFileSyncOptionsWithStringEncoding, 'env' | 'encoding'> & { encoding?: BufferEncoding },
): string {
  const { stripTmux: _, ...execOpts } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return execFileSync(invocation.command, invocation.args, { encoding: 'utf-8', ...execOpts, env: resolveEnv(opts) });
}

export async function tmuxExecAsync(
  args: string[],
  opts?: TmuxExecOptions & { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const { stripTmux: _, timeout, ...rest } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return promisify(execFile)(invocation.command, invocation.args, {
    encoding: 'utf-8', env: resolveEnv(opts),
    ...(timeout !== undefined ? { timeout } : {}), ...rest,
  });
}

export function tmuxShell(
  command: string,
  opts?: TmuxExecOptions & Omit<ExecSyncOptionsWithStringEncoding, 'env' | 'encoding'> & { encoding?: BufferEncoding },
): string {
  const { stripTmux: _, ...execOpts } = opts ?? {};
  return execSync(`tmux ${command}`, { encoding: 'utf-8', ...execOpts, env: resolveEnv(opts) }) as string;
}

export async function tmuxShellAsync(
  command: string,
  opts?: TmuxExecOptions & { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const { stripTmux: _, timeout, ...rest } = opts ?? {};
  return promisify(exec)(`tmux ${command}`, {
    encoding: 'utf-8', env: resolveEnv(opts),
    ...(timeout !== undefined ? { timeout } : {}), ...rest,
  });
}

export function tmuxSpawn(
  args: string[],
  opts?: TmuxExecOptions & Omit<SpawnSyncOptionsWithStringEncoding, 'env' | 'encoding'> & { encoding?: BufferEncoding },
): SpawnSyncReturns<string> {
  const { stripTmux: _, ...spawnOpts } = opts ?? {};
  const invocation = resolveTmuxInvocation(args);
  return spawnSync(invocation.command, invocation.args, { encoding: 'utf-8', ...spawnOpts, env: resolveEnv(opts) });
}

export async function tmuxCmdAsync(
  args: string[],
  opts?: TmuxExecOptions & { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  if (args.some(a => a.includes('#{'))) {
    const escaped = args.map(a => "'" + a.replace(/'/g, "'\\''") + "'").join(' ');
    return tmuxShellAsync(escaped, opts);
  }
  return tmuxExecAsync(args, opts);
}

export type ClaudeLaunchPolicy = 'inside-tmux' | 'outside-tmux' | 'direct';

export interface TmuxPaneSnapshot {
  paneId: string;
  currentCommand: string;
  startCommand: string;
}

function resolveTmuxBinaryPath(): string {
  if (process.platform !== 'win32') {
    return 'tmux';
  }

  try {
    const result = spawnSync('where', ['tmux'], {
      timeout: 5000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return 'tmux';

    const candidates = result.stdout
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
    const first = candidates[0];
    if (first && (isAbsolute(first) || win32Path.isAbsolute(first))) {
      return first;
    }
  } catch {
    // 兜底到下方普通的 tmux 查找。
  }

  return 'tmux';
}

/**
 * 检查系统上 tmux 是否可用
 */
export function isTmuxAvailable(): boolean {
  try {
    const resolvedBinary = resolveTmuxBinaryPath();
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedBinary)) {
      const comspec = process.env.COMSPEC || 'cmd.exe';
      const result = spawnSync(comspec, ['/d', '/s', '/c', `"${resolvedBinary}" -V`], { timeout: 5000 });
      return result.status === 0;
    }

    if (process.platform === 'win32') {
      const result = spawnSync(resolvedBinary, ['-V'], { timeout: 5000, shell: true });
      return result.status === 0;
    }

    tmuxExec(['-V'], { stripTmux: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查系统上 claude CLI 是否可用
 */
export function isClaudeAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `resolveLaunchPolicy` 的选项。`requireTmux=true` 使
 * CMUX_SURFACE_ID 不再降级为 'direct'。调用方负责
 * 根据平台/标志组合进行门控 (例如 macOS + --madmax)。
 */
export interface ResolveLaunchPolicyOptions {
  requireTmux?: boolean;
}

/**
 * 根据环境和参数解析启动策略
 * - inside-tmux: 已在 tmux 会话中,为 HUD 切分 pane
 * - outside-tmux: 不在 tmux 中,创建新会话
 * - direct: tmux 不可用,直接运行
 * - direct: 请求了 print 模式,以便 stdout 流向父进程
 */
export function resolveLaunchPolicy(
  env: NodeJS.ProcessEnv = process.env,
  args: string[] = [],
  options: ResolveLaunchPolicyOptions = {},
): ClaudeLaunchPolicy {
  if (args.some((arg) => arg === '--print' || arg === '-p')) {
    return 'direct';
  }
  if (env.TMUX) return 'inside-tmux';
  // 内置自身多路复用器的终端模拟器 (例如 cmux,一个
  // 基于 Ghostty 的终端) 会设置 CMUX_SURFACE_ID 但不设置 TMUX。tmux
  // attach-session 在这些环境中会失败,因为宿主 PTY
  // 不直接兼容,会留下孤立的分离式会话。
  // 降级为 direct,除非调用方明确要求 tmux。
  if (env.CMUX_SURFACE_ID && !options.requireTmux) return 'direct';
  if (!isTmuxAvailable()) {
    return 'direct';
  }
  return 'outside-tmux';
}

/**
 * 根据目录、git 分支和 UTC 时间戳生成 tmux 会话名
 * 格式: wise-{dir}-{branch}-{utctimestamp}
 * 例如  wise-myproject-dev-20260221143052
 */
export function buildTmuxSessionName(cwd: string): string {
  const dirToken = sanitizeTmuxToken(basename(cwd));
  let branchToken = 'detached';

  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (branch) {
      branchToken = sanitizeTmuxToken(branch);
    }
  } catch {
    // 非 git 目录或 git 不可用
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcTimestamp =
    `${now.getUTCFullYear()}` +
    `${pad(now.getUTCMonth() + 1)}` +
    `${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}` +
    `${pad(now.getUTCMinutes())}` +
    `${pad(now.getUTCSeconds())}`;

  const name = `wise-${dirToken}-${branchToken}-${utcTimestamp}`;
  return name.length > 120 ? name.slice(0, 120) : name;
}

/**
 * 净化字符串以便用于 tmux 会话/窗口名
 * 仅允许小写、字母数字 + 连字符
 */
export function sanitizeTmuxToken(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'unknown';
}

/**
 * 为 tmux 构建带正确引号的 shell 命令字符串
 */
export function buildTmuxShellCommand(command: string, args: string[]): string {
  if (isNativeWindowsShell()) {
    return [command, ...args].map(quoteForCmd).join(' ');
  }
  return [quoteShellArg(command), ...args.map(quoteShellArg)].join(' ');
}

export function buildTmuxShellCommandWithEnv(
  command: string,
  args: string[],
  envVars: Record<string, string>,
): string {
  const envEntries = Object.entries(envVars);
  if (envEntries.length === 0) {
    return buildTmuxShellCommand(command, args);
  }

  if (isNativeWindowsShell()) {
    const envPrefix = envEntries
      .map(([key, value]) => `set "${key}=${escapeForCmdSet(value)}"`)
      .join(' && ');
    return `${envPrefix} && ${buildTmuxShellCommand(command, args)}`;
  }

  return buildTmuxShellCommand(
    'env',
    [...envEntries.map(([key, value]) => `${key}=${value}`), command, ...args],
  );
}

/**
 * 用用户的 login shell 包裹命令字符串并加载 RC 文件。
 * 确保 tmux 以命令参数派生新会话或 pane 时,
 * .bashrc/.zshrc 中的 PATH 及其他环境设置可用。
 *
 * tmux new-session / split-window 通过非 login、非交互式
 * shell 运行命令,因此通过 nvm、pyenv、conda 等安装的工具不可见。
 * 此包装器启动 login shell (`-lc`) 并显式加载 RC 文件。
 */
export function wrapWithLoginShell(command: string): string {
  if (isNativeWindowsShell()) {
    const comspec = process.env.COMSPEC || 'cmd.exe';
    return `${quoteForCmd(comspec)} /d /s /c ${quoteForCmd(command)}`;
  }

  const shell = process.env.SHELL || '/bin/sh';
  const shellName = basename(shell).replace(/\.(exe|cmd|bat)$/i, '');
  const rcFile = process.env.HOME ? `${process.env.HOME}/.${shellName}rc` : '';
  const sourcePrefix = rcFile
    ? `[ -f ${quoteShellArg(rcFile)} ] && . ${quoteShellArg(rcFile)}; `
    : '';
  return `exec ${quoteShellArg(shell)} -lc ${quoteShellArg(`${sourcePrefix}${command}`)}`;
}

/**
 * 为 shell 参数加引号以安全执行
 * 使用单引号并做正确的转义
 */
export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * 将 tmux pane 列表输出解析为结构化数据
 */
export function parseTmuxPaneSnapshot(output: string): TmuxPaneSnapshot[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [paneId = '', currentCommand = '', ...startCommandParts] = line.split('\t');
      return {
        paneId: paneId.trim(),
        currentCommand: currentCommand.trim(),
        startCommand: startCommandParts.join('\t').trim(),
      };
    })
    .filter((pane) => pane.paneId.startsWith('%'));
}

/**
 * 检查 pane 是否在运行 HUD watch 命令
 */
export function isHudWatchPane(pane: TmuxPaneSnapshot): boolean {
  const command = `${pane.startCommand} ${pane.currentCommand}`.toLowerCase();
  return /\bhud\b/.test(command)
    && /--watch\b/.test(command)
    && (/\bomc(?:\.js)?\b/.test(command) || /\bnode\b/.test(command));
}

/**
 * 在当前窗口中查找 HUD watch pane ID
 */
export function findHudWatchPaneIds(panes: TmuxPaneSnapshot[], currentPaneId?: string): string[] {
  return panes
    .filter((pane) => pane.paneId !== currentPaneId)
    .filter((pane) => isHudWatchPane(pane))
    .map((pane) => pane.paneId);
}

/**
 * 列出当前 tmux 窗口中的 HUD watch pane
 */
export function listHudWatchPaneIdsInCurrentWindow(currentPaneId?: string): string[] {
  try {
    const output = tmuxExec(
      ['list-panes', '-F', '#{pane_id}\t#{pane_current_command}\t#{pane_start_command}'],
    );
    return findHudWatchPaneIds(parseTmuxPaneSnapshot(output), currentPaneId);
  } catch {
    return [];
  }
}

/**
 * 在当前窗口创建 HUD watch pane
 * 成功返回 pane ID,失败返回 null
 */
export function createHudWatchPane(cwd: string, hudCmd: string): string | null {
  try {
    const wrappedCmd = wrapWithLoginShell(hudCmd);
    const output = tmuxExec(
      ['split-window', '-v', '-l', '4', '-d', '-c', cwd, '-P', '-F', '#{pane_id}', wrappedCmd],
    );
    const paneId = output.split('\n')[0]?.trim() || '';
    return paneId.startsWith('%') ? paneId : null;
  } catch {
    return null;
  }
}

/**
 * 按 ID 杀掉 tmux pane
 */
export function killTmuxPane(paneId: string): void {
  if (!paneId.startsWith('%')) return;
  try {
    tmuxExec(['kill-pane', '-t', paneId], { stdio: 'ignore' });
  } catch {
    // pane 可能已经不在;忽略
  }
}
