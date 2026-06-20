/**
 * wise 原生 tmux shell 启动
 * 启动 Claude Code 并进行 tmux 会话管理
 */

import { execFileSync } from 'child_process';
import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { resolvePluginDirArg } from '../lib/plugin-dir.js';
import { stripRetiredTeamMcpServers } from '../installer/mcp-registry.js';
import { getClaudeConfigDir } from '../utils/config-dir.js';
import {
  resolveLaunchPolicy,
  buildTmuxSessionName,
  buildTmuxShellCommand,
  buildTmuxShellCommandWithEnv,
  isNativeWindowsShell,
  wrapWithLoginShell,
  isClaudeAvailable,
  isTmuxAvailable,
  quoteShellArg,
  tmuxExec,
} from './tmux-utils.js';
import { configureTmuxClipboardForCurrentSession, configureTmuxClipboardForSession } from './tmux-clipboard.js';
import { WISE_PLUGIN_ROOT_ENV } from '../lib/env-vars.js';
import { WISE_CONFIG_FILE_REL } from '../lib/paths.js';

// 标志映射
const MADMAX_FLAG = '--madmax';
const YOLO_FLAG = '--yolo';
const CLAUDE_BYPASS_FLAG = '--dangerously-skip-permissions';
const NOTIFY_FLAG = '--notify';
const OPENCLAW_FLAG = '--openclaw';
const TELEGRAM_FLAG = '--telegram';
const DISCORD_FLAG = '--discord';
const SLACK_FLAG = '--slack';
const WEBHOOK_FLAG = '--webhook';
const WISE_RUNTIME_DIRNAME = '.wise-launch';

function hasWiseMarkers(path: string): boolean {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, 'utf-8');
  return content.includes('<!-- WISE:START -->') && content.includes('<!-- WISE:END -->');
}

