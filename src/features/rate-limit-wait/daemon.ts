/**
 * Rate Limit Wait 守护进程
 *
 * 后台守护进程，监控速率限制并在速率限制重置时自动恢复
 * Claude Code 会话。
 *
 * 安全考虑：
 * - 状态/PID/log 文件使用严格权限 (0600)
 * - 不记录或存储敏感数据（token、凭证）
 * - 对 tmux pane ID 进行输入校验
 *
 * 参考：https://github.com/EvanOman/cc-wait
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync, statSync, appendFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { resolveDaemonModulePath } from '../../utils/daemon-module-path.js';
import { getGlobalWiseStatePath } from '../../utils/paths.js';
import {
  checkRateLimitStatus,
  formatRateLimitStatus,
  isRateLimitStatusDegraded,
  shouldMonitorBlockedPanes,
} from './rate-limit-monitor.js';
import {
  isTmuxAvailable,
  scanForBlockedPanes,
  sendResumeSequence,
  formatBlockedPanesSummary,
} from './tmux-detector.js';
import type {
  DaemonState,
  DaemonConfig,
  DaemonResponse,
  RateLimitStatus,
} from './types.js';
import { isProcessAlive } from '../../platform/index.js';

// ESM 兼容：ES 模块中没有 __filename
const __filename = fileURLToPath(import.meta.url);

/** 默认配置 */
const DEFAULT_CONFIG: Required<DaemonConfig> = {
  pollIntervalMs: 60 * 1000, // 1 分钟
  paneLinesToCapture: 15,
  verbose: false,
  stateFilePath: getGlobalWiseStatePath('rate-limit-daemon.json'),
  pidFilePath: getGlobalWiseStatePath('rate-limit-daemon.pid'),
  logFilePath: getGlobalWiseStatePath('rate-limit-daemon.log'),
};

/** 日志文件滚动前的最大大小 (1MB) */
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;

/** 严格的文件权限（仅所有者可读写） */
const SECURE_FILE_MODE = 0o600;

/**
 * 可安全传递给守护进程子进程的环境变量白名单。
 * 用于防止泄露 ANTHROPIC_API_KEY、GITHUB_TOKEN 等敏感变量。
 */
const DAEMON_ENV_ALLOWLIST = [
  // 核心系统路径
  'PATH', 'HOME', 'USERPROFILE',
  // 用户标识
  'USER', 'USERNAME', 'LOGNAME',
  // 区域设置
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // Terminal/tmux（tmux 集成所需）
  'TERM', 'TMUX', 'TMUX_PANE',
  // 临时目录
  'TMPDIR', 'TMP', 'TEMP',
  // XDG 目录 (Linux)
  'XDG_RUNTIME_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME',
  // Shell
  'SHELL',
  // Node.js
  'NODE_ENV', 'NODE_EXTRA_CA_CERTS',
  // 代理设置
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy',
  // Windows 系统
  'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC',
] as const;

/**
 * 为守护进程子进程创建最小化环境。
 * 仅包含白名单变量以防止凭证泄露。
 */
function createMinimalDaemonEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of DAEMON_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

/**
 * 与默认值合并，获取生效配置
 */
function getConfig(config?: DaemonConfig): Required<DaemonConfig> {
  return { ...DEFAULT_CONFIG, ...config };
}

/**
 * 确保状态目录存在且具有安全权限
 */
function ensureStateDir(config: Required<DaemonConfig>): void {
  const stateDir = dirname(config.stateFilePath);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * 以安全权限写入文件 (0600 - 仅所有者可读写)
 */
function writeSecureFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, { mode: SECURE_FILE_MODE });
  // 即使文件已存在也确保权限被设置
  try {
    chmodSync(filePath, SECURE_FILE_MODE);
  } catch (err) {
    // chmod 在 Windows 上不受支持；在其他平台上发出警告
    if (process.platform !== 'win32') {
      console.warn(`[RateLimitDaemon] Failed to set permissions on ${filePath}:`, err);
    }
  }
}

/**
 * 日志文件超过最大大小时滚动
 */
function rotateLogIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath)) return;

    const stats = statSync(logPath);
    if (stats.size > MAX_LOG_SIZE_BYTES) {
      const backupPath = `${logPath}.old`;
      // 如存在旧备份则移除
      if (existsSync(backupPath)) {
        unlinkSync(backupPath);
      }
      // 将当前日志重命名为备份
      renameSync(logPath, backupPath);
    }
  } catch {
    // 忽略滚动错误
  }
}

/**
 * 从磁盘读取守护进程状态
 */
export function readDaemonState(config?: DaemonConfig): DaemonState | null {
  const cfg = getConfig(config);

  try {
    if (!existsSync(cfg.stateFilePath)) {
      return null;
    }

    const content = readFileSync(cfg.stateFilePath, 'utf-8');
    const state = JSON.parse(content) as DaemonState;

    // 恢复 Date 对象
    if (state.startedAt) state.startedAt = new Date(state.startedAt);
    if (state.lastPollAt) state.lastPollAt = new Date(state.lastPollAt);
    if (state.rateLimitStatus?.lastCheckedAt) {
      state.rateLimitStatus.lastCheckedAt = new Date(state.rateLimitStatus.lastCheckedAt);
    }
    if (state.rateLimitStatus?.fiveHourResetsAt) {
      state.rateLimitStatus.fiveHourResetsAt = new Date(state.rateLimitStatus.fiveHourResetsAt);
    }
    if (state.rateLimitStatus?.weeklyResetsAt) {
      state.rateLimitStatus.weeklyResetsAt = new Date(state.rateLimitStatus.weeklyResetsAt);
    }
    if (state.rateLimitStatus?.nextResetAt) {
      state.rateLimitStatus.nextResetAt = new Date(state.rateLimitStatus.nextResetAt);
    }

    for (const pane of state.blockedPanes || []) {
      if (pane.firstDetectedAt) pane.firstDetectedAt = new Date(pane.firstDetectedAt);
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * 以安全权限将守护进程状态写入磁盘
 * 注意：状态文件仅包含非敏感的运行数据
 */
function writeDaemonState(state: DaemonState, config: Required<DaemonConfig>): void {
  ensureStateDir(config);
  writeSecureFile(config.stateFilePath, JSON.stringify(state, null, 2));
}

/**
 * 读取 PID 文件
 */
function readPidFile(config: Required<DaemonConfig>): number | null {
  try {
    if (!existsSync(config.pidFilePath)) {
      return null;
    }
    const content = readFileSync(config.pidFilePath, 'utf-8');
    return parseInt(content.trim(), 10);
  } catch {
    return null;
  }
}

/**
 * 以安全权限写入 PID 文件
 */
function writePidFile(pid: number, config: Required<DaemonConfig>): void {
  ensureStateDir(config);
  writeSecureFile(config.pidFilePath, String(pid));
}

/**
 * 移除 PID 文件
 */
function removePidFile(config: Required<DaemonConfig>): void {
  if (existsSync(config.pidFilePath)) {
    unlinkSync(config.pidFilePath);
  }
}

/**
 * 检查守护进程当前是否在运行
 */
export function isDaemonRunning(config?: DaemonConfig): boolean {
  const cfg = getConfig(config);
  const pid = readPidFile(cfg);

  if (pid === null) {
    return false;
  }

  if (!isProcessAlive(pid)) {
    // 过期的 PID 文件，清理
    removePidFile(cfg);
    return false;
  }

  return true;
}

/**
 * 将日志消息写入守护进程日志文件（带滚动）
 * 注意：仅记录运行消息，绝不记录凭证或 token
 */
function log(message: string, config: Required<DaemonConfig>): void {
  if (config.verbose) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  try {
    ensureStateDir(config);

    // 如需要则滚动日志（防止无限增长）
    rotateLogIfNeeded(config.logFilePath);

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    // 以安全权限追加到日志文件
    appendFileSync(config.logFilePath, logLine, { mode: SECURE_FILE_MODE });
  } catch {
    // 忽略日志写入错误
  }
}

/**
 * 创建初始守护进程状态
 */
function createInitialState(): DaemonState {
  return {
    isRunning: true,
    pid: process.pid,
    startedAt: new Date(),
    lastPollAt: null,
    rateLimitStatus: null,
    blockedPanes: [],
    resumedPaneIds: [],
    totalResumeAttempts: 0,
    successfulResumes: 0,
    errorCount: 0,
  };
}

/**
 * 只有确认脱离配额耗尽状态时才应触发 pane 恢复。
 * 降级/过期的 usage-api 429 响应对用户可见，但不得
 * 当作被阻塞 pane 的真正解除信号。
 */
export function shouldResumeBlockedPanesOnStatusChange(
  previousStatus: RateLimitStatus | null,
  nextStatus: RateLimitStatus | null,
): boolean {
  const wasLimited = shouldMonitorBlockedPanes(previousStatus);
  const isNowLimited = shouldMonitorBlockedPanes(nextStatus);
  return wasLimited && !isNowLimited && !isRateLimitStatusDegraded(nextStatus);
}

/**
 * 为守护进程注册清理处理器。
 * 确保在退出信号时清理 PID 文件与状态。
 */
function registerDaemonCleanup(config: Required<DaemonConfig>): void {
  const cleanup = () => {
    try {
      removePidFile(config);
    } catch {
      // 忽略清理错误
    }
    try {
      const state = readDaemonState(config);
      if (state) {
        state.isRunning = false;
        state.pid = null;
        writeDaemonState(state, config);
      }
    } catch {
      // 忽略清理错误
    }
  };

  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  process.once('exit', cleanup);
}

/**
 * 守护进程主轮询循环
 */
async function pollLoop(config: Required<DaemonConfig>): Promise<void> {
  const state = readDaemonState(config) || createInitialState();
  state.isRunning = true;
  state.pid = process.pid;

  // 注册清理处理器，以便退出时清理 PID/状态文件
  registerDaemonCleanup(config);

  log('Starting poll loop', config);

  while (state.isRunning) {
    try {
      state.lastPollAt = new Date();

      // 以 30s 超时检查速率限制状态，防止轮询循环卡住
      const rateLimitStatus = await Promise.race([
        checkRateLimitStatus(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('checkRateLimitStatus timed out after 30s')), 30_000)
        ),
      ]);
      const isNowLimited = shouldMonitorBlockedPanes(rateLimitStatus);
      const shouldResumeBlockedPanes = shouldResumeBlockedPanesOnStatusChange(
        state.rateLimitStatus,
        rateLimitStatus,
      );

      state.rateLimitStatus = rateLimitStatus;

      if (rateLimitStatus) {
        log(`Rate limit status: ${formatRateLimitStatus(rateLimitStatus)}`, config);
      } else {
        log('Rate limit status unavailable (no OAuth credentials?)', config);
      }

      // 若当前被速率限制，扫描被阻塞的 pane
      if (isNowLimited && isTmuxAvailable()) {
        log('Rate limited - scanning for blocked panes', config);

        const blockedPanes = scanForBlockedPanes(config.paneLinesToCapture, dirname(config.stateFilePath));

        // 添加新检测到的被阻塞 pane
        for (const pane of blockedPanes) {
          const existing = state.blockedPanes.find((p) => p.id === pane.id);
          if (!existing) {
            state.blockedPanes.push(pane);
            log(`Detected blocked pane: ${pane.id} in ${pane.session}:${pane.windowIndex}`, config);
          }
        }

        // 移除不再被阻塞的 pane
        state.blockedPanes = state.blockedPanes.filter((tracked) =>
          blockedPanes.some((current) => current.id === tracked.id)
        );
      }

      // 若速率限制刚解除（之前受限，现在不受限），尝试恢复
      if (shouldResumeBlockedPanes && state.blockedPanes.length > 0) {
        log('Rate limit cleared! Attempting to resume blocked panes', config);

        for (const pane of state.blockedPanes) {
          if (state.resumedPaneIds.includes(pane.id)) {
            log(`Skipping already resumed pane: ${pane.id}`, config);
            continue;
          }

          state.totalResumeAttempts++;
          log(`Attempting resume for pane: ${pane.id}`, config);

          const success = sendResumeSequence(pane.id);
          pane.resumeAttempted = true;
          pane.resumeSuccessful = success;

          if (success) {
            state.successfulResumes++;
            state.resumedPaneIds.push(pane.id);
            log(`Successfully sent resume to pane: ${pane.id}`, config);
          } else {
            state.errorCount++;
            log(`Failed to send resume to pane: ${pane.id}`, config);
          }
        }

        // 恢复尝试后清空被阻塞 pane
        state.blockedPanes = [];
      }

      // 若速率限制已解除且无被阻塞 pane，清空已恢复列表
      if (!isNowLimited && state.blockedPanes.length === 0) {
        state.resumedPaneIds = [];
      }

      writeDaemonState(state, config);
    } catch (error) {
      state.errorCount++;
      state.lastError = error instanceof Error ? error.message : String(error);
      log(`Poll error: ${state.lastError}`, config);
      writeDaemonState(state, config);
    }

    // 等待下一次轮询
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

/**
 * 启动守护进程
 */
export function startDaemon(config?: DaemonConfig): DaemonResponse {
  const cfg = getConfig(config);

  // 检查是否已在运行
  if (isDaemonRunning(cfg)) {
    const state = readDaemonState(cfg);
    return {
      success: false,
      message: 'Daemon is already running',
      state: state ?? undefined,
    };
  }

  // 检查 tmux 是否可用
  if (!isTmuxAvailable()) {
    console.warn('[RateLimitDaemon] tmux not available - resume functionality will be limited');
  }

  ensureStateDir(cfg);

  // 使用 dynamic import() 为守护进程 fork 一个新进程，以兼容 ESM。
  // 项目使用 "type": "module"，因此 require() 会以 ERR_REQUIRE_ESM 失败。
  const modulePath = resolveDaemonModulePath(__filename, ['features', 'rate-limit-wait', 'daemon.js']);
  const moduleUrl = pathToFileURL(modulePath).href;
  // 将配置写入临时文件，以避免通过模板字符串进行配置注入。
  // 这可防止恶意配置值被当作代码执行。
  const configId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const configPath = join(dirname(cfg.stateFilePath), `.daemon-config-${configId}.json`);
  try {
    writeSecureFile(configPath, JSON.stringify(cfg));
  } catch {
    return { success: false, message: 'Failed to write daemon config file' };
  }

  const daemonScript = `
    import(${JSON.stringify(moduleUrl)}).then(async ({ pollLoopWithConfigFile }) => {
      await pollLoopWithConfigFile(process.env.WISE_DAEMON_CONFIG_FILE);
    }).catch((err) => { console.error(err); process.exit(1); });
  `;

  try {
    // 使用 node 在后台运行守护进程
    // 注意：使用最小化环境以防止泄露敏感凭证
    const daemonEnv = {
      ...createMinimalDaemonEnv(),
      WISE_DAEMON_CONFIG_FILE: configPath,
    };
    const child = spawn('node', ['-e', daemonScript], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
      env: daemonEnv,
    });

    child.unref();

    const pid = child.pid;
    if (pid) {
      writePidFile(pid, cfg);

      const state = createInitialState();
      state.pid = pid;
      writeDaemonState(state, cfg);

      return {
        success: true,
        message: `Daemon started with PID ${pid}`,
        state,
      };
    }

    return { success: false, message: 'Failed to start daemon process' };
  } catch (error) {
    // 失败时清理配置文件
    try { unlinkSync(configPath); } catch { /* 忽略清理错误 */ }
    return {
      success: false,
      message: 'Failed to start daemon',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 在前台运行守护进程（用于直接执行）
 */
export async function runDaemonForeground(config?: DaemonConfig): Promise<void> {
  const cfg = getConfig(config);

  // 检查是否已在运行
  if (isDaemonRunning(cfg)) {
    console.error('Daemon is already running. Use "wise wait daemon stop" first.');
    process.exit(1);
  }

  // 写入 PID 文件
  writePidFile(process.pid, cfg);

  // 处理关闭
  const shutdown = () => {
    console.log('\nShutting down daemon...');
    removePidFile(cfg);
    const state = readDaemonState(cfg);
    if (state) {
      state.isRunning = false;
      writeDaemonState(state, cfg);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('Rate Limit Wait daemon starting in foreground mode...');
  console.log('Press Ctrl+C to stop.\n');

  // 运行轮询循环
  await pollLoop(cfg);
}

/**
 * 停止守护进程
 */
export function stopDaemon(config?: DaemonConfig): DaemonResponse {
  const cfg = getConfig(config);
  const pid = readPidFile(cfg);

  if (pid === null) {
    return {
      success: true,
      message: 'Daemon is not running',
    };
  }

  if (!isProcessAlive(pid)) {
    removePidFile(cfg);
    return {
      success: true,
      message: 'Daemon was not running (cleaned up stale PID file)',
    };
  }

  try {
    process.kill(pid, 'SIGTERM');
    removePidFile(cfg);

    // 更新状态
    const state = readDaemonState(cfg);
    if (state) {
      state.isRunning = false;
      state.pid = null;
      writeDaemonState(state, cfg);
    }

    return {
      success: true,
      message: `Daemon stopped (PID ${pid})`,
      state: state ?? undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to stop daemon',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 获取守护进程状态
 */
export function getDaemonStatus(config?: DaemonConfig): DaemonResponse {
  const cfg = getConfig(config);
  const state = readDaemonState(cfg);
  const running = isDaemonRunning(cfg);

  if (!running && !state) {
    return {
      success: true,
      message: 'Daemon has never been started',
    };
  }

  if (!running && state) {
    return {
      success: true,
      message: 'Daemon is not running',
      state: { ...state, isRunning: false, pid: null },
    };
  }

  return {
    success: true,
    message: 'Daemon is running',
    state: state ?? undefined,
  };
}

/**
 * 检测被阻塞的 pane（一次性扫描）
 */
export async function detectBlockedPanes(config?: DaemonConfig): Promise<DaemonResponse> {
  const cfg = getConfig(config);

  if (!isTmuxAvailable()) {
    return {
      success: false,
      message: 'tmux is not available',
    };
  }

  const rateLimitStatus = await checkRateLimitStatus();
  const blockedPanes = scanForBlockedPanes(cfg.paneLinesToCapture, dirname(cfg.stateFilePath));

  return {
    success: true,
    message: formatBlockedPanesSummary(blockedPanes),
    state: {
      isRunning: isDaemonRunning(cfg),
      pid: readPidFile(cfg),
      startedAt: null,
      lastPollAt: new Date(),
      rateLimitStatus,
      blockedPanes,
      resumedPaneIds: [],
      totalResumeAttempts: 0,
      successfulResumes: 0,
      errorCount: 0,
    },
  };
}

/**
 * 格式化守护进程状态以供 CLI 展示
 */
export function formatDaemonState(state: DaemonState): string {
  const lines: string[] = [];

  // 状态标题
  if (state.isRunning) {
    lines.push(`✓ Daemon running (PID: ${state.pid})`);
  } else {
    lines.push('✗ Daemon not running');
  }

  // 时间信息
  if (state.startedAt) {
    lines.push(`  Started: ${state.startedAt.toLocaleString()}`);
  }
  if (state.lastPollAt) {
    lines.push(`  Last poll: ${state.lastPollAt.toLocaleString()}`);
  }

  // 速率限制状态
  lines.push('');
  if (state.rateLimitStatus) {
    if (state.rateLimitStatus.isLimited || isRateLimitStatusDegraded(state.rateLimitStatus)) {
      lines.push(`⚠ ${formatRateLimitStatus(state.rateLimitStatus)}`);
    } else {
      lines.push('✓ Not rate limited');
    }
  } else {
    lines.push('? Rate limit status unavailable');
  }

  // 被阻塞的 pane
  if (state.blockedPanes.length > 0) {
    lines.push('');
    lines.push(formatBlockedPanesSummary(state.blockedPanes));
  }

  // 统计信息
  lines.push('');
  lines.push('Statistics:');
  lines.push(`  Resume attempts: ${state.totalResumeAttempts}`);
  lines.push(`  Successful: ${state.successfulResumes}`);
  lines.push(`  Errors: ${state.errorCount}`);

  if (state.lastError) {
    lines.push(`  Last error: ${state.lastError}`);
  }

  return lines.join('\n');
}

// 导出 pollLoop 供守护进程子进程使用
export { pollLoop };

/**
 * 守护进程子进程的轮询循环入口。
 * 从文件读取配置，以避免通过命令行进行配置注入。
 */
export async function pollLoopWithConfigFile(configPath: string): Promise<void> {
  const configContent = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent) as Required<DaemonConfig>;

  // 既然已读取，清理临时配置文件
  try { unlinkSync(configPath); } catch { /* 忽略清理错误 */ }

  await pollLoop(config);
}
