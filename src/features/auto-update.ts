/**
 * 自动更新系统
 *
 * 为 wise 提供版本检查与自动更新功能。
 *
 * 功能：
 * - 检查 GitHub release 的新版本
 * - 自动下载并安装更新
 * - 存储已安装组件的版本元数据
 * - 可配置的更新通知
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { execSync, execFileSync } from 'child_process';
import { TaskTool } from '../hooks/beads-context/types.js';
import {
  install as installWise,
  HOOKS_DIR,
  isProjectScopedPlugin,
  isRunningAsPlugin,
  copyPluginSyncPayload,
  syncInstalledPluginPayload,
} from '../installer/index.js';
import { getClaudeConfigDir } from '../utils/config-dir.js';
import { purgeStalePluginCacheVersions } from '../utils/paths.js';
import type { NotificationConfig } from '../notifications/types.js';
import { isAutoUpdateDisabled } from '../lib/security-config.js';
import { WISE_CONFIG_FILE_REL } from '../lib/paths.js';

/** GitHub 仓库信息 */
export const REPO_OWNER = 'wise-claw';
export const REPO_NAME = 'wise';
export const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
export const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}`;

const CLAUDE_CODE_NPM_PACKAGE = '@anthropic-ai/claude-code';

interface GlobalClaudeCodeInstall {
  status: 'present' | 'absent' | 'unknown';
  version?: string;
  installMethod?: 'npm' | 'native' | 'manual';
  binaryPath?: string;
  error?: string;
}

function npmExecOptions(verbose: boolean = false): {
  encoding: 'utf-8';
  stdio: 'inherit' | 'pipe';
  timeout: number;
  windowsHide?: boolean;
} {
  return {
    encoding: 'utf-8',
    stdio: verbose ? 'inherit' : 'pipe',
    timeout: 120000,
    ...(process.platform === 'win32' ? { windowsHide: true } : {}),
  };
}

function assertSafeNpmPackageSpec(packageSpec: string): void {
  if (!/^[A-Za-z0-9@._~+/-]+$/.test(packageSpec)) {
    throw new Error(`Unsafe npm package spec: ${packageSpec}`);
  }
}

function npmInstallGlobalPackage(packageSpec: string, verbose: boolean = false): void {
  assertSafeNpmPackageSpec(packageSpec);
  if (process.platform === 'win32') {
    execSync(`npm install -g ${packageSpec}`, npmExecOptions(verbose));
    return;
  }

  execFileSync('npm', ['install', '-g', packageSpec], npmExecOptions(verbose));
}

function parseClaudeCodeVersion(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)?.[1];
}

function getFirstResolvedBinaryPath(output: string, binaryName: string): string {
  const resolved = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (!resolved) {
    throw new Error(`Unable to resolve ${binaryName} binary path`);
  }

  return resolved;
}

function resolveClaudeBinaryPath(): string | undefined {
  try {
    if (process.platform === 'win32') {
      return getFirstResolvedBinaryPath(execFileSync('where.exe', ['claude'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
        windowsHide: true,
      }), 'claude');
    }

    return getFirstResolvedBinaryPath(execSync('command -v claude 2>/dev/null || which claude 2>/dev/null', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    }), 'claude');
  } catch {
    return undefined;
  }
}

function detectClaudeCodeFromBinary(npmRoot?: string): GlobalClaudeCodeInstall {
  try {
    const versionOutput = String(execFileSync('claude', ['--version'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
      ...(process.platform === 'win32' ? { shell: true, windowsHide: true } : {}),
    }) ?? '');
    const binaryPath = resolveClaudeBinaryPath();
    const version = parseClaudeCodeVersion(versionOutput);
    if (!version && !binaryPath) {
      return { status: 'unknown', error: 'claude --version returned no parseable version and binary path could not be resolved' };
    }

    const normalizedBinaryPath = binaryPath?.replace(/\\/g, '/').toLowerCase();
    const normalizedNpmRoot = npmRoot?.replace(/\\/g, '/').toLowerCase();
    const isNpmBinary = Boolean(
      normalizedBinaryPath &&
      normalizedNpmRoot &&
      normalizedBinaryPath.startsWith(normalizedNpmRoot.replace(/\/node_modules$/, '')),
    );

    return {
      status: 'present',
      version,
      installMethod: isNpmBinary ? 'npm' : process.platform === 'win32' ? 'native' : 'manual',
      binaryPath,
    };
  } catch (error) {
    return {
      status: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function detectGlobalClaudeCodeInstall(): GlobalClaudeCodeInstall {
  let npmRoot: string | undefined;

  try {
    npmRoot = String(execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
      ...(process.platform === 'win32' ? { windowsHide: true } : {}),
    }) ?? '').trim();
    if (!npmRoot) {
      const binaryInstall = detectClaudeCodeFromBinary();
      return binaryInstall.status === 'present'
        ? binaryInstall
        : { status: 'unknown', error: 'npm root -g returned an empty path' };
    }

    const packageJsonPath = join(npmRoot, '@anthropic-ai', 'claude-code', 'package.json');
    if (!existsSync(packageJsonPath)) {
      const binaryInstall = detectClaudeCodeFromBinary(npmRoot);
      return binaryInstall.status === 'present' ? binaryInstall : { status: 'absent' };
    }

    const packageJson = JSON.parse(String(readFileSync(packageJsonPath, 'utf-8') ?? '')) as {
      version?: unknown;
    };
    return {
      status: 'present',
      version: typeof packageJson.version === 'string' && packageJson.version.trim()
        ? packageJson.version.trim()
        : undefined,
      installMethod: 'npm',
    };
  } catch (error) {
    const binaryInstall = detectClaudeCodeFromBinary(npmRoot);
    if (binaryInstall.status === 'present') {
      return binaryInstall;
    }

    return {
      status: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function restoreGlobalClaudeCodeIfNeeded(
  beforeUpdate: GlobalClaudeCodeInstall,
  verbose: boolean = false,
): { restored: boolean } {
  if (beforeUpdate.status !== 'present' || beforeUpdate.installMethod !== 'npm') {
    return { restored: false };
  }

  if (detectGlobalClaudeCodeInstall().status === 'present') {
    return { restored: false };
  }

  const versionSuffix = beforeUpdate.version ? `@${beforeUpdate.version}` : '@latest';
  const packageSpec = `${CLAUDE_CODE_NPM_PACKAGE}${versionSuffix}`;

  if (verbose) {
    console.log(`[wise update] Restoring global ${packageSpec} after npm update...`);
  }

  npmInstallGlobalPackage(packageSpec, verbose);

  const afterRestore = detectGlobalClaudeCodeInstall();
  if (afterRestore.status !== 'present') {
    throw new Error(`Global ${CLAUDE_CODE_NPM_PACKAGE} was present before update but is still missing after restore`);
  }

  if (verbose) {
    console.log(`[wise update] Restored global ${CLAUDE_CODE_NPM_PACKAGE}`);
  }

  return { restored: true };
}

/**
 * 尽力同步 Claude Code marketplace 克隆。
 * 位于 ~/.claude/plugins/marketplaces/wise/ 的 marketplace 克隆被 Claude Code
 * 用于填充插件缓存。若其过期，`/plugin install` 及缓存重建会重新安装旧版本。
 * （见 #506）
 */
function syncMarketplaceClone(verbose: boolean = false): { ok: boolean; message: string } {
  const marketplacePath = join(getClaudeConfigDir(), 'plugins', 'marketplaces', 'wise');
  if (!existsSync(marketplacePath)) {
    return { ok: true, message: 'Marketplace clone not found; skipping' };
  }

  const stdio = verbose ? 'inherit' : 'pipe';
  const execOpts = { encoding: 'utf-8' as const, stdio: stdio as any, timeout: 60000 };
  const queryExecOpts = { encoding: 'utf-8' as const, stdio: 'pipe' as const, timeout: 60000 };

  try {
    execFileSync('git', ['-C', marketplacePath, 'fetch', '--all', '--prune'], execOpts);
  } catch (err) {
    return { ok: false, message: `Failed to fetch marketplace clone: ${err instanceof Error ? err.message : err}` };
  }

  try {
    execFileSync('git', ['-C', marketplacePath, 'checkout', 'main'], { ...execOpts, timeout: 15000 });
  } catch {
    // 落入下方显式分支校验。
  }

  let currentBranch = '';
  try {
    currentBranch = String(
      execFileSync('git', ['-C', marketplacePath, 'rev-parse', '--abbrev-ref', 'HEAD'], queryExecOpts) ?? ''
    ).trim();
  } catch (err) {
    return { ok: false, message: `Failed to inspect marketplace clone branch: ${err instanceof Error ? err.message : err}` };
  }

  if (currentBranch !== 'main') {
    return {
      ok: false,
      message: `Skipped marketplace clone update: expected branch main but found ${currentBranch || 'unknown'}`,
    };
  }

  let statusOutput = '';
  try {
    statusOutput = String(
      execFileSync('git', ['-C', marketplacePath, 'status', '--porcelain', '--untracked-files=normal'], queryExecOpts) ?? ''
    ).trim();
  } catch (err) {
    return { ok: false, message: `Failed to inspect marketplace clone status: ${err instanceof Error ? err.message : err}` };
  }

  if (statusOutput.length > 0) {
    return {
      ok: false,
      message: 'Skipped marketplace clone update: repo has local modifications; commit, stash, or clean it first',
    };
  }

  let aheadCount = 0;
  let behindCount = 0;
  try {
    const revListOutput = String(
      execFileSync('git', ['-C', marketplacePath, 'rev-list', '--left-right', '--count', 'HEAD...origin/main'], queryExecOpts) ?? ''
    ).trim();
    const [aheadRaw = '0', behindRaw = '0'] = revListOutput.split(/\s+/);
    aheadCount = Number.parseInt(aheadRaw, 10) || 0;
    behindCount = Number.parseInt(behindRaw, 10) || 0;
  } catch (err) {
    return { ok: false, message: `Failed to inspect marketplace clone divergence: ${err instanceof Error ? err.message : err}` };
  }

  if (aheadCount > 0) {
    return {
      ok: false,
      message: 'Skipped marketplace clone update: repo has local commits on main; manual reconciliation required',
    };
  }

  if (behindCount === 0) {
    return { ok: true, message: 'Marketplace clone already up to date' };
  }

  try {
    execFileSync('git', ['-C', marketplacePath, 'merge', '--ff-only', 'origin/main'], execOpts);
  } catch (err) {
    return { ok: false, message: `Failed to fast-forward marketplace clone: ${err instanceof Error ? err.message : err}` };
  }

  return { ok: true, message: 'Marketplace clone updated' };
}

function replaceLastPathSegmentPreservingSeparators(pathValue: string, nextSegment: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return trimmed;
  }

  const trailingSeparator = /[\\/]$/.test(trimmed) ? trimmed.slice(-1) : '';
  const withoutTrailingSeparator = trailingSeparator ? trimmed.slice(0, -1) : trimmed;
  const lastSeparatorIndex = Math.max(withoutTrailingSeparator.lastIndexOf('/'), withoutTrailingSeparator.lastIndexOf('\\'));

  if (lastSeparatorIndex < 0) {
    return `${nextSegment}${trailingSeparator}`;
  }

  return `${withoutTrailingSeparator.slice(0, lastSeparatorIndex + 1)}${nextSegment}${trailingSeparator}`;
}

function deriveUpdatedPluginInstallPath(
  existingInstallPath: string | undefined,
  fallbackInstallPath: string,
  newVersion: string,
): string {
  if (existingInstallPath?.trim()) {
    const normalized = existingInstallPath.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/plugins/cache/') && normalized.includes('/wise/')) {
      return replaceLastPathSegmentPreservingSeparators(existingInstallPath, newVersion);
    }
  }

  return fallbackInstallPath;
}

function writeJsonAtomically(path: string, value: unknown): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // 仅尽力清理；失败时保留原始注册表。
    }
    throw error;
  }
}

function syncInstalledPluginRegistryVersion(
  newVersion: string,
  fallbackInstallPath: string,
): { updated: boolean; errors: string[] } {
  const installedPluginsPath = join(getClaudeConfigDir(), 'plugins', 'installed_plugins.json');
  if (!existsSync(installedPluginsPath)) {
    return { updated: false, errors: [] };
  }

  try {
    const rawText = readFileSync(installedPluginsPath, 'utf-8');
    if (!rawText.trim()) {
      return { updated: false, errors: [] };
    }

    const raw = JSON.parse(rawText) as unknown;
    if (!raw || typeof raw !== 'object') {
      return { updated: false, errors: ['installed_plugins.json has unexpected top-level structure'] };
    }

    const root = raw as Record<string, unknown>;
    const pluginsValue = root.plugins && typeof root.plugins === 'object' ? root.plugins : root;
    const plugins = pluginsValue as Record<string, unknown>;
    let updated = false;

    for (const [pluginId, entriesValue] of Object.entries(plugins)) {
      const normalizedPluginId = pluginId.toLowerCase();
      const isWisePlugin = normalizedPluginId === 'wise@wise'
        || normalizedPluginId === 'wise';
      if (!isWisePlugin || !Array.isArray(entriesValue)) {
        continue;
      }

      for (const entry of entriesValue) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const pluginEntry = entry as Record<string, unknown>;
        const existingInstallPath = typeof pluginEntry.installPath === 'string' ? pluginEntry.installPath : undefined;
        pluginEntry.version = newVersion;
        pluginEntry.installPath = deriveUpdatedPluginInstallPath(existingInstallPath, fallbackInstallPath, newVersion);
        updated = true;
      }
    }

    if (!updated) {
      return { updated: false, errors: [] };
    }

    writeJsonAtomically(installedPluginsPath, raw);
    return { updated: true, errors: [] };
  } catch (error) {
    return {
      updated: false,
      errors: [`Failed to update installed_plugins.json: ${error instanceof Error ? error.message : error}`],
    };
  }
}

function syncActivePluginCache(): { synced: boolean; errors: string[] } {
  const result = syncInstalledPluginPayload();

  if (result.synced) {
    console.log('[wise update] Synced plugin cache');
  }

  return result;
}

export function shouldBlockStandaloneUpdateInCurrentSession(): boolean {
  if (!isRunningAsPlugin()) {
    return false;
  }

  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT?.trim();
  if (entrypoint) {
    return true;
  }

  const sessionId = process.env.CLAUDE_SESSION_ID?.trim() || process.env.CLAUDECODE_SESSION_ID?.trim();
  if (sessionId) {
    return true;
  }

  return false;
}

export function syncPluginCache(verbose: boolean = false): { synced: boolean; skipped: boolean; errors: string[] } {
  const pluginCacheRoot = join(getClaudeConfigDir(), 'plugins', 'cache', 'wise', 'wise');
  if (!existsSync(pluginCacheRoot)) {
    return { synced: false, skipped: true, errors: [] };
  }

  try {
    const npmRoot = String(execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000,
      ...(process.platform === 'win32' ? { windowsHide: true } : {}),
    }) ?? '').trim();

    if (!npmRoot) {
      throw new Error('npm root -g returned an empty path');
    }

    const sourceRoot = join(npmRoot, 'wise');
    const packageJsonPath = join(sourceRoot, 'package.json');
    const packageJsonRaw = String(readFileSync(packageJsonPath, 'utf-8') ?? '');
    const packageMetadata = JSON.parse(packageJsonRaw) as { version?: unknown };
    const version = typeof packageMetadata.version === 'string' ? packageMetadata.version.trim() : '';
    if (!version) {
      throw new Error(`Missing version in ${packageJsonPath}`);
    }

    const versionedPluginCacheRoot = join(pluginCacheRoot, version);
    mkdirSync(versionedPluginCacheRoot, { recursive: true });

    const result = copyPluginSyncPayload(sourceRoot, [versionedPluginCacheRoot]);

    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.warn(`[wise update] Plugin cache sync warning: ${error}`);
      }
    }

    if (result.synced && result.errors.length === 0) {
      // 在缓存拷贝成功后保留 Claude Code 的插件注册表更新。
      // 若拷贝失败，installed_plugins.json 保持不变，以免会话指向仅部分刷新的
      // 版本目录。
      const registryResult = syncInstalledPluginRegistryVersion(version, versionedPluginCacheRoot);
      result.errors.push(...registryResult.errors);
      if (registryResult.updated && verbose) {
        console.log('[wise update] Updated Claude plugin registry');
      }
    }

    if (result.synced) {
      console.log('[wise update] Plugin cache synced');
    }

    return { ...result, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (verbose) {
      console.warn(`[wise update] Plugin cache sync warning: ${message}`);
    } else {
      console.warn('[wise update] Plugin cache sync warning:', message);
    }
    return { synced: false, skipped: false, errors: [message] };
  }
}

/** 安装路径（遵循 CLAUDE_CONFIG_DIR 环境变量） */
export const CLAUDE_CONFIG_DIR = getClaudeConfigDir();
export const VERSION_FILE = join(CLAUDE_CONFIG_DIR, '.wise-version.json');
export const CONFIG_FILE = join(CLAUDE_CONFIG_DIR, WISE_CONFIG_FILE_REL);

/**
 * 用于文件日志的 Stop hook 回调配置
 */
export interface StopCallbackFileConfig {
  enabled: boolean;
  /** 带占位符的文件路径：{session_id}、{date}、{time} */
  path: string;
  /** 输出格式 */
  format?: 'markdown' | 'json';
}

/**
 * 用于 Telegram 的 Stop hook 回调配置
 */
export interface StopCallbackTelegramConfig {
  enabled: boolean;
  /** Telegram bot token */
  botToken?: string;
  /** 发送消息的目标 Chat ID */
  chatId?: string;
  /** 可选的标签/用户名，作为通知前缀 */
  tagList?: string[];
}

/**
 * 用于 Discord 的 Stop hook 回调配置
 */
export interface StopCallbackDiscordConfig {
  enabled: boolean;
  /** Discord webhook URL */
  webhookUrl?: string;
  /** 可选的标签/用户 ID/角色，作为通知前缀 */
  tagList?: string[];
}

/**
 * 用于 Slack 的 Stop hook 回调配置
 */
export interface StopCallbackSlackConfig {
  enabled: boolean;
  /** Slack incoming webhook URL */
  webhookUrl?: string;
  /** 可选的标签/提及，包含在通知中 */
  tagList?: string[];
}

/**
 * Stop hook 回调配置
 */
export interface StopHookCallbacksConfig {
  file?: StopCallbackFileConfig;
  telegram?: StopCallbackTelegramConfig;
  discord?: StopCallbackDiscordConfig;
  slack?: StopCallbackSlackConfig;
}

/**
 * WISE 配置（存储于 .wise-config.json）
 */
export interface WiseConfig {
  /** 是否启用静默自动更新（出于安全需显式启用） */
  silentAutoUpdate: boolean;
  /** 配置设置时间 */
  configuredAt?: string;
  /** 配置 schema 版本 */
  configVersion?: number;
  /** 首选任务管理工具 */
  taskTool?: TaskTool;
  /** 所选任务工具的配置 */
  taskToolConfig?: {
    /** 使用 beads-mcp 替代 CLI */
    useMcp?: boolean;
    /** 在会话开始时注入使用说明（默认：true） */
    injectInstructions?: boolean;
  };
  /** 初始设置是否已完成（ISO 时间戳） */
  setupCompleted?: string;
  /** 已完成的设置向导版本 */
  setupVersion?: string;
  /** Stop hook 回调配置（旧版，请改用 notifications） */
  stopHookCallbacks?: StopHookCallbacksConfig;
  /** 多平台生命周期通知配置 */
  notifications?: NotificationConfig;
  /** 命名的通知配置档案（以档案名作键） */
  notificationProfiles?: Record<string, NotificationConfig>;
  /** 是否启用 HUD statusline（默认：true）。设为 false 则跳过 HUD 安装。 */
  hudEnabled?: boolean;
  /** 会话开始且新版本可用时是否提示升级（默认：true）。
   *  设为 false 则显示被动通知而非交互式提示。 */
  autoUpgradePrompt?: boolean;
  /** 设置时检测到的 Node.js 二进制绝对路径。
   *  供 find-node.sh 使用，以便 node 不在 PATH 中的 nvm/fnm 用户也能正常运行 hook。 */
  nodeBinary?: string;
}

/**
 * 读取 WISE 配置
 */
export function getWiseConfig(): WiseConfig {
  if (!existsSync(CONFIG_FILE)) {
    // 无配置文件 = 出于安全默认禁用
    return { silentAutoUpdate: false };
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as WiseConfig;
    return {
      silentAutoUpdate: config.silentAutoUpdate ?? false,
      configuredAt: config.configuredAt,
      configVersion: config.configVersion,
      taskTool: config.taskTool,
      taskToolConfig: config.taskToolConfig,
      setupCompleted: config.setupCompleted,
      setupVersion: config.setupVersion,
      stopHookCallbacks: config.stopHookCallbacks,
      notifications: config.notifications,
      notificationProfiles: config.notificationProfiles,
      hudEnabled: config.hudEnabled,
      autoUpgradePrompt: config.autoUpgradePrompt,
      nodeBinary: config.nodeBinary,
    };
  } catch {
    // 若配置文件非法，出于安全默认禁用
    return { silentAutoUpdate: false };
  }
}

/**
 * 检查是否启用静默自动更新
 */
export function isSilentAutoUpdateEnabled(): boolean {
  if (isAutoUpdateDisabled()) return false;
  return getWiseConfig().silentAutoUpdate;
}

/**
 * 检查会话开始时是否启用自动升级提示
 * 默认返回 true——用户必须显式关闭
 */
export function isAutoUpgradePromptEnabled(): boolean {
  return getWiseConfig().autoUpgradePrompt !== false;
}

/**
 * 检查是否启用 team 功能
 * 默认返回 false——需显式启用
 * 先检查 ~/.claude/settings.json，再回退到环境变量
 */
export function isTeamEnabled(): boolean {
  try {
    const settingsPath = join(CLAUDE_CONFIG_DIR, 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const val = settings.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      if (val === '1' || val === 'true') {
        return true;
      }
    }
  } catch {
    // 落入下方环境变量检查
  }
  const envVal = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  return envVal === '1' || envVal === 'true';
}

/**
 * 安装后存储的版本元数据
 */
export interface VersionMetadata {
  /** 当前已安装版本 */
  version: string;
  /** 安装时间戳 */
  installedAt: string;
  /** 上次更新检查的时间戳 */
  lastCheckAt?: string;
  /** 若从源码安装，对应的 Git commit hash */
  commitHash?: string;
  /** 安装方式：'script' | 'npm' | 'source' */
  installMethod: 'script' | 'npm' | 'source';
}

/**
 * GitHub release 信息
 */
export interface ReleaseInfo {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
}

/**
 * 更新检查结果
 */
export interface UpdateCheckResult {
  currentVersion: string | null;
  latestVersion: string;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo;
  releaseNotes: string;
}

/**
 * 更新结果
 */
export interface UpdateResult {
  success: boolean;
  previousVersion: string | null;
  newVersion: string;
  message: string;
  errors?: string[];
}

export interface UpdateReconcileResult {
  success: boolean;
  message: string;
  errors?: string[];
}

/**
 * 读取当前版本元数据
 */
export function getInstalledVersion(): VersionMetadata | null {
  if (!existsSync(VERSION_FILE)) {
    // 若经 npm 安装，尝试从 package.json 检测版本
    try {
      // 检查能否在 node_modules 中找到该包
      const result = execSync('npm list -g wise --json', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe'
      });
      const data = JSON.parse(result);
      if (data.dependencies?.['wise']?.version) {
        return {
          version: data.dependencies['wise'].version,
          installedAt: new Date().toISOString(),
          installMethod: 'npm'
        };
      }
    } catch {
      // 未通过 npm 安装，或命令执行失败
    }
    return null;
  }

  try {
    const content = readFileSync(VERSION_FILE, 'utf-8');
    return JSON.parse(content) as VersionMetadata;
  } catch (error) {
    console.error('Error reading version file:', error);
    return null;
  }
}

/**
 * 安装/更新后保存版本元数据
 */
export function saveVersionMetadata(metadata: VersionMetadata): void {
  const dir = dirname(VERSION_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(VERSION_FILE, JSON.stringify(metadata, null, 2));
}

/**
 * 更新上次检查的时间戳
 */
export function updateLastCheckTime(): void {
  const current = getInstalledVersion();
  if (current) {
    current.lastCheckAt = new Date().toISOString();
    saveVersionMetadata(current);
  }
}

function getGitHubUpdateToken(): string | null {
  const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  return token || null;
}

function getGitHubReleaseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'wise-updater'
  };

  const token = getGitHubUpdateToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getHeader(response: Response, name: string): string | null {
  return response.headers?.get(name) ?? response.headers?.get(name.toLowerCase()) ?? null;
}

function formatRateLimitReset(resetHeader: string | null): string | null {
  if (!resetHeader) {
    return null;
  }

  const resetSeconds = Number.parseInt(resetHeader, 10);
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
    return null;
  }

  return new Date(resetSeconds * 1000).toISOString();
}

async function formatGitHubReleaseFetchError(response: Response, usedToken: boolean): Promise<string> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  const remaining = getHeader(response, 'x-ratelimit-remaining');
  const resetAt = formatRateLimitReset(getHeader(response, 'x-ratelimit-reset'));
  const bodyLooksRateLimited = /rate limit|api rate limit|secondary rate/i.test(body);
  const isRateLimited =
    response.status === 429 ||
    (response.status === 403 && (remaining === '0' || bodyLooksRateLimited));

  if (!isRateLimited) {
    return `Failed to fetch release info: ${response.status} ${response.statusText}`;
  }

  const retrySuffix = resetAt ? ` Try again after ${resetAt}.` : '';
  const authHint = usedToken
    ? 'The configured GitHub token appears to be rate limited; verify the token or try again later.'
    : 'Set GH_TOKEN or GITHUB_TOKEN to use authenticated GitHub API requests and increase rate limits.';

  return `Failed to fetch release info: GitHub API rate limit exceeded (${response.status} ${response.statusText}). ${authHint}${retrySuffix}`;
}

/**
 * 从 GitHub 获取最新 release
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const usedToken = getGitHubUpdateToken() !== null;
  const response = await fetch(`${GITHUB_API_URL}/releases/latest`, {
    headers: getGitHubReleaseHeaders()
  });

  if (response.status === 404) {
    // 未找到 release——尝试从仓库中的 package.json 获取版本
    const pkgResponse = await fetch(`${GITHUB_RAW_URL}/main/package.json`, {
      headers: {
        'User-Agent': 'wise-updater'
      }
    });

    if (pkgResponse.ok) {
      const pkg = await pkgResponse.json() as { version: string };
      return {
        tag_name: `v${pkg.version}`,
        name: `Version ${pkg.version}`,
        published_at: new Date().toISOString(),
        html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
        body: 'No release notes available (fetched from package.json)',
        prerelease: false,
        draft: false
      };
    }

    throw new Error('No releases found and could not fetch package.json');
  }

  if (!response.ok) {
    throw new Error(await formatGitHubReleaseFetchError(response, usedToken));
  }

  return await response.json() as ReleaseInfo;
}

/**
 * 比较语义化版本
 * 返回：a < b 为 -1，a == b 为 0，a > b 为 1
 */
export function compareVersions(a: string, b: string): number {
  // 若存在 'v' 前缀则移除
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');

  const partsA = cleanA.split('.').map(n => parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map(n => parseInt(n, 10) || 0);

  const maxLength = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLength; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

/**
 * 检查可用更新
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const installed = getInstalledVersion();
  const release = await fetchLatestRelease();

  const currentVersion = installed?.version ?? null;
  const latestVersion = release.tag_name.replace(/^v/, '');

  const updateAvailable = currentVersion === null || compareVersions(currentVersion, latestVersion) < 0;

  // 更新上次检查时间
  updateLastCheckTime();

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseInfo: release,
    releaseNotes: release.body || 'No release notes available.'
  };
}

/**
 * 更新后对账运行时状态
 *
 * 可安全重复执行，刷新可能落后于已更新包或插件缓存的本地运行时产物。
 */
export function reconcileUpdateRuntime(options?: { verbose?: boolean; skipGracePeriod?: boolean }): UpdateReconcileResult {
  const errors: string[] = [];

  const projectScopedPlugin = isProjectScopedPlugin();
  // 插件安装会执行 <pluginRoot>/hooks/hooks.json 中的 hook。在 `wise update` 时
  // 重新运行独立的 settings.json hook 合并，会重新注入旧版 ~/.claude/hooks/*
  // 条目，导致 hook 重复执行。
  //
  // 对账仍应刷新共享安装器产物（CLAUDE.md、HUD、MCP 注册表、statusLine 等），
  // 但对于插件安装，必须保持 settings.json 的 hook 所有权不变，使插件 hook
  // 清单仍是唯一事实来源。
  const shouldRefreshPluginHooks = false;

  if (!projectScopedPlugin) {
    try {
      if (!existsSync(HOOKS_DIR)) {
        mkdirSync(HOOKS_DIR, { recursive: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to prepare hooks directory: ${message}`);
    }
  }

  try {
    const installResult = installWise({
      force: true,
      verbose: options?.verbose ?? false,
      skipClaudeCheck: true,
      forceHooks: shouldRefreshPluginHooks,
      refreshHooksInPlugin: shouldRefreshPluginHooks,
    });

    if (!installResult.success) {
      errors.push(...installResult.errors);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to refresh installer artifacts: ${message}`);
  }

  try {
    const pluginSyncResult = syncActivePluginCache();
    if (pluginSyncResult.errors.length > 0) {
      errors.push(...pluginSyncResult.errors.map(err => `Plugin cache sync failed: ${err}`));
      if (options?.verbose) {
        for (const err of pluginSyncResult.errors) {
          console.warn(`[wise] Plugin cache sync error: ${err}`);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Plugin cache sync failed: ${message}`);
    if (options?.verbose) {
      console.warn(`[wise] Plugin cache sync error: ${message}`);
    }
  }

  // 清理过期插件缓存版本（非致命）
  try {
    const purgeResult = purgeStalePluginCacheVersions({ skipGracePeriod: options?.skipGracePeriod });
    if (purgeResult.removed > 0 && options?.verbose) {
      console.log(`[wise] Purged ${purgeResult.removed} stale plugin cache version(s)`);
    }
    if (purgeResult.errors.length > 0 && options?.verbose) {
      for (const err of purgeResult.errors) {
        console.warn(`[wise] Cache purge warning: ${err}`);
      }
    }
  } catch {
    // 缓存清理为尽力而为；绝不阻塞对账
  }

  if (errors.length > 0) {
    return {
      success: false,
      message: 'Runtime reconciliation failed',
      errors,
    };
  }

  return {
    success: true,
    message: 'Runtime state reconciled successfully',
  };
}