function ensureMirroredPath(
  sourcePath: string,
  targetPath: string,
  options: { allowCopyFallback?: boolean } = {},
): void {
  if (!existsSync(sourcePath)) return;

  try {
    const sourceStat = lstatSync(sourcePath);
    const targetExists = existsSync(targetPath);
    if (targetExists) {
      const targetStat = lstatSync(targetPath);
      if (targetStat.isSymbolicLink()) {
        return;
      }
      rmSync(targetPath, { recursive: true, force: true });
    }

    if (sourceStat.isDirectory()) {
      symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
      return;
    }

    symlinkSync(sourcePath, targetPath, 'file');
  } catch {
    if (options.allowCopyFallback === false) {
      return;
    }

    const sourceStat = lstatSync(sourcePath);
    if (sourceStat.isDirectory()) {
      cpSync(sourcePath, targetPath, { recursive: true });
      return;
    }
    copyFileSync(sourcePath, targetPath);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function refreshRuntimeClaudeJsonMcpServers(baseConfigDir: string, runtimeClaudeJsonPath: string): void {
  const sourceClaudeJsonPath = join(dirname(baseConfigDir), '.claude.json');
  const sourceClaudeJson = readJsonObject(sourceClaudeJsonPath);
  if (!sourceClaudeJson || !isJsonObject(sourceClaudeJson.mcpServers)) {
    return;
  }

  const runtimeClaudeJson = readJsonObject(runtimeClaudeJsonPath) ?? {};
  runtimeClaudeJson.mcpServers = sourceClaudeJson.mcpServers;
  writeFileSync(runtimeClaudeJsonPath, JSON.stringify(runtimeClaudeJson, null, 2));
}

export function prepareWiseLaunchConfigDir(baseConfigDir = getClaudeConfigDir()): string {
  const companionPath = join(baseConfigDir, 'CLAUDE-wise.md');
  if (!hasWiseMarkers(companionPath)) {
    return baseConfigDir;
  }

  const runtimeConfigDir = join(baseConfigDir, WISE_RUNTIME_DIRNAME);
  const runtimeClaudeJsonPath = join(runtimeConfigDir, '.claude.json');
  const preservedClaudeJson = existsSync(runtimeClaudeJsonPath)
    ? readFileSync(runtimeClaudeJsonPath)
    : null;

  rmSync(runtimeConfigDir, { recursive: true, force: true });
  mkdirSync(runtimeConfigDir, { recursive: true });
  if (preservedClaudeJson) {
    writeFileSync(runtimeClaudeJsonPath, preservedClaudeJson);
  }
  refreshRuntimeClaudeJsonMcpServers(baseConfigDir, runtimeClaudeJsonPath);
  copyFileSync(companionPath, join(runtimeConfigDir, 'CLAUDE.md'));

  for (const entry of [
    'agents',
    'commands',
    'hooks',
    'hud',
    'plugins',
    'projects',
    'rules',
    'skills',
    'themes',
    WISE_CONFIG_FILE_REL,
    '.wise-version.json',
    '.wise-silent-update.json',
    'keybindings.json',
    'settings.json',
    'settings.local.json',
    '.credentials.json',
  ]) {
    ensureMirroredPath(
      join(baseConfigDir, entry),
      join(runtimeConfigDir, basename(entry)),
      { allowCopyFallback: entry !== '.credentials.json' },
    );
  }

  const runtimeSettingsPath = join(runtimeConfigDir, 'settings.json');
  if (existsSync(runtimeSettingsPath)) {
    try {
      const rawSettings = JSON.parse(readFileSync(runtimeSettingsPath, 'utf-8')) as Record<string, unknown>;
      const repaired = stripRetiredTeamMcpServers(rawSettings);
      if (repaired.changed) {
        writeFileSync(runtimeSettingsPath, JSON.stringify(repaired.settings, null, 2));
      }
    } catch {
      // 尽力而为的兼容性修复;即使旧版
      // settings 文件无法解析或重写,启动也必须继续。
    }
  }

  writeFileSync(
    join(runtimeConfigDir, '.wise-launch-profile.json'),
    JSON.stringify({ sourceConfigDir: baseConfigDir, sourceClaudeMd: companionPath }, null, 2),
  );

  return runtimeConfigDir;
}

function isDefaultClaudeConfigDirPath(configDir: string): boolean {
  return configDir === join(homedir(), '.claude');
}

/**
 * 从启动参数中提取 WISE 专有的 --notify 标志。
 * --notify false  → 关闭通知 (WISE_NOTIFY=0)
 * --notify true   → 开启通知 (默认)
 * 此标志必须在传给 Claude CLI 之前剥离。
 */
export function extractNotifyFlag(args: string[]): { notifyEnabled: boolean; remainingArgs: string[] } {
  let notifyEnabled = true;
  const remainingArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === NOTIFY_FLAG) {
      const next = args[i + 1];
      if (next !== undefined) {
        const lowered = next.toLowerCase();
        if (lowered === 'true' || lowered === 'false' || lowered === '1' || lowered === '0') {
          notifyEnabled = lowered !== 'false' && lowered !== '0';
          i++; // 跳过显式值 token
        }
      }
    } else if (arg.startsWith(`${NOTIFY_FLAG}=`)) {
      const val = arg.slice(NOTIFY_FLAG.length + 1).toLowerCase();
      notifyEnabled = val !== 'false' && val !== '0';
    } else {
      remainingArgs.push(arg);
    }
  }

  return { notifyEnabled, remainingArgs };
}

/**
 * 从启动参数中提取 WISE 专有的 --openclaw 标志。
 * 纯基于存在性判定 (类似 --madmax/--yolo):
 *   --openclaw        -> 开启 OpenClaw (WISE_OPENCLAW=1)
 *   --openclaw=true   -> 开启 OpenClaw
 *   --openclaw=false  -> 关闭 OpenClaw
 *   --openclaw=1      -> 开启 OpenClaw
 *   --openclaw=0      -> 关闭 OpenClaw
 *
 * 不消费下一个位置参数 (没有空格分隔的值)。
 * 此标志必须在传给 Claude CLI 之前剥离。
 */
export function extractOpenClawFlag(args: string[]): { openclawEnabled: boolean | undefined; remainingArgs: string[] } {
  let openclawEnabled: boolean | undefined = undefined;
  const remainingArgs: string[] = [];

  for (const arg of args) {
    if (arg === OPENCLAW_FLAG) {
      // 裸 --openclaw 表示开启 (不消费下一个参数)
      openclawEnabled = true;
      continue;
    }

    if (arg.startsWith(`${OPENCLAW_FLAG}=`)) {
      const val = arg.slice(OPENCLAW_FLAG.length + 1).toLowerCase();
      openclawEnabled = val !== 'false' && val !== '0';
      continue;
    }

    remainingArgs.push(arg);
  }

  return { openclawEnabled, remainingArgs };
}

