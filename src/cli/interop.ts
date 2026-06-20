/**
 * Interop CLI 命令 - WISE 与 OMX 的 tmux 分屏会话
 *
 * 创建一个 tmux 分屏布局：左侧为 Claude Code（WISE），右侧为 Codex CLI（OMX），
 * 二者共享 interop 状态。
 */

import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { isTmuxAvailable, isClaudeAvailable, tmuxExec } from './tmux-utils.js';
import { initInteropSession, getInteropDir } from '../interop/shared-state.js';

export type InteropMode = 'off' | 'observe' | 'active';

export interface InteropRuntimeFlags {
  enabled: boolean;
  mode: InteropMode;
  wiseInteropToolsEnabled: boolean;
  failClosed: boolean;
}

export function readInteropRuntimeFlags(env: NodeJS.ProcessEnv = process.env): InteropRuntimeFlags {
  const rawMode = (env.OMX_WISE_INTEROP_MODE || 'off').toLowerCase();
  const mode: InteropMode = rawMode === 'observe' || rawMode === 'active' ? rawMode : 'off';
  return {
    enabled: env.OMX_WISE_INTEROP_ENABLED === '1',
    mode,
    wiseInteropToolsEnabled: env.WISE_INTEROP_TOOLS_ENABLED === '1',
    failClosed: env.OMX_WISE_INTEROP_FAIL_CLOSED !== '0',
  };
}

export function validateInteropRuntimeFlags(flags: InteropRuntimeFlags): { ok: boolean; reason?: string } {
  if (!flags.enabled && flags.mode !== 'off') {
    return { ok: false, reason: 'OMX_WISE_INTEROP_MODE must be "off" when OMX_WISE_INTEROP_ENABLED=0.' };
  }

  if (flags.mode === 'active' && !flags.wiseInteropToolsEnabled) {
    return { ok: false, reason: 'Active mode requires WISE_INTEROP_TOOLS_ENABLED=1.' };
  }

  return { ok: true };
}

/**
 * 检查 codex CLI 是否可用
 */
function isCodexAvailable(): boolean {
  try {
    execFileSync('codex', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动带分屏 tmux 面板的 interop 会话
 */
export function launchInteropSession(cwd: string = process.cwd()): void {
  const flags = readInteropRuntimeFlags();
  const flagCheck = validateInteropRuntimeFlags(flags);

  console.log(`[interop] mode=${flags.mode}, enabled=${flags.enabled ? '1' : '0'}, tools=${flags.wiseInteropToolsEnabled ? '1' : '0'}, failClosed=${flags.failClosed ? '1' : '0'}`);
  if (!flagCheck.ok) {
    console.error(`Error: ${flagCheck.reason}`);
    console.error('Refusing to start interop in invalid flag configuration.');
    process.exit(1);
  }

  // 检查前置条件
  if (!isTmuxAvailable()) {
    console.error('Error: tmux is not available. Install tmux to use interop mode.');
    process.exit(1);
  }

  const hasCodex = isCodexAvailable();
  const hasClaude = isClaudeAvailable();

  if (!hasClaude) {
    console.error('Error: claude CLI is not available. Install Claude Code CLI first.');
    process.exit(1);
  }

  if (!hasCodex) {
    console.warn('Warning: codex CLI is not available. Only Claude Code will be launched.');
    console.warn('Install oh-my-codex (npm install -g @openai/codex) for full interop support.\n');
  }

  // 检查是否已处于 tmux 中
  const inTmux = Boolean(process.env.TMUX);

  if (!inTmux) {
    console.error('Error: Interop mode requires running inside a tmux session.');
    console.error('Start tmux first: tmux new-session -s myproject');
    process.exit(1);
  }

  // 生成会话 ID
  const sessionId = `interop-${randomUUID().split('-')[0]}`;

  // 初始化 interop 会话
  const _config = initInteropSession(sessionId, cwd, hasCodex ? cwd : undefined);

  console.log(`Initializing interop session: ${sessionId}`);
  console.log(`Working directory: ${cwd}`);
  console.log(`Config saved to: ${getInteropDir(cwd)}/config.json\n`);

  // 获取当前面板 ID
  let currentPaneId: string;
  try {
    const output = tmuxExec(['display-message', '-p', '#{pane_id}']);
    currentPaneId = output.trim();
  } catch (_error) {
    console.error('Error: Failed to get current tmux pane ID');
    process.exit(1);
  }

  if (!currentPaneId.startsWith('%')) {
    console.error('Error: Invalid tmux pane ID format');
    process.exit(1);
  }

  // 水平分屏（左：claude，右：codex）
  try {
    if (hasCodex) {
      // 创建右侧面板并运行 codex
      console.log('Splitting pane: Left (Claude Code) | Right (Codex)');

      tmuxExec([
        'split-window',
        '-h',
        '-c', cwd,
        '-t', currentPaneId,
        'codex',
      ], { stdio: 'inherit' });

      // 选中左侧面板（原始/当前面板）
      tmuxExec(['select-pane', '-t', currentPaneId], { stdio: 'ignore' });

      console.log('\nInterop session ready!');
      console.log('- Left pane: Claude Code (this terminal)');
      console.log('- Right pane: Codex CLI');
      console.log('\nYou can now use interop MCP tools to communicate between the two:');
      console.log('- interop_send_task: Send tasks between tools');
      console.log('- interop_read_results: Check task results');
      console.log('- interop_send_message: Send messages');
      console.log('- interop_read_messages: Read messages');
    } else {
      // codex 不可用，仅告知用户
      console.log('\nClaude Code is ready in this pane.');
      console.log('Install oh-my-codex to enable split-pane interop mode.');
      console.log('\nInstall: npm install -g @openai/codex');
    }
  } catch (error) {
    console.error('Error creating split pane:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * interop 命令的 CLI 入口
 */
export function interopCommand(options: { cwd?: string } = {}): void {
  const cwd = options.cwd || process.cwd();
  launchInteropSession(cwd);
}