function resolveWiseBinaryPath(): string {
  if (process.platform === 'win32') {
    return getFirstResolvedBinaryPath(execFileSync('where.exe', ['wise.cmd'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
      windowsHide: true,
    }), 'wise');
  }

  return getFirstResolvedBinaryPath(execSync('which wise 2>/dev/null || where wise 2>NUL', {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 5000,
  }), 'wise');
}

/**
 * 下载并执行安装脚本以完成更新
 */
export async function performUpdate(options?: {
  skipConfirmation?: boolean;
  verbose?: boolean;
  standalone?: boolean;
  clean?: boolean;
}): Promise<UpdateResult> {
  const installed = getInstalledVersion();
  const previousVersion = installed?.version ?? null;

  try {
    // 仅在活动的 Claude Code/插件会话中阻止 npm 更新。
    // 独立终端可能继承了 CLAUDE_PLUGIN_ROOT，仍应允许更新。
    if (shouldBlockStandaloneUpdateInCurrentSession() && !options?.standalone) {
      return {
        success: false,
        previousVersion,
        newVersion: 'unknown',
        message: 'Running inside an active Claude Code plugin session. Use "/plugin install wise" to update, or pass --standalone to force npm update.',
      };
    }

    // 获取最新 release 以取得版本号
    const release = await fetchLatestRelease();
    const newVersion = release.tag_name.replace(/^v/, '');
    const claudeCodeBeforeUpdate = detectGlobalClaudeCodeInstall();

    // 所有平台均使用 npm 进行更新（install.sh 已移除）
    try {
      execSync('npm install -g wise@latest', npmExecOptions(options?.verbose ?? false));

      try {
        restoreGlobalClaudeCodeIfNeeded(claudeCodeBeforeUpdate, options?.verbose ?? false);
      } catch (restoreError) {
        return {
          success: false,
          previousVersion,
          newVersion,
          message: `Updated to ${newVersion}, but failed to restore global ${CLAUDE_CODE_NPM_PACKAGE}`,
          errors: [restoreError instanceof Error ? restoreError.message : String(restoreError)],
        };
      }

      // 同步 Claude Code marketplace 克隆，使插件缓存获取新版本（#506）
      const marketplaceSync = syncMarketplaceClone(options?.verbose ?? false);
      if (!marketplaceSync.ok && options?.verbose) {
        console.warn(`[wise update] ${marketplaceSync.message}`);
      }

      const pluginCacheSync = syncPluginCache(options?.verbose ?? false);
      if (pluginCacheSync.errors.length > 0 && options?.verbose) {
        for (const error of pluginCacheSync.errors) {
          console.warn(`[wise update] Plugin cache sync warning: ${error}`);
        }
      }

      // 关键修复：npm 更新全局包后，当前进程内存中仍加载着旧代码。必须
      // re-exec 以用新代码运行对账。否则 installWise() 会用旧逻辑处理新文件。
      if (!process.env.WISE_UPDATE_RECONCILE) {
        // 设置标志以防止无限循环
        process.env.WISE_UPDATE_RECONCILE = '1';

        // 查找 wise 二进制路径
        const wisePath = resolveWiseBinaryPath();

        // 通过 reconcile 子命令重新执行
        try {
          execFileSync(wisePath, ['update-reconcile', ...(options?.clean ? ['--skip-grace-period'] : [])], {
            encoding: 'utf-8',
            stdio: options?.verbose ? 'inherit' : 'pipe',
            timeout: 60000,
            env: { ...process.env, WISE_UPDATE_RECONCILE: '1' },
            ...(process.platform === 'win32' ? { windowsHide: true, shell: true } : {}),
          });
        } catch (reconcileError) {
          return {
            success: false,
            previousVersion,
            newVersion,
            message: `Updated to ${newVersion}, but runtime reconciliation failed`,
            errors: [reconcileError instanceof Error ? reconcileError.message : String(reconcileError)],
          };
        }

        // 对账成功后更新版本元数据
        saveVersionMetadata({
          version: newVersion,
          installedAt: new Date().toISOString(),
          installMethod: 'npm',
          lastCheckAt: new Date().toISOString()
        });

        return {
          success: true,
          previousVersion,
          newVersion,
          message: `Successfully updated from ${previousVersion ?? 'unknown'} to ${newVersion}`
        };
      } else {
        // 已处于 re-exec 进程中——直接运行对账
        const reconcileResult = reconcileUpdateRuntime({ verbose: options?.verbose, skipGracePeriod: options?.clean });
        if (!reconcileResult.success) {
          return {
            success: false,
            previousVersion,
            newVersion,
            message: `Updated to ${newVersion}, but runtime reconciliation failed`,
            errors: reconcileResult.errors?.map(e => `Reconciliation failed: ${e}`),
          };
        }
        return {
          success: true,
          previousVersion,
          newVersion,
          message: 'Reconciliation completed successfully'
        };
      }
    } catch (npmError) {
      throw new Error(
        'Auto-update via npm failed. Please run manually:\n' +
        '  npm install -g wise@latest\n' +
        'Or use: /plugin install wise\n' +
        `Error: ${npmError instanceof Error ? npmError.message : npmError}`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      previousVersion,
      newVersion: 'unknown',
      message: `Update failed: ${errorMessage}`,
      errors: [errorMessage]
    };
  }
}

/**
 * 获取格式化的更新通知消息
 */
export function formatUpdateNotification(checkResult: UpdateCheckResult): string {
  if (!checkResult.updateAvailable) {
    return `wise is up to date (v${checkResult.currentVersion ?? 'unknown'})`;
  }

  const lines = [
    '╔═══════════════════════════════════════════════════════════╗',
    '║           wise Update Available!              ║',
    '╚═══════════════════════════════════════════════════════════╝',
    '',
    `  Current version: ${checkResult.currentVersion ?? 'unknown'}`,
    `  Latest version:  ${checkResult.latestVersion}`,
    '',
    '  To update, run: /update',
    '  Or reinstall via: /plugin install wise',
    ''
  ];

  // 若有可用 release notes 则添加（截断显示）
  if (checkResult.releaseNotes && checkResult.releaseNotes !== 'No release notes available.') {
    lines.push('  Release notes:');
    const notes = checkResult.releaseNotes.split('\n').slice(0, 5);
    notes.forEach(line => lines.push(`    ${line}`));
    if (checkResult.releaseNotes.split('\n').length > 5) {
      lines.push('    ...');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 检查距上次更新检查是否已过足够时间
 */
export function shouldCheckForUpdates(intervalHours: number = 24): boolean {
  const installed = getInstalledVersion();

  if (!installed?.lastCheckAt) {
    return true;
  }

  const lastCheck = new Date(installed.lastCheckAt).getTime();
  const now = Date.now();
  const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);

  return hoursSinceLastCheck >= intervalHours;
}

/**
 * 执行后台更新检查（非阻塞）
 */
export function backgroundUpdateCheck(callback?: (result: UpdateCheckResult) => void): void {
  if (!shouldCheckForUpdates()) {
    return;
  }

  // 异步执行检查，不阻塞
  checkForUpdates()
    .then(result => {
      if (callback) {
        callback(result);
      } else if (result.updateAvailable) {
        // 默认行为：将通知打印到控制台
        console.log('\n' + formatUpdateNotification(result));
      }
    })
    .catch(error => {
      // 静默忽略后台检查中的错误
      if (process.env.WISE_DEBUG) {
        console.error('Background update check failed:', error);
      }
    });
}

/**
 * CLI 辅助：执行交互式更新
 */
export async function interactiveUpdate(): Promise<void> {
  console.log('Checking for updates...');

  try {
    const checkResult = await checkForUpdates();

    if (!checkResult.updateAvailable) {
      console.log(`✓ You are running the latest version (${checkResult.currentVersion})`);
      return;
    }

    console.log(formatUpdateNotification(checkResult));
    console.log('Starting update...\n');

    const result = await performUpdate({ verbose: true });

    if (result.success) {
      console.log(`\n✓ ${result.message}`);
      console.log('\nPlease restart your Claude Code session to use the new version.');
    } else {
      console.error(`\n✗ ${result.message}`);
      if (result.errors) {
        result.errors.forEach(err => console.error(`  - ${err}`));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('Update check failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 静默自动更新配置
 */
export interface SilentUpdateConfig {
  /** 更新检查之间的最小间隔小时数（默认：24） */
  checkIntervalHours?: number;
  /** 是否无需确认自动应用更新（默认：true） */
  autoApply?: boolean;
  /** 静默更新活动的日志文件路径（可选） */
  logFile?: string;
  /** 失败时的最大重试次数（默认：3） */
  maxRetries?: number;
}

/** 用于跟踪静默更新状态的文件 */
const SILENT_UPDATE_STATE_FILE = join(CLAUDE_CONFIG_DIR, '.wise-silent-update.json');

interface SilentUpdateState {
  lastAttempt?: string;
  lastSuccess?: string;
  consecutiveFailures: number;
  pendingRestart: boolean;
  lastVersion?: string;
}

/**
 * 读取静默更新状态
 */
function getSilentUpdateState(): SilentUpdateState {
  if (!existsSync(SILENT_UPDATE_STATE_FILE)) {
    return { consecutiveFailures: 0, pendingRestart: false };
  }
  try {
    return JSON.parse(readFileSync(SILENT_UPDATE_STATE_FILE, 'utf-8'));
  } catch {
    return { consecutiveFailures: 0, pendingRestart: false };
  }
}

/**
 * 保存静默更新状态
 */
function saveSilentUpdateState(state: SilentUpdateState): void {
  const dir = dirname(SILENT_UPDATE_STATE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(SILENT_UPDATE_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * 将消息记录到静默更新日志文件（若已配置）
 */
function silentLog(message: string, logFile?: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  if (logFile) {
    try {
      const dir = dirname(logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(logFile, logMessage, { flag: 'a' });
    } catch {
      // 静默忽略日志错误
    }
  }
}

/**
 * 执行完全静默的更新检查与安装
 *
 * 此函数运行时无任何用户交互或控制台输出。
 * 设计为从 hook 或启动脚本调用，以在用户无感知的情况下自动保持系统更新。
 *
 * 功能：
 * - 限流以避免过度频繁检查
 * - 失败时指数退避
 * - 可选写入文件日志用于调试
 * - 跟踪待重启状态
 *
 * @param config - 静默更新配置
 * @returns Promise，解析为更新结果；若跳过则为 null
 */
export async function silentAutoUpdate(config: SilentUpdateConfig = {}): Promise<UpdateResult | null> {
  const {
    checkIntervalHours = 24,
    autoApply = true,
    logFile = join(CLAUDE_CONFIG_DIR, '.wise-update.log'),
    maxRetries = 3
  } = config;

  // 安全：检查配置中是否启用静默自动更新
  // 默认禁用——用户须在安装期间显式启用
  if (!isSilentAutoUpdateEnabled()) {
    silentLog('Silent auto-update is disabled (run installer to enable, or use /update)', logFile);
    return null;
  }

  const state = getSilentUpdateState();

  // 检查限流
  if (!shouldCheckForUpdates(checkIntervalHours)) {
    return null;
  }

  // 检查连续失败次数并应用指数退避
  if (state.consecutiveFailures >= maxRetries) {
    const backoffHours = Math.min(24 * state.consecutiveFailures, 168); // 最长 1 周
    const lastAttempt = state.lastAttempt ? new Date(state.lastAttempt).getTime() : 0;
    const hoursSinceLastAttempt = (Date.now() - lastAttempt) / (1000 * 60 * 60);

    if (hoursSinceLastAttempt < backoffHours) {
      silentLog(`Skipping update check (in backoff period: ${backoffHours}h)`, logFile);
      return null;
    }
  }

  silentLog('Starting silent update check...', logFile);
  state.lastAttempt = new Date().toISOString();

  try {
    // 检查更新
    const checkResult = await checkForUpdates();

    if (!checkResult.updateAvailable) {
      silentLog(`No update available (current: ${checkResult.currentVersion})`, logFile);
      state.consecutiveFailures = 0;
      state.pendingRestart = false;
      saveSilentUpdateState(state);
      return null;
    }

    silentLog(`Update available: ${checkResult.currentVersion} -> ${checkResult.latestVersion}`, logFile);

    if (!autoApply) {
      silentLog('Auto-apply disabled, skipping installation', logFile);
      return null;
    }

    // 静默执行更新
    const result = await performUpdate({
      skipConfirmation: true,
      verbose: false
    });

    if (result.success) {
      silentLog(`Update successful: ${result.previousVersion} -> ${result.newVersion}`, logFile);
      state.consecutiveFailures = 0;
      state.pendingRestart = true;
      state.lastSuccess = new Date().toISOString();
      state.lastVersion = result.newVersion;
      saveSilentUpdateState(state);
      return result;
    } else {
      silentLog(`Update failed: ${result.message}`, logFile);
      state.consecutiveFailures++;
      saveSilentUpdateState(state);
      return result;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    silentLog(`Update check error: ${errorMessage}`, logFile);
    state.consecutiveFailures++;
    saveSilentUpdateState(state);
    return {
      success: false,
      previousVersion: null,
      newVersion: 'unknown',
      message: `Silent update failed: ${errorMessage}`,
      errors: [errorMessage]
    };
  }
}

/**
 * 检查静默更新后是否存在待重启状态
 */
export function hasPendingUpdateRestart(): boolean {
  const state = getSilentUpdateState();
  return state.pendingRestart;
}

/**
 * 清除待重启标志（在通知用户或重启后调用）
 */
export function clearPendingUpdateRestart(): void {
  const state = getSilentUpdateState();
  state.pendingRestart = false;
  saveSilentUpdateState(state);
}

/**
 * 获取静默更新到的版本（若处于待重启状态）
 */
export function getPendingUpdateVersion(): string | null {
  const state = getSilentUpdateState();
  return state.pendingRestart ? (state.lastVersion ?? null) : null;
}

/**
 * 启动时初始化静默自动更新
 *
 * 这是静默更新系统的主入口。
 * 在应用启动时或从 hook 中调用一次本函数。
 * 它完全在后台运行更新检查，不阻塞。
 *
 * @param config - 静默更新配置
 */
export function initSilentAutoUpdate(config: SilentUpdateConfig = {}): void {
  // 在后台运行更新检查，不阻塞
  silentAutoUpdate(config).catch(() => {
    // 静默忽略任何错误——它们已被记录
  });
}