/**
 * 从启动参数中提取 WISE 专有的 --telegram 标志。
 * 纯基于存在性判定:
 *   --telegram        -> 开启 Telegram 通知 (WISE_TELEGRAM=1)
 *   --telegram=true   -> 开启
 *   --telegram=false  -> 关闭
 *   --telegram=1      -> 开启
 *   --telegram=0      -> 关闭
 *
 * 不消费下一个位置参数 (没有空格分隔的值)。
 * 此标志必须在传给 Claude CLI 之前剥离。
 */
export function extractTelegramFlag(args: string[]): { telegramEnabled: boolean | undefined; remainingArgs: string[] } {
  let telegramEnabled: boolean | undefined = undefined;
  const remainingArgs: string[] = [];
  for (const arg of args) {
    if (arg === TELEGRAM_FLAG) { telegramEnabled = true; continue; }
    if (arg.startsWith(`${TELEGRAM_FLAG}=`)) {
      const val = arg.slice(TELEGRAM_FLAG.length + 1).toLowerCase();
      telegramEnabled = val !== 'false' && val !== '0';
      continue;
    }
    remainingArgs.push(arg);
  }
  return { telegramEnabled, remainingArgs };
}

/**
 * 从启动参数中提取 WISE 专有的 --discord 标志。
 * 纯基于存在性判定:
 *   --discord        -> 开启 Discord 通知 (WISE_DISCORD=1)
 *   --discord=true   -> 开启
 *   --discord=false  -> 关闭
 *   --discord=1      -> 开启
 *   --discord=0      -> 关闭
 *
 * 不消费下一个位置参数 (没有空格分隔的值)。
 * 此标志必须在传给 Claude CLI 之前剥离。
 */
export function extractDiscordFlag(args: string[]): { discordEnabled: boolean | undefined; remainingArgs: string[] } {
  let discordEnabled: boolean | undefined = undefined;
  const remainingArgs: string[] = [];
  for (const arg of args) {
    if (arg === DISCORD_FLAG) { discordEnabled = true; continue; }
    if (arg.startsWith(`${DISCORD_FLAG}=`)) {
      const val = arg.slice(DISCORD_FLAG.length + 1).toLowerCase();
      discordEnabled = val !== 'false' && val !== '0';
      continue;
    }
    remainingArgs.push(arg);
  }
  return { discordEnabled, remainingArgs };
}

/**
 * 从启动参数中提取 WISE 专有的 --slack 标志。
 * 纯基于存在性判定:
 *   --slack        -> 开启 Slack 通知 (WISE_SLACK=1)
 *   --slack=true   -> 开启
 *   --slack=false  -> 关闭
 *   --slack=1      -> 开启
 *   --slack=0      -> 关闭
 *
 * 不消费下一个位置参数 (没有空格分隔的值)。
 * 此标志必须在传给 Claude CLI 之前剥离。
 */
export function extractSlackFlag(args: string[]): { slackEnabled: boolean | undefined; remainingArgs: string[] } {
  let slackEnabled: boolean | undefined = undefined;
  const remainingArgs: string[] = [];
  for (const arg of args) {
    if (arg === SLACK_FLAG) { slackEnabled = true; continue; }
    if (arg.startsWith(`${SLACK_FLAG}=`)) {
      const val = arg.slice(SLACK_FLAG.length + 1).toLowerCase();
      slackEnabled = val !== 'false' && val !== '0';
      continue;
    }
    remainingArgs.push(arg);
  }
  return { slackEnabled, remainingArgs };
}

/**
 * 从启动参数中提取 WISE 专有的 --webhook 标志。
 * 纯基于存在性判定:
 *   --webhook        -> 开启 Webhook 通知 (WISE_WEBHOOK=1)
 *   --webhook=true   -> 开启
 *   --webhook=false  -> 关闭
 *   --webhook=1      -> 开启
 *   --webhook=0      -> 关闭
 *
 * 不消费下一个位置参数 (没有空格分隔的值)。
 * 此标志必须在传给 Claude CLI 之前剥离。
 */
export function extractWebhookFlag(args: string[]): { webhookEnabled: boolean | undefined; remainingArgs: string[] } {
  let webhookEnabled: boolean | undefined = undefined;
  const remainingArgs: string[] = [];
  for (const arg of args) {
    if (arg === WEBHOOK_FLAG) { webhookEnabled = true; continue; }
    if (arg.startsWith(`${WEBHOOK_FLAG}=`)) {
      const val = arg.slice(WEBHOOK_FLAG.length + 1).toLowerCase();
      webhookEnabled = val !== 'false' && val !== '0';
      continue;
    }
    remainingArgs.push(arg);
  }
  return { webhookEnabled, remainingArgs };
}

/**
 * 规范化 Claude 启动参数
 * 将 --madmax/--yolo 映射为 --dangerously-skip-permissions
 * 其余所有标志原样透传
 */
export function normalizeClaudeLaunchArgs(args: string[]): string[] {
  const normalized: string[] = [];
  let wantsBypass = false;
  let hasBypass = false;

  for (const arg of args) {
    if (arg === MADMAX_FLAG || arg === YOLO_FLAG) {
      wantsBypass = true;
      continue;
    }

    if (arg === CLAUDE_BYPASS_FLAG) {
      wantsBypass = true;
      if (!hasBypass) {
        normalized.push(arg);
        hasBypass = true;
      }
      continue;
    }

    normalized.push(arg);
  }

  if (wantsBypass && !hasBypass) {
    normalized.push(CLAUDE_BYPASS_FLAG);
  }

  return normalized;
}

/**
 * preLaunch: Claude 启动前准备环境
 * 目前是占位实现 - 可扩展用于:
 * - 会话状态初始化
 * - 环境准备
 * - 启动前检查
 */
export async function preLaunch(_cwd: string, _sessionId: string): Promise<void> {
  // 未来 pre-launch 逻辑的占位
  // 例如:会话状态、环境准备等
}

/**
 * 检查参数是否包含 --print 或 -p 标志。
 * 处于 print 模式时,Claude 输出到 stdout,不能包裹在 tmux 中
 * (tmux 会捕获 stdout 并阻止向父进程管道传递)。
 */
export function isPrintMode(args: string[]): boolean {
  return args.some((arg) => arg === '--print' || arg === '-p');
}

/**
 * 检测启动参数中原始的 --madmax / --yolo token。用于在
 * normalizeClaudeLaunchArgs 剥离它们之前,让我们可以应用 WISE 专有的
 * 启动契约 (例如 macOS 上强制使用 tmux)。
 */
export function hasMadmaxFlag(args: string[]): boolean {
  return args.some((arg) => arg === MADMAX_FLAG || arg === YOLO_FLAG);
}

class MadmaxTmuxRequiredError extends Error {
  constructor(public readonly reason: 'missing' | 'launch-failed') {
    super(`madmax requires tmux: ${reason}`);
    this.name = 'MadmaxTmuxRequiredError';
  }
}

function abortMadmaxRequiresTmux(reason: 'missing' | 'launch-failed'): never {
  if (reason === 'missing') {
    console.error('[wise] Error: --madmax/--yolo on macOS requires tmux, but tmux is not installed.');
    console.error('  Install it with: brew install tmux');
  } else {
    console.error('[wise] Error: --madmax/--yolo on macOS requires tmux, but launching tmux failed.');
    console.error('  Verify tmux works: tmux -V && tmux new-session -d -s _wise_probe \\; kill-session -t _wise_probe');
  }
  process.exit(1);
  // process.exit 可能被测试拦截;抛出异常保证调用方
  // 停止,并防止意外穿透到直接启动 claude。
  throw new MadmaxTmuxRequiredError(reason);
}

/**
 * runClaude: 启动 Claude CLI (阻塞直到退出)
 * 处理 3 种场景:
 * 1. inside-tmux: 在当前 pane 中启动 claude
 * 2. outside-tmux: 创建包含 claude 的新 tmux 会话
 * 3. direct: tmux 不可用,直接运行 claude
 *
 * 当存在 --print/-p 时,总是直接运行以保留 stdout 管道。
 *
 * 在 macOS 上,`--madmax` (及其别名 `--yolo`) 要求 tmux:若未安装
 * tmux,我们以 brew install 提示退出,而非静默直接启动。
 * 已在 tmux 会话内时复用当前 pane。若 tmux 已安装但
 * new-session/attach-session 失败,我们显式抛出错误,
 * 而非静默降级为 direct 模式。
 */
export function runClaude(cwd: string, args: string[], sessionId: string): void {
  // print 模式必须绕过 tmux,以便 stdout 流向父进程 (issue #1665)
  if (isPrintMode(args)) {
    runClaudeDirect(cwd, args);
    return;
  }

  const requireTmux = process.platform === 'darwin' && hasMadmaxFlag(args);
  try {
    if (requireTmux && !process.env.TMUX && !isTmuxAvailable()) {
      abortMadmaxRequiresTmux('missing');
    }

    const policy = resolveLaunchPolicy(process.env, args, { requireTmux });

    switch (policy) {
      case 'inside-tmux':
        runClaudeInsideTmux(cwd, args);
        break;
      case 'outside-tmux':
        runClaudeOutsideTmux(cwd, args, sessionId, { requireTmux });
        break;
      case 'direct':
        if (requireTmux) {
          abortMadmaxRequiresTmux('missing');
        }
        runClaudeDirect(cwd, args);
        break;
    }
  } catch (err) {
    if (err instanceof MadmaxTmuxRequiredError) {
      // 已通过 stderr + process.exit(1) 上报;吞掉异常,使 mock 了
      // process.exit 的测试框架不会看到这个合成 throw 逃逸出 runClaude。
      return;
    }
    throw err;
  }
}

/**
 * 在已有 tmux 会话中运行 Claude
 * 在当前 pane 中启动 Claude
 */
function runClaudeInsideTmux(cwd: string, args: string[]): void {
  // 在当前 tmux 会话中启用 OSC 52 剪贴板转发和鼠标滚动 (不支持时视为非致命错误)。
  try {
    configureTmuxClipboardForCurrentSession({ stdio: 'ignore' });
  } catch { /* non-fatal — user's tmux may not support these options */ }

  try {
    tmuxExec(['set-option', 'mouse', 'on'], { stdio: 'ignore' });
  } catch { /* non-fatal — user's tmux may not support these options */ }

  // 在当前 pane 中启动 Claude
  try {
    execFileSync('claude', args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number | null };
    if (err.code === 'ENOENT') {
      console.error('[wise] Error: claude CLI not found in PATH.');
      process.exit(1);
    }
    // 透传 Claude 的退出码,以便 wise 不吞掉失败
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

/**
 * 必须转发到 tmux 会话的环境变量。
 * tmux new-session 继承的是 *server* 的环境,而非调用进程的,
 * 因此设置在 process.env 上的变量 (例如启动时的 CLAUDE_CONFIG_DIR)
 * 会被静默丢失。我们将它们作为 `export` 语句注入到运行于
 * tmux pane 内的 shell 命令中,位于 .zshrc/.bashrc 加载 *之后*,
 * 以便我们的值优先。
 */
export const TMUX_ENV_FORWARD = [
  'CLAUDE_CONFIG_DIR',
  'WISE_NOTIFY',
  'WISE_OPENCLAW',
  'WISE_TELEGRAM',
  'WISE_DISCORD',
  'WISE_SLACK',
  'WISE_WEBHOOK',
  WISE_PLUGIN_ROOT_ENV,
];

export function buildEnvExportPrefix(vars: string[]): string {
  const parts: string[] = [];
  for (const name of vars) {
    const value = process.env[name];
    if (value !== undefined) {
      parts.push(`export ${name}=${quoteShellArg(value)}`);
    }
  }
  return parts.length > 0 ? parts.join('; ') + '; ' : '';
}

/**
 * 在 tmux 外运行 Claude - 创建新会话。
 *
 * `requireTmux=true` (macOS 上由 --madmax 设置) 将 tmux 启动失败
 * 从静默降级变为带修复提示的硬错误。
 */
function runClaudeOutsideTmux(
  cwd: string,
  args: string[],
  _sessionId: string,
  options: { requireTmux?: boolean } = {},
): void {
  const forwardedEnv = Object.fromEntries(
    TMUX_ENV_FORWARD
      .map((name) => [name, process.env[name]] as const)
      .filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
  const rawClaudeCmd = isNativeWindowsShell()
    ? buildTmuxShellCommandWithEnv('claude', args, forwardedEnv)
    : buildTmuxShellCommand('claude', args);
  const envPrefix = !isNativeWindowsShell() && Object.keys(forwardedEnv).length > 0
    ? buildEnvExportPrefix(TMUX_ENV_FORWARD)
    : '';
  // 排空 stdin 上挂起的终端 Device Attributes (DA1) 响应。
  // 当 tmux attach-session 发送 DA1 查询时,终端回复
  // \e[?6c,它落入 pty 缓冲区,Claude 读取输入前到达。
  // 短暂 sleep 让响应到达,然后 tcflush 丢弃它。
  // 用 login shell 包裹以便加载 .bashrc/.zshrc (PATH、nvm 等)
  // 环境导出注入在 RC 加载之后,以便覆盖陈旧的 tmux server 环境。
  const preflight = isNativeWindowsShell()
    ? envPrefix
    : `${envPrefix}sleep 0.3; perl -e 'use POSIX;tcflush(0,TCIFLUSH)' 2>/dev/null; `;
  const claudeCmd = wrapWithLoginShell(`${preflight}${rawClaudeCmd}`);
  const sessionName = buildTmuxSessionName(cwd);

  try {
    tmuxExec(['new-session', '-d', '-s', sessionName, '-c', cwd, claudeCmd], { stripTmux: true, stdio: 'inherit' });
  } catch {
    if (options.requireTmux) {
      abortMadmaxRequiresTmux('launch-failed');
    }
    runClaudeDirect(cwd, args);
    return;
  }

  try {
    configureTmuxClipboardForSession(sessionName, { stripTmux: true, stdio: 'ignore' });
  } catch {
    /* 非致命 — 用户的 tmux 可能不支持这些选项 */
  }

  try {
    tmuxExec(['set-option', '-t', sessionName, 'mouse', 'on'], { stripTmux: true, stdio: 'ignore' });
  } catch {
    /* 非致命 — 用户的 tmux 可能不支持这些选项 */
  }

  try {
    tmuxExec(['attach-session', '-t', sessionName], { stripTmux: true, stdio: 'inherit' });
  } catch {
    if (options.requireTmux) {
      abortMadmaxRequiresTmux('launch-failed');
    }
    // 若已分离的会话仍存在,保留它,以免中断的
    // attach 路径 (SSH 断开、终端掉线等) 杀掉或
    // 复制一个有效的 Claude 会话。
    try {
      tmuxExec(['has-session', '-t', sessionName], { stripTmux: true, stdio: 'ignore' });
      return;
    } catch {
      runClaudeDirect(cwd, args);
    }
  }
}

/**
 * 直接运行 Claude (无 tmux)
 * tmux 不可用时的兜底
 */
function runClaudeDirect(cwd: string, args: string[]): void {
  try {
    execFileSync('claude', args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number | null };
    if (err.code === 'ENOENT') {
      console.error('[wise] Error: claude CLI not found in PATH.');
      process.exit(1);
    }
    // 透传 Claude 的退出码,以便 wise 不吞掉失败
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

/**
 * postLaunch: Claude 退出后清理
 * 目前是占位实现 - 可扩展用于:
 * - 会话清理
 * - 状态收尾
 * - 启动后上报
 */
export async function postLaunch(_cwd: string, _sessionId: string): Promise<void> {
  // 未来 post-launch 逻辑的占位
  // 例如:清理、收尾等
}

/**
 * 主启动命令入口
 * 编排三阶段启动: preLaunch -> run -> postLaunch
 */
/**
 * 从启动参数中解析 `--plugin-dir <path>` / `--plugin-dir=<path>` (非消费式)。
 *
 * 找到则返回解析后的绝对路径,否则返回 null。该标志不会从
 * `args` 中移除 — 它仍必须原样转发给 Claude Code 的插件加载器。
 */
export function parsePluginDirArg(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--plugin-dir') {
      const next = args[i + 1];
      if (typeof next === 'string' && next.length > 0) {
        return resolvePluginDirArg(next);
      }
    } else if (typeof a === 'string' && a.startsWith('--plugin-dir=')) {
      const value = a.slice('--plugin-dir='.length);
      if (value.length > 0) {
        return resolvePluginDirArg(value);
      }
    }
  }
  return null;
}

export async function launchCommand(args: string[]): Promise<void> {
  // 捕获 --plugin-dir <path>,以便 HUD 包装器 (以及任何其他依赖环境的
  // Claude Code 子进程) 能通过 WISE_PLUGIN_ROOT 解析活动的插件根目录。
  // 非消费式:该标志仍原样流向 Claude Code。
  const pluginDir = parsePluginDirArg(args);
  if (pluginDir) {
    process.env[WISE_PLUGIN_ROOT_ENV] = pluginDir;
  }

  // 在将剩余参数传给 Claude CLI 之前,提取 WISE 专有的 --notify 标志
  const { notifyEnabled, remainingArgs } = extractNotifyFlag(args);
  if (!notifyEnabled) {
    process.env.WISE_NOTIFY = '0';
  }

  // 提取 WISE 专有的 --openclaw 标志 (基于存在性,不消费值)
  const { openclawEnabled, remainingArgs: argsAfterOpenclaw } = extractOpenClawFlag(remainingArgs);
  if (openclawEnabled === true) {
    process.env.WISE_OPENCLAW = '1';
  } else if (openclawEnabled === false) {
    process.env.WISE_OPENCLAW = '0';
  }

  // 提取 WISE 专有的 --telegram 标志 (基于存在性)
  const { telegramEnabled, remainingArgs: argsAfterTelegram } = extractTelegramFlag(argsAfterOpenclaw);
  if (telegramEnabled === true) {
    process.env.WISE_TELEGRAM = '1';
  } else if (telegramEnabled === false) {
    process.env.WISE_TELEGRAM = '0';
  }

  // 提取 WISE 专有的 --discord 标志 (基于存在性)
  const { discordEnabled, remainingArgs: argsAfterDiscord } = extractDiscordFlag(argsAfterTelegram);
  if (discordEnabled === true) {
    process.env.WISE_DISCORD = '1';
  } else if (discordEnabled === false) {
    process.env.WISE_DISCORD = '0';
  }

  // 提取 WISE 专有的 --slack 标志 (基于存在性)
  const { slackEnabled, remainingArgs: argsAfterSlack } = extractSlackFlag(argsAfterDiscord);
  if (slackEnabled === true) {
    process.env.WISE_SLACK = '1';
  } else if (slackEnabled === false) {
    process.env.WISE_SLACK = '0';
  }

  // 提取 WISE 专有的 --webhook 标志 (基于存在性)
  const { webhookEnabled, remainingArgs: argsAfterWebhook } = extractWebhookFlag(argsAfterSlack);
  if (webhookEnabled === true) {
    process.env.WISE_WEBHOOK = '1';
  } else if (webhookEnabled === false) {
    process.env.WISE_WEBHOOK = '0';
  }

  const cwd = process.cwd();

  // 预检:检查嵌套会话
  if (process.env.CLAUDECODE) {
    console.error('[wise] Error: Already inside a Claude Code session. Nested launches are not supported.');
    process.exit(1);
  }

  // 预检:检查 claude CLI 可用性
  if (!isClaudeAvailable()) {
    console.error('[wise] Error: claude CLI not found. Install Claude Code first:');
    console.error('  npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }

  const launchConfigDir = prepareWiseLaunchConfigDir();
  if (isDefaultClaudeConfigDirPath(launchConfigDir)) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = launchConfigDir;
  }

  const normalizedArgs = normalizeClaudeLaunchArgs(argsAfterWebhook);
  const sessionId = `wise-${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

  // 阶段 1: preLaunch
  try {
    await preLaunch(cwd, sessionId);
  } catch (err) {
    // preLaunch 的错误绝不能阻止 Claude 启动
    console.error(`[wise] preLaunch warning: ${err instanceof Error ? err.message : err}`);
  }

  // 阶段 2: run
  try {
    runClaude(cwd, normalizedArgs, sessionId);
  } finally {
    // 阶段 3: postLaunch
    await postLaunch(cwd, sessionId);
  }
}
