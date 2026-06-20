/**
 * 持久模式钩子
 *
 * 持久工作模式的统一处理器：ultrawork、ralph 与 todo-continuation。
 * 本钩子拦截 Stop 事件并基于以下条件强制继续工作：
 * 1. 带有未完成 todo 的活动 ultrawork 模式
 * 2. 活动 ralph 循环（直到通过 /wise:cancel 取消）
 * 3. 任意未完成 todo（通用强制）
 *
 * 优先级顺序：Ralph > Ultrawork > Todo Continuation
 */

import { existsSync, readFileSync, unlinkSync, statSync, openSync, readSync, closeSync, mkdirSync } from 'fs';
import { atomicWriteJsonSync } from '../../lib/atomic-write.js';
import { join } from 'path';
import { getHardMaxIterations } from '../../lib/security-config.js';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { getGlobalWiseConfigCandidates } from '../../utils/paths.js';
import {
  readUltraworkState,
  writeUltraworkState,
  incrementReinforcement,
  deactivateUltrawork,
  getUltraworkPersistenceMessage,
  type UltraworkState
} from '../ultrawork/index.js';
import { resolveToWorktreeRoot, resolveSessionStatePath, resolveStatePath, getWiseRoot } from '../../lib/worktree-paths.js';
import { readModeState, writeModeState } from '../../lib/mode-state-io.js';
import {
  readRalphState,
  writeRalphState,
  incrementRalphIteration,
  clearRalphState,
  findPrdPath,
  getPrdCompletionStatus,
  getRalphContext,
  getStory,
  markStoryIncomplete,
  markStoryArchitectVerified,
  readVerificationState,
  startVerification,
  recordArchitectFeedback,
  getArchitectVerificationPrompt,
  getArchitectRejectionContinuationPrompt,
  detectArchitectApproval,
  detectArchitectRejection,
  clearVerificationState,
  type VerificationState,
} from '../ralph/index.js';
import { checkIncompleteTodos, getNextPendingTodo, StopContext, isUserAbort, isContextLimitStop, isRateLimitStop, isExplicitCancelCommand, isAuthenticationError, isScheduledWakeupStop, isOversizeToolResultRedirectStop } from '../todo-continuation/index.js';
import { TODO_CONTINUATION_PROMPT } from '../../installer/hooks.js';
import {
  isAutopilotActive
} from '../autopilot/index.js';
import { checkAutopilot } from '../autopilot/enforcement.js';
import { readTeamPipelineState } from '../team-pipeline/state.js';
import type { TeamPipelinePhase } from '../team-pipeline/types.js';
import { getActiveAgentSnapshot } from '../subagent-tracker/index.js';
import type { IdleNotificationRepoState } from './idle-repo-state.js';
import { truncatePromptForEcho } from '../../lib/truncate-prompt.js';
import { isModeActive } from '../mode-registry/index.js';

export interface ToolErrorState {
  tool_name: string;
  tool_input_preview?: string;
  error: string;
  timestamp: string;
  retry_count: number;
}

export interface PersistentModeResult {
  /** 是否阻断 stop 事件 */
  shouldBlock: boolean;
  /** 注入上下文的消息 */
  message: string;
  /** 触发阻断的模式 */
  mode: 'ralph' | 'ultrawork' | 'todo-continuation' | 'autopilot' | 'autoresearch' | 'team' | 'ralplan' | 'none';
  /** 额外元数据 */
  metadata?: {
    todoCount?: number;
    iteration?: number;
    maxIterations?: number;
    reinforcementCount?: number;
    todoContinuationAttempts?: number;
    phase?: string;
    tasksCompleted?: number;
    tasksTotal?: number;
    toolError?: ToolErrorState;
  };
}

/** 放弃前的最大 todo-continuation 尝试次数（防止无限循环） */
const MAX_TODO_CONTINUATION_ATTEMPTS = 5;
const CANCEL_SIGNAL_TTL_MS = 30_000;
const STALE_STATE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const PENDING_ASYNC_STATE_STALE_MS = 24 * 60 * 60 * 1000;
const OVERSIZE_TOOL_RESULT_REDIRECT_STOP_MAX = 3;
const OVERSIZE_TOOL_RESULT_REDIRECT_STOP_TTL_MS = 5 * 60 * 1000;
const TERMINAL_WORKFLOW_SLOT_MODES = new Set(['autopilot', 'ralph', 'ralplan']);
const TERMINAL_WORKFLOW_PHASES = new Set([
  'complete',
  'completed',
  'failed',
  'cancelled',
  'canceled',
  'cancel',
  'done',
  'stopped',
]);

/** 按会话跟踪 todo-continuation 尝试次数以防止无限循环 */
const todoContinuationAttempts = new Map<string, number>();

export function shouldWriteStateBack(statePath: string | null | undefined): boolean {
  return Boolean(statePath && existsSync(statePath));
}

/**
 * 检查当前会话是否处于显式取消窗口内。
 * 用于防止 /cancel 期间 stop 钩子重复强化的竞态。
 */
function isSessionCancelInProgress(directory: string, sessionId?: string): boolean {
  let cancelSignalPath: string | undefined;

  if (sessionId) {
    try {
      cancelSignalPath = resolveSessionStatePath('cancel-signal', sessionId, directory);
    } catch {
      // 回退到遗留路径
    }
  }

  // 兜底：检查遗留（非会话级）取消信号
  if (!cancelSignalPath) {
    cancelSignalPath = join(getWiseRoot(directory), 'state', 'cancel-signal-state.json');
  }

  if (!existsSync(cancelSignalPath)) {
    return false;
  }

  try {
    const raw = JSON.parse(readFileSync(cancelSignalPath, 'utf-8')) as {
      requested_at?: string;
      expires_at?: string;
    };

    const now = Date.now();
    const expiresAt = raw.expires_at ? new Date(raw.expires_at).getTime() : NaN;
    const requestedAt = raw.requested_at ? new Date(raw.requested_at).getTime() : NaN;
    const fallbackExpiry = Number.isFinite(requestedAt) ? requestedAt + CANCEL_SIGNAL_TTL_MS : NaN;
    const effectiveExpiry = Number.isFinite(expiresAt) ? expiresAt : fallbackExpiry;

    if (!Number.isFinite(effectiveExpiry) || effectiveExpiry <= now) {
      unlinkSync(cancelSignalPath);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * 若模式状态近期未刷新则视为过期。
 * 过期文件会被忽略，以免错误阻断新会话。
 * 取 last_checked_at、updated_at、started_at 中最新者判断。
 */
function isStaleState(state: unknown): boolean {
  if (!state || typeof state !== 'object') {
    return true;
  }

  const stateRecord = state as Record<string, unknown>;
  const timestamps = [stateRecord.last_checked_at, stateRecord.updated_at, stateRecord.started_at]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const mostRecent = timestamps.reduce((max, value) => {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);

  if (mostRecent === 0) {
    return true;
  }

  return Date.now() - mostRecent > STALE_STATE_THRESHOLD_MS;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshTimestamp(value: unknown, ttlMs = PENDING_ASYNC_STATE_STALE_MS): boolean {
  const parsed = parseTimestamp(value);
  return parsed !== null && Date.now() - parsed <= ttlMs;
}

function hasPendingBackgroundTask(directory: string, sessionId?: string): boolean {
  try {
    const stateRoot = join(getWiseRoot(directory), 'state');
    const hudPath = sessionId
      ? join(stateRoot, 'sessions', sessionId, 'hud-state.json')
      : join(stateRoot, 'hud-state.json');
    if (!existsSync(hudPath)) return false;
    const hudState = JSON.parse(readFileSync(hudPath, 'utf-8')) as {
      backgroundTasks?: Array<{
        status?: string;
        startedAt?: string;
        startTime?: string;
      }>;
    };
    return Boolean(hudState?.backgroundTasks?.some((task) => {
      if (task.status !== 'running') return false;
      return isFreshTimestamp(task.startedAt ?? task.startTime);
    }));
  } catch {
    return false;
  }
}

function readPendingWakeupState(directory: string, sessionId?: string): Array<Record<string, unknown>> {
  const stateRoot = join(getWiseRoot(directory), 'state');
  const dirs = sessionId
    ? [join(stateRoot, 'sessions', sessionId), stateRoot]
    : [stateRoot];
  const fileNames = [
    'scheduled-wakeup-state.json',
    'schedule-wakeup-state.json',
    'wakeup-state.json',
  ];
  const states: Array<Record<string, unknown>> = [];

  for (const dir of dirs) {
    for (const fileName of fileNames) {
      const filePath = join(dir, fileName);
      try {
        if (!existsSync(filePath)) continue;
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (parsed && typeof parsed === 'object') {
          states.push(parsed as Record<string, unknown>);
        }
      } catch {
        continue;
      }
    }
  }

  return states;
}

function hasPendingScheduledWakeup(directory: string, sessionId?: string): boolean {
  const now = Date.now();
  return readPendingWakeupState(directory, sessionId).some((state) => {
    const status = typeof state.status === 'string' ? state.status.toLowerCase() : '';
    if (['completed', 'complete', 'cancelled', 'canceled', 'failed', 'expired'].includes(status)) {
      return false;
    }

    const dueAt = parseTimestamp(
      state.due_at ?? state.wakeup_at ?? state.scheduled_for ?? state.deadline_at ?? state.expires_at,
    );
    if (dueAt !== null) {
      return dueAt > now;
    }

    if (state.active === true || state.pending === true) {
      return isFreshTimestamp(state.created_at ?? state.updated_at ?? state.started_at);
    }

    return false;
  });
}

function normalizeWorkflowTerminalPhase(state: Record<string, unknown>): string | null {
  const raw = state.current_phase ?? state.phase ?? state.status;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim().toLowerCase()
    : null;
}

function isTerminalWorkflowModeState(state: Record<string, unknown> | null): boolean {
  if (!state) return false;
  if (state.active === false) return true;
  if (typeof state.completed_at === 'string' && state.completed_at.length > 0) return true;
  const phase = normalizeWorkflowTerminalPhase(state);
  return Boolean(phase && TERMINAL_WORKFLOW_PHASES.has(phase));
}

async function reconcileTerminalWorkflowSlots(
  workingDir: string,
  sessionId?: string,
): Promise<void> {
  try {
    const {
      readSkillActiveStateNormalized,
      pruneExpiredWorkflowSkillTombstones,
      markWorkflowSkillCompleted,
      writeSkillActiveStateCopies,
    } = await import('../skill-state/index.js');

    const original = readSkillActiveStateNormalized(workingDir, sessionId);
    let current = pruneExpiredWorkflowSkillTombstones(original);
    let changed = current !== original;

    for (const [slotName, slot] of Object.entries(current.active_skills)) {
      if (slot.completed_at || !TERMINAL_WORKFLOW_SLOT_MODES.has(slotName)) {
        continue;
      }

      const modeState = readModeState<Record<string, unknown>>(slotName, workingDir, sessionId);
      if (!isTerminalWorkflowModeState(modeState)) {
        continue;
      }

      current = markWorkflowSkillCompleted(current, slotName);
      changed = true;
    }

    if (changed) {
      writeSkillActiveStateCopies(workingDir, current, sessionId);
    }
  } catch {
    // Best-effort reconciliation only. Stop enforcement falls back to the
    // direct mode-state checks below if the ledger cannot be updated.
  }
}

/**
 * 待处理的本会话异步工作（后台 Bash/Task 或已设置的 wakeup）意味着
 * 代理正在合理等待外部通知/恢复。此窗口内持久模式不应注入"停滞"强化。
 */
export function hasPendingOwnedAsyncWork(directory: string, sessionId?: string): boolean {
  return hasPendingBackgroundTask(directory, sessionId)
    || hasPendingScheduledWakeup(directory, sessionId);
}

/**
 * 从状态目录读取最近一次工具错误。
 * 文件不存在或错误过期（超过 60 秒）时返回 null。
 */
export function readLastToolError(directory: string): ToolErrorState | null {
  const stateDir = join(getWiseRoot(directory), 'state');
  const errorPath = join(stateDir, 'last-tool-error.json');

  try {
    if (!existsSync(errorPath)) {
      return null;
    }

    const content = readFileSync(errorPath, 'utf-8');
    const toolError = JSON.parse(content) as ToolErrorState;

    if (!toolError || !toolError.timestamp) {
      return null;
    }

    // 检查是否过期——超过 60 秒的错误被忽略
    const parsedTime = new Date(toolError.timestamp).getTime();
    if (!Number.isFinite(parsedTime)) {
      return null;
    }
    const age = Date.now() - parsedTime;
    if (age > 60000) {
      return null;
    }

    return toolError;
  } catch {
    return null;
  }
}

/**
 * 原子化清除工具错误状态文件。
 */
export function clearToolErrorState(directory: string): void {
  const stateDir = join(getWiseRoot(directory), 'state');
  const errorPath = join(stateDir, 'last-tool-error.json');

  try {
    if (existsSync(errorPath)) {
      unlinkSync(errorPath);
    }
  } catch {
    // 忽略错误——文件可能已被移除
  }
}

/**
 * 生成工具错误的重试指引消息。
 * 重试 5 次及以上时建议替代方案。
 */
export function getToolErrorRetryGuidance(toolError: ToolErrorState | null): string {
  if (!toolError) {
    return '';
  }

  const retryCount = toolError.retry_count || 1;
  const toolName = toolError.tool_name || 'unknown';
  const error = toolError.error || 'Unknown error';

  if (retryCount >= 5) {
    return `[TOOL ERROR - ALTERNATIVE APPROACH NEEDED]
The "${toolName}" operation has failed ${retryCount} times.

STOP RETRYING THE SAME APPROACH. Instead:
1. Try a completely different command or approach
2. Check if the environment/dependencies are correct
3. Consider breaking down the task differently
4. If stuck, ask the user for guidance

`;
  }

  return `[TOOL ERROR - RETRY REQUIRED]
The previous "${toolName}" operation failed.

Error: ${error}

REQUIRED ACTIONS:
1. Analyze why the command failed
2. Fix the issue (wrong path? permission? syntax? missing dependency?)
3. RETRY the operation with corrected parameters
4. Continue with your original task after success

Do NOT skip this step. Do NOT move on without fixing the error.

`;
}

/**
 * 获取或递增 todo-continuation 尝试计数器
 */
function trackTodoContinuationAttempt(sessionId: string): number {
  if (todoContinuationAttempts.size > 200) todoContinuationAttempts.clear();
  const current = todoContinuationAttempts.get(sessionId) || 0;
  const next = current + 1;
  todoContinuationAttempts.set(sessionId, next);
  return next;
}

/**
 * 重置 todo-continuation 尝试计数器（todo 实际变化时调用）
 */
export function resetTodoContinuationAttempts(sessionId: string): void {
  todoContinuationAttempts.delete(sessionId);
}

/**
 * 从全局 WISE 配置读取会话空闲通知冷却秒数。
 * 默认：60 秒。0 = 禁用（无冷却）。
 */
export function getIdleNotificationCooldownSeconds(): number {
  for (const configPath of getGlobalWiseConfigCandidates('config.json')) {
    try {
      if (!existsSync(configPath)) continue;
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const cooldown = (config?.notificationCooldown as Record<string, unknown> | undefined);
      const val = cooldown?.sessionIdleSeconds;
      if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
      return 60;
    } catch {
      return 60;
    }
  }
  return 60;
}

interface IdleNotificationCooldownRecord {
  lastSentAt?: string;
  repoSignature?: string;
  backlogZero?: boolean;
}

function getGlobalIdleNotificationCooldownPath(stateDir: string): string {
  return join(stateDir, 'idle-notif-cooldown.json');
}

function getIdleNotificationCooldownPath(stateDir: string, sessionId?: string): string {
  // 保持会话段对文件系统安全；否则回退到遗留全局路径。
  if (sessionId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(sessionId)) {
    return join(stateDir, 'sessions', sessionId, 'idle-notif-cooldown.json');
  }
  return getGlobalIdleNotificationCooldownPath(stateDir);
}

function readIdleNotificationCooldownRecord(cooldownPath: string): IdleNotificationCooldownRecord | null {
  try {
    if (!existsSync(cooldownPath)) return null;
    return JSON.parse(readFileSync(cooldownPath, 'utf-8')) as IdleNotificationCooldownRecord;
  } catch {
    return null;
  }
}

function isRepeatedZeroBacklogCooldown(
  record: IdleNotificationCooldownRecord | null,
  repoState?: IdleNotificationRepoState | null,
): boolean {
  return Boolean(
    repoState?.backlogZero &&
    record?.backlogZero === true &&
    typeof record.repoSignature === 'string' &&
    record.repoSignature === repoState.signature,
  );
}

function hasRepeatedZeroBacklogCooldown(
  stateDir: string,
  sessionId?: string,
  repoState?: IdleNotificationRepoState | null,
): boolean {
  const cooldownPath = getIdleNotificationCooldownPath(stateDir, sessionId);
  const cooldownRecord = readIdleNotificationCooldownRecord(cooldownPath);

  if (isRepeatedZeroBacklogCooldown(cooldownRecord, repoState)) {
    return true;
  }

  if (cooldownPath !== getGlobalIdleNotificationCooldownPath(stateDir)) {
    const globalRecord = readIdleNotificationCooldownRecord(getGlobalIdleNotificationCooldownPath(stateDir));
    if (isRepeatedZeroBacklogCooldown(globalRecord, repoState)) {
      return true;
    }
  }

  return false;
}

/**
 * OpenClaw 的 stop 唤醒通常应绕过空闲冷却，但未变化的零积压仓库状态应保持抑制，
 * 以免过期的仓库级 CI 重放突发在可处理积压已归零后重新触发。
 */
export function shouldWakeOpenClawOnStop(
  stateDir: string,
  sessionId?: string,
  repoState?: IdleNotificationRepoState | null,
): boolean {
  return !hasRepeatedZeroBacklogCooldown(stateDir, sessionId, repoState);
}

/**
 * 检查会话空闲通知冷却是否已过。
 * 应发送通知时返回 true。
 */
export function shouldSendIdleNotification(
  stateDir: string,
  sessionId?: string,
  repoState?: IdleNotificationRepoState | null,
): boolean {
  const cooldownSecs = getIdleNotificationCooldownSeconds();
  const cooldownPath = getIdleNotificationCooldownPath(stateDir, sessionId);
  const cooldownRecord = readIdleNotificationCooldownRecord(cooldownPath);

  if (hasRepeatedZeroBacklogCooldown(stateDir, sessionId, repoState)) {
    return false;
  }

  if (repoState && typeof cooldownRecord?.repoSignature === 'string') {
    if (cooldownRecord.repoSignature !== repoState.signature) {
      return true;
    }
  }

  if (cooldownSecs === 0) return true; // 冷却已禁用

  if (typeof cooldownRecord?.lastSentAt === 'string') {
    const elapsed = (Date.now() - new Date(cooldownRecord.lastSentAt).getTime()) / 1000;
    if (Number.isFinite(elapsed) && elapsed < cooldownSecs) return false;
  }
  return true;
}

/**
 * 记录会话空闲通知已在当前时间戳发送。
 */
export function recordIdleNotificationSent(
  stateDir: string,
  sessionId?: string,
  repoState?: IdleNotificationRepoState | null,
): void {
  const cooldownPath = getIdleNotificationCooldownPath(stateDir, sessionId);
  try {
    const record: IdleNotificationCooldownRecord = {
      lastSentAt: new Date().toISOString(),
    };
    if (repoState) {
      record.repoSignature = repoState.signature;
      record.backlogZero = repoState.backlogZero;
    }
    atomicWriteJsonSync(cooldownPath, record);
    if (repoState?.backlogZero && cooldownPath !== getGlobalIdleNotificationCooldownPath(stateDir)) {
      atomicWriteJsonSync(getGlobalIdleNotificationCooldownPath(stateDir), record);
    }
  } catch {
    // ignore write errors
  }
}

/** 为检测架构师批准而从 transcript 尾部读取的最大字节数。 */
const TRANSCRIPT_TAIL_BYTES = 32 * 1024; // 32 KB
const CRITICAL_CONTEXT_STOP_PERCENT = 95;
const RALPLAN_TERMINAL_PHASES = new Set([
  'completed',
  'complete',
  'failed',
  'cancelled',
  'canceled',
  'aborted',
  'terminated',
  'done',
  'handoff',
  'pending approval',
  'pending-approval',
  'pending_approval',
  'awaiting approval',
  'awaiting-approval',
  'awaiting_approval',
  'approval-required',
  'approval_required',
]);

/**
 * 读取可能很大的 transcript 文件的尾部。
 * 架构师批准/拒绝标记出现在对话末尾附近，
 * 因此只读取最后 N 字节可避免加载兆字节级 transcript。
 */
function readTranscriptTail(transcriptPath: string): string {
  const size = statSync(transcriptPath).size;
  if (size <= TRANSCRIPT_TAIL_BYTES) {
    return readFileSync(transcriptPath, 'utf-8');
  }
  const fd = openSync(transcriptPath, 'r');
  try {
    const offset = size - TRANSCRIPT_TAIL_BYTES;
    const buf = Buffer.allocUnsafe(TRANSCRIPT_TAIL_BYTES);
    const bytesRead = readSync(fd, buf, 0, TRANSCRIPT_TAIL_BYTES, offset);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    closeSync(fd);
  }
}

function readTranscriptTailLines(transcriptPath: string): string[] {
  const content = readTranscriptTail(transcriptPath);
  const lines = content.split('\n');

  try {
    if (statSync(transcriptPath).size > TRANSCRIPT_TAIL_BYTES && lines.length > 0) {
      lines.shift();
    }
  } catch {
    return lines;
  }

  return lines;
}

type TranscriptContentBlock = {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
};

type TranscriptApprovalEntry = {
  message?: {
    content?: TranscriptContentBlock[] | string;
  };
};

type ReviewerApprovalPath = 'architect' | 'critic' | 'codex';

const REVIEWER_TASK_TOOL_NAMES = new Set(['Task', 'proxy_Task', 'Agent']);
const REVIEWER_COMMAND_TOOL_NAMES = new Set(['Bash', 'proxy_Bash']);

function normalizeReviewerPath(subagentType: unknown): ReviewerApprovalPath | null {
  if (typeof subagentType !== 'string') {
    return null;
  }

  const normalized = subagentType.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const baseName = normalized.includes(':')
    ? normalized.slice(normalized.lastIndexOf(':') + 1)
    : normalized;

  if (baseName === 'architect' || baseName.startsWith('architect-')) {
    return 'architect';
  }

  if (baseName === 'critic' || baseName.startsWith('critic-')) {
    return 'critic';
  }

  return null;
}

function isCodexReviewerCommand(command: unknown): boolean {
  return typeof command === 'string'
    && /\bask\s+codex\s+--agent-prompt\s+critic\b/i.test(command);
}

function extractTranscriptText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => extractTranscriptText(item)).filter(Boolean).join('\n');
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  const record = content as Record<string, unknown>;
  const directText = typeof record.text === 'string' ? record.text : '';
  const nestedContent = 'content' in record ? extractTranscriptText(record.content) : '';
  return [directText, nestedContent].filter(Boolean).join('\n');
}

function matchesVerificationReviewerPath(
  reviewerPath: ReviewerApprovalPath,
  verificationState?: Pick<VerificationState, 'critic_mode'>
): boolean {
  const expected = verificationState?.critic_mode ?? 'architect';
  return reviewerPath === expected;
}

function checkReviewerAuthoredApprovalInMessages(
  transcriptPath: string,
  verificationState?: Pick<VerificationState, 'request_id' | 'story_id' | 'critic_mode'>
): boolean {
  const reviewerToolUses = new Map<string, ReviewerApprovalPath>();

  for (const line of readTranscriptTailLines(transcriptPath)) {
    if (!line.trim()) {
      continue;
    }

    let entry: TranscriptApprovalEntry;
    try {
      entry = JSON.parse(line) as TranscriptApprovalEntry;
    } catch {
      continue;
    }

    const content = entry.message?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const block of content) {
      if (block?.type === 'tool_use' && block.id && block.name) {
        if (REVIEWER_TASK_TOOL_NAMES.has(block.name)) {
          const reviewerPath = normalizeReviewerPath((block.input as Record<string, unknown> | undefined)?.subagent_type);
          if (reviewerPath && matchesVerificationReviewerPath(reviewerPath, verificationState)) {
            reviewerToolUses.set(block.id, reviewerPath);
          }
          continue;
        }

        if (REVIEWER_COMMAND_TOOL_NAMES.has(block.name)) {
          const command = (block.input as Record<string, unknown> | undefined)?.command;
          if (isCodexReviewerCommand(command) && matchesVerificationReviewerPath('codex', verificationState)) {
            reviewerToolUses.set(block.id, 'codex');
          }
        }

        continue;
      }

      if (block?.type !== 'tool_result' || !block.tool_use_id) {
        continue;
      }

      if (!reviewerToolUses.has(block.tool_use_id)) {
        continue;
      }

      const reviewerOutput = extractTranscriptText(block.content);
      if (reviewerOutput && detectArchitectApproval(reviewerOutput, verificationState)) {
        return true;
      }
    }
  }

  return false;
}

function estimateTranscriptContextPercent(transcriptPath?: string): number {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return 0;
  }

  try {
    const content = readTranscriptTail(transcriptPath);
    const windowMatches = [...content.matchAll(/"context_window"\s{0,5}:\s{0,5}(\d+)/g)];
    const inputMatches = [...content.matchAll(/"input_tokens"\s{0,5}:\s{0,5}(\d+)/g)];
    const lastWindow = windowMatches.at(-1)?.[1];
    const lastInput = inputMatches.at(-1)?.[1];

    if (!lastWindow || !lastInput) {
      return 0;
    }

    const contextWindow = parseInt(lastWindow, 10);
    const inputTokens = parseInt(lastInput, 10);
    if (!Number.isFinite(contextWindow) || contextWindow <= 0 || !Number.isFinite(inputTokens)) {
      return 0;
    }

    return Math.round((inputTokens / contextWindow) * 100);
  } catch {
    return 0;
  }
}

function isCriticalContextStop(stopContext?: StopContext): boolean {
  if (isContextLimitStop(stopContext)) {
    return true;
  }

  const transcriptPath = stopContext?.transcript_path ?? stopContext?.transcriptPath;
  return estimateTranscriptContextPercent(transcriptPath) >= CRITICAL_CONTEXT_STOP_PERCENT;
}

const AWAITING_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

function isAwaitingConfirmation(state: unknown): boolean {
  if (!state || typeof state !== 'object') {
    return false;
  }

  const stateRecord = state as Record<string, unknown>;
  if (stateRecord.awaiting_confirmation !== true) {
    return false;
  }

  const setAt =
    (typeof stateRecord.awaiting_confirmation_set_at === 'string' && stateRecord.awaiting_confirmation_set_at) ||
    (typeof stateRecord.started_at === 'string' && stateRecord.started_at) ||
    null;

  if (!setAt) {
    return false;
  }

  const setAtMs = new Date(setAt).getTime();
  if (!Number.isFinite(setAtMs)) {
    return false;
  }

  return Date.now() - setAtMs < AWAITING_CONFIRMATION_TTL_MS;
}

/**
 * 检查会话 transcript 中的架构师批准
 */
function checkArchitectApprovalInTranscript(
  sessionId: string,
  verificationState?: Pick<VerificationState, 'request_id' | 'story_id' | 'critic_mode'>
): boolean {
  const claudeDir = getClaudeConfigDir();
  const possiblePaths = [join(claudeDir, 'sessions', sessionId, 'messages.json')];

  for (const transcriptPath of possiblePaths) {
    if (!existsSync(transcriptPath)) {
      continue;
    }

    try {
      if (checkReviewerAuthoredApprovalInMessages(transcriptPath, verificationState)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * 检查会话 transcript 中的架构师拒绝
 */
function checkArchitectRejectionInTranscript(sessionId: string): { rejected: boolean; feedback: string } {
  const claudeDir = getClaudeConfigDir();
  const possiblePaths = [
    join(claudeDir, 'sessions', sessionId, 'transcript.md'),
    join(claudeDir, 'sessions', sessionId, 'messages.json'),
    join(claudeDir, 'transcripts', `${sessionId}.md`)
  ];

  for (const transcriptPath of possiblePaths) {
    if (existsSync(transcriptPath)) {
      try {
        const content = readTranscriptTail(transcriptPath);
        const result = detectArchitectRejection(content);
        if (result.rejected) {
          return result;
        }
      } catch {
        continue;
      }
    }
  }
  return { rejected: false, feedback: '' };
}

/**
 * 检查 Ralph 循环状态并判断是否应继续
 * 现包含对完成声明的架构师校验
 */
async function checkRalphLoop(
  sessionId?: string,
  directory?: string,
  cancelInProgress?: boolean
): Promise<PersistentModeResult | null> {
  const workingDir = resolveToWorktreeRoot(directory);
  const state = readRalphState(workingDir, sessionId);
  const ralphStatePath = sessionId
    ? resolveSessionStatePath('ralph', sessionId, workingDir)
    : resolveStatePath('ralph', workingDir);

  if (!state || !state.active || isStaleState(state)) {
    return null;
  }

  // 会话隔离。`readRalphState()` 已强制宽松形式
  // （"仅当两侧都有已定义 session_id 且不同时才拒绝"），
  // 因此到这里时，状态文件要么显式绑定到本会话，要么没有 session_id（遗留/未绑定状态）。
  //
  // 之前的严格检查 `state.session_id !== sessionId` 会拒绝一侧未定义、
  // 另一侧为 UUID 的合法情形，导致每个 Ralph 循环的迭代计数都被打断
  // （状态文件缺 session_id 或 Stop 钩子丢失了它）。症状：ralph:1/100
  // 在 HUD 中永远卡住，即使 Stop 钩子在多小时的会话中触发了多次。
  if (state.session_id && sessionId && state.session_id !== sessionId) {
    return null;
  }

  if (isAwaitingConfirmation(state)) {
    return null;
  }

  // 显式取消窗口：cancel 进行中时绝不重新武装 Ralph 内部逻辑。
  // 使用 checkPersistentModes 缓存的取消信号以避免 TOCTOU 重读。
  if (cancelInProgress) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 自愈关联的 ultrawork：若 ralph 处于活动且标记为关联，但 ultrawork 状态缺失，
  // 则重建它，使 stop 强化不会静默消失。
  if (state.linked_ultrawork) {
    const ultraworkState = readUltraworkState(workingDir, sessionId);
    if (!ultraworkState?.active) {
      const now = new Date().toISOString();
      const restoredState: UltraworkState = {
        active: true,
        started_at: state.started_at || now,
        original_prompt: state.prompt || 'Ralph loop task',
        session_id: sessionId,
        project_path: workingDir,
        reinforcement_count: 0,
        last_checked_at: now,
        linked_to_ralph: true
      };
      writeUltraworkState(restoredState, workingDir, sessionId);
    }
  }

  // 检查 team pipeline 状态协调
  // 当 team 模式与 ralph 同时活动时，尊重 team 阶段转换
  const teamState = readTeamPipelineState(workingDir, sessionId);
  if (teamState && teamState.active !== undefined && !isStaleState(teamState)) {
    const teamPhase: TeamPipelinePhase = teamState.phase;

    // 若 team pipeline 已达终态，ralph 也应完成
    if (teamPhase === 'complete') {
      clearRalphState(workingDir, sessionId);
      clearVerificationState(workingDir, sessionId);
      deactivateUltrawork(workingDir, sessionId);
      return {
        shouldBlock: false,
        message: `[RALPH LOOP COMPLETE - TEAM] Team pipeline completed successfully. Ralph loop ending after ${state.iteration} iteration(s).`,
        mode: 'none'
      };
    }
    if (teamPhase === 'failed') {
      clearRalphState(workingDir, sessionId);
      clearVerificationState(workingDir, sessionId);
      deactivateUltrawork(workingDir, sessionId);
      return {
        shouldBlock: false,
        message: `[RALPH LOOP STOPPED - TEAM FAILED] Team pipeline failed. Ralph loop ending after ${state.iteration} iteration(s).`,
        mode: 'none'
      };
    }
    if (teamPhase === 'cancelled') {
      clearRalphState(workingDir, sessionId);
      clearVerificationState(workingDir, sessionId);
      deactivateUltrawork(workingDir, sessionId);
      return {
        shouldBlock: false,
        message: `[RALPH LOOP CANCELLED - TEAM] Team pipeline was cancelled. Ralph loop ending after ${state.iteration} iteration(s).`,
        mode: 'none'
      };
    }
  }

  // 检查已有的校验状态（架构师校验进行中）
  let verificationState = readVerificationState(workingDir, sessionId);

  if (verificationState?.pending) {
    // 校验进行中——检查架构师的响应
    if (sessionId) {
      // 检查架构师批准
      if (checkArchitectApprovalInTranscript(sessionId, verificationState)) {
        if (verificationState.verification_scope === 'story' && verificationState.story_id) {
          markStoryArchitectVerified(workingDir, verificationState.story_id, undefined, sessionId);
          clearVerificationState(workingDir, sessionId);

          const refreshedState = readRalphState(workingDir, sessionId);
          if (refreshedState) {
            const refreshedPrd = getPrdCompletionStatus(workingDir, sessionId);
            refreshedState.current_story_id = refreshedPrd.nextStory?.id;
            writeRalphState(workingDir, refreshedState, sessionId);
          }
          verificationState = readVerificationState(workingDir, sessionId);
        } else {
          // 架构师已批准——真正完成
          // 若 ultrawork 与 ralph 同时活动，一并停用
          clearVerificationState(workingDir, sessionId);
          clearRalphState(workingDir, sessionId);
          deactivateUltrawork(workingDir, sessionId);
          const criticLabel = verificationState.critic_mode === 'codex'
            ? 'Codex critic'
            : verificationState.critic_mode === 'critic'
              ? 'Critic'
              : 'Architect';
          return {
            shouldBlock: false,
            message: `[RALPH LOOP VERIFIED COMPLETE] ${criticLabel} verified task completion after ${state.iteration} iteration(s). Excellent work!`,
            mode: 'none'
          };
        }
      }

      // 检查架构师拒绝
      const rejection = checkArchitectRejectionInTranscript(sessionId);
      if (verificationState && rejection.rejected) {
        if (verificationState.verification_scope === 'story' && verificationState.story_id) {
          markStoryIncomplete(workingDir, verificationState.story_id, rejection.feedback, sessionId);
        }
        // 架构师已拒绝——带反馈继续
        recordArchitectFeedback(workingDir, false, rejection.feedback, sessionId);
        const updatedVerification = readVerificationState(workingDir, sessionId);
        verificationState = updatedVerification;

        if (updatedVerification) {
          const continuationPrompt = getArchitectRejectionContinuationPrompt(updatedVerification);
          return {
            shouldBlock: true,
            message: continuationPrompt,
            mode: 'ralph',
            metadata: {
              iteration: state.iteration,
              maxIterations: state.max_iterations
            }
          };
        }
      }
    }

    if (verificationState?.pending) {
      const storyUnderReview = verificationState.story_id
        ? getStory(workingDir, verificationState.story_id, sessionId) ?? undefined
        : undefined;

      // 校验仍在进行——提醒运行所选审查者
      const verificationPrompt = getArchitectVerificationPrompt(verificationState, storyUnderReview);
      return {
        shouldBlock: true,
        message: verificationPrompt,
        mode: 'ralph',
        metadata: {
          iteration: state.iteration,
          maxIterations: state.max_iterations
        }
      };
    }
  }

  const prdStatus = getPrdCompletionStatus(workingDir, sessionId);
  const currentStory = state.current_story_id
    ? getStory(workingDir, state.current_story_id, sessionId)
    : prdStatus.nextStory;

  if (currentStory?.passes && currentStory.architectVerified !== true) {
    const startedVerification = startVerification(
      workingDir,
      `Story ${currentStory.id} is marked passes: true and requires architect approval before Ralph can progress.`,
      state.prompt,
      state.critic_mode,
      sessionId,
      currentStory
    );

    return {
      shouldBlock: true,
      message: getArchitectVerificationPrompt(startedVerification, currentStory),
      mode: 'ralph',
      metadata: {
        iteration: state.iteration,
        maxIterations: state.max_iterations
      }
    };
  }

  // 检查基于 PRD 的完成（所有 story 都标记 passes: true 且已通过架构师校验）。
  // 进入校验阶段而非立即清除 Ralph。
  if (prdStatus.hasPrd && prdStatus.allComplete) {
    const startedVerification = startVerification(
      workingDir,
      `All ${prdStatus.status?.total || 0} PRD stories are marked passes: true.`,
      state.prompt,
      state.critic_mode,
      sessionId
    );

    return {
      shouldBlock: true,
      message: getArchitectVerificationPrompt(startedVerification),
      mode: 'ralph',
      metadata: {
        iteration: state.iteration,
        maxIterations: state.max_iterations
      }
    };
  }

  // 硬上限：直接对照安全限制检查迭代次数，
  // 独立于 max_iterations，使其无法被较高的初始 max_iterations 绕过。
  const hardMax = getHardMaxIterations();
  if (hardMax > 0 && state.iteration >= hardMax) {
    // 达到硬上限——自动停用以防止无界执行
    state.active = false;
    if (!shouldWriteStateBack(ralphStatePath)) {
      return {
        shouldBlock: false,
        message: '',
        mode: 'none'
      };
    }
    writeRalphState(workingDir, state, sessionId);
    return {
      shouldBlock: true,
      message: `[RALPH - HARD LIMIT] Reached hard max iterations (${hardMax}). Mode auto-disabled. Restart with /wise:ralph if needed.`,
      mode: 'ralph',
      metadata: { iteration: state.iteration, maxIterations: state.max_iterations }
    };
  }

  // 检查最大迭代次数——延长上限，使用户可见的取消
  // 仍是唯一的显式终止路径。
  if (state.iteration >= state.max_iterations) {
    state.max_iterations += 10;
    if (!shouldWriteStateBack(ralphStatePath)) {
      return {
        shouldBlock: false,
        message: '',
        mode: 'none'
      };
    }
    writeRalphState(workingDir, state, sessionId);
  }

  // 生成消息前读取工具错误
  const toolError = readLastToolError(workingDir);
  const errorGuidance = getToolErrorRetryGuidance(toolError);

  // 递增并继续
  const newState = incrementRalphIteration(workingDir, sessionId);
  if (!newState) {
    return null;
  }

  // 获取 PRD 上下文用于注入
  const ralphContext = getRalphContext(workingDir, sessionId);
  const activePrdPath = prdStatus.hasPrd ? findPrdPath(workingDir, sessionId) : null;
  const prdInstruction = prdStatus.hasPrd
    ? `2. Check ${activePrdPath ?? 'prd.json'} - verify the current story's acceptance criteria are met, then mark it passes: true. Are ALL stories complete?`
    : `2. Check your todo list - are ALL items marked complete?`;

  const continuationPrompt = `<ralph-continuation>
${errorGuidance ? errorGuidance + '\n' : ''}
[RALPH - ITERATION ${newState.iteration}/${newState.max_iterations}]

The task is NOT complete yet. Continue working.
${ralphContext}
CRITICAL INSTRUCTIONS:
1. Review your progress and the original task
${prdInstruction}
3. Continue from where you left off
4. When FULLY complete (after ${state.critic_mode === 'codex' ? 'Codex critic' : state.critic_mode === 'critic' ? 'Critic' : 'Architect'} verification), run \`/wise:cancel\` to cleanly exit and clean up state files. If cancel fails, retry with \`/wise:cancel --force\`.
5. Do NOT stop until the task is truly done

${newState.prompt ? `Original task: ${truncatePromptForEcho(newState.prompt)}` : ''}

</ralph-continuation>

---

`;

  return {
    shouldBlock: true,
    message: continuationPrompt,
    mode: 'ralph',
    metadata: {
      iteration: newState.iteration,
      maxIterations: newState.max_iterations,
      toolError: toolError || undefined
    }
  };
}

// ---------------------------------------------------------------------------
// Stop Breaker 辅助函数（team pipeline 与 ralplan 共用）
// ---------------------------------------------------------------------------

interface StopBreakerState {
  count: number;
  updated_at: string;
}

function readStopBreaker(directory: string, name: string, sessionId?: string, ttlMs?: number): number {
  const stateDir = sessionId
    ? join(getWiseRoot(directory), 'state', 'sessions', sessionId)
    : join(getWiseRoot(directory), 'state');
  const breakerPath = join(stateDir, `${name}-stop-breaker.json`);

  try {
    if (!existsSync(breakerPath)) return 0;
    const raw = JSON.parse(readFileSync(breakerPath, 'utf-8')) as StopBreakerState;
    if (ttlMs && raw.updated_at) {
      const updatedAt = new Date(raw.updated_at).getTime();
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt > ttlMs) {
        unlinkSync(breakerPath);
        return 0;
      }
    }
    return typeof raw.count === 'number' ? raw.count : 0;
  } catch {
    return 0;
  }
}

function writeStopBreaker(directory: string, name: string, count: number, sessionId?: string): void {
  const stateDir = sessionId
    ? join(getWiseRoot(directory), 'state', 'sessions', sessionId)
    : join(getWiseRoot(directory), 'state');

  try {
    mkdirSync(stateDir, { recursive: true });
    const breakerPath = join(stateDir, `${name}-stop-breaker.json`);
    const data: StopBreakerState = { count, updated_at: new Date().toISOString() };
    atomicWriteJsonSync(breakerPath, data);
  } catch {
    // 忽略写入错误——fail-open
  }
}

// ---------------------------------------------------------------------------
// Team Pipeline 强制（独立 team 模式）
// ---------------------------------------------------------------------------

const TEAM_PIPELINE_STOP_BLOCKER_MAX = 20;
const TEAM_PIPELINE_STOP_BLOCKER_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * 检查 Team Pipeline 状态以进行独立 team 模式强制。
 * team 不带 ralph 运行时，由此提供 stop 钩子阻断。
 * team 带 ralph 运行时，由 checkRalphLoop() 处理（更高优先级）。
 */
async function checkTeamPipeline(
  sessionId?: string,
  directory?: string,
  cancelInProgress?: boolean
): Promise<PersistentModeResult | null> {
  const workingDir = resolveToWorktreeRoot(directory);
  const teamState = readTeamPipelineState(workingDir, sessionId);

  if (!teamState) {
    return null;
  }

  if (!teamState.active) {
    writeStopBreaker(workingDir, 'team-pipeline', 0, sessionId);
    return {
      shouldBlock: false,
      message: '',
      mode: 'team'
    };
  }


  // 会话隔离：readTeamPipelineState 已检查 session_id 匹配
  // 不匹配时返回 null（team-pipeline/state.ts:81）

  // 取消进行中则绕过
  if (cancelInProgress) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'team'
    };
  }

  // 先从规范的 team-pipeline/current_phase 形态读取阶段，
  // 再回退到 bridge.ts / 遗留 stage 字段以保持兼容。
  const rawPhase = teamState.phase
    ?? (teamState as unknown as Record<string, unknown>).current_phase
    ?? (teamState as unknown as Record<string, unknown>).currentStage
    ?? (teamState as unknown as Record<string, unknown>).current_stage
    ?? (teamState as unknown as Record<string, unknown>).stage;

  if (typeof rawPhase !== 'string') {
    // fail-open，但仍声明 mode='team'，使 bridge.ts 延用此结果
    // 而非运行自己的 team 强制（可能误阻断）。
    return { shouldBlock: false, message: '', mode: 'team' };
  }
  const phase = rawPhase.trim().toLowerCase();

  // 终态阶段——允许 stop
  if (phase === 'complete' || phase === 'completed' || phase === 'failed' || phase === 'cancelled' || phase === 'canceled' || phase === 'cancel') {
    writeStopBreaker(workingDir, 'team-pipeline', 0, sessionId);
    return {
      shouldBlock: false,
      message: '',
      mode: 'team'
    };
  }

  // fail-open：仅已知活动阶段才阻断。
  // 缺失、畸形或未知阶段不阻断（安全原则）。
  const KNOWN_ACTIVE_PHASES = new Set(['team-plan', 'team-prd', 'team-exec', 'team-verify', 'team-fix']);
  if (!KNOWN_ACTIVE_PHASES.has(phase)) {
    // 仍声明 mode='team'，使 bridge.ts 延用
    return { shouldBlock: false, message: '', mode: 'team' };
  }

  // 状态级终态检查（bridge.ts 格式使用 `status` 字段）
  const rawStatus = (teamState as unknown as Record<string, unknown>).status;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : null;
  if (status === 'cancelled' || status === 'canceled' || status === 'cancel' || status === 'failed' || status === 'complete' || status === 'completed') {
    writeStopBreaker(workingDir, 'team-pipeline', 0, sessionId);
    return {
      shouldBlock: false,
      message: '',
      mode: 'team'
    };
  }

  // team 状态上请求了取消——允许 stop
  if (teamState.cancel?.requested) {
    writeStopBreaker(workingDir, 'team-pipeline', 0, sessionId);
    return {
      shouldBlock: false,
      message: '',
      mode: 'team'
    };
  }

  // 断路器
  const breakerCount = readStopBreaker(workingDir, 'team-pipeline', sessionId, TEAM_PIPELINE_STOP_BLOCKER_TTL_MS) + 1;
  if (breakerCount > TEAM_PIPELINE_STOP_BLOCKER_MAX) {
    writeStopBreaker(workingDir, 'team-pipeline', 0, sessionId);
    return {
      shouldBlock: false,
      message: `[TEAM PIPELINE CIRCUIT BREAKER] Stop enforcement exceeded ${TEAM_PIPELINE_STOP_BLOCKER_MAX} reinforcements. Allowing stop to prevent infinite blocking.`,
      mode: 'team'
    };
  }
  writeStopBreaker(workingDir, 'team-pipeline', breakerCount, sessionId);

  return {
    shouldBlock: true,
    message: `<team-pipeline-continuation>

[TEAM PIPELINE - PHASE: ${phase.toUpperCase()} | REINFORCEMENT ${breakerCount}/${TEAM_PIPELINE_STOP_BLOCKER_MAX}]

The team pipeline is active in phase "${phase}". Continue working on the team workflow.
Do not stop until the pipeline reaches a terminal state (complete/failed/cancelled).
When done, run \`/wise:cancel\` to cleanly exit.

</team-pipeline-continuation>

---

`,
    mode: 'team',
    metadata: {
      phase,
      tasksCompleted: teamState.execution?.tasks_completed,
      tasksTotal: teamState.execution?.tasks_total,
    }
  };
}

// ---------------------------------------------------------------------------
// Ralplan 强制（独立共识规划）
// ---------------------------------------------------------------------------

const RALPLAN_STOP_BLOCKER_MAX = 30;
const RALPLAN_STOP_BLOCKER_TTL_MS = 45 * 60 * 1000; // 45 min
const RALPLAN_ACTIVE_AGENT_RECENCY_WINDOW_MS = 5_000;

interface RalplanState {
  active: boolean;
  session_id?: string;
  current_phase?: string;
  phase?: string;
  status?: string;
}

interface AutoresearchStopState {
  active: boolean;
  session_id?: string;
  current_phase?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
  max_runtime_ms?: number;
  deadline_at?: string;
  mission_slug?: string;
  iteration?: number;
}

function getAutoresearchDeadlineMs(state: AutoresearchStopState): number | null {
  if (typeof state.deadline_at === 'string' && state.deadline_at.trim().length > 0) {
    const parsed = new Date(state.deadline_at).getTime();
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (typeof state.max_runtime_ms === 'number' && Number.isFinite(state.max_runtime_ms)
    && typeof state.started_at === 'string' && state.started_at.trim().length > 0) {
    const startedAt = new Date(state.started_at).getTime();
    if (Number.isFinite(startedAt)) {
      return startedAt + state.max_runtime_ms;
    }
  }

  return null;
}

async function checkAutoresearch(
  sessionId?: string,
  directory?: string,
  cancelInProgress?: boolean
): Promise<PersistentModeResult | null> {
  const workingDir = resolveToWorktreeRoot(directory);
  let stateSourceSessionId = sessionId;
  let state = readModeState<AutoresearchStopState>('autoresearch', workingDir, sessionId);

  // Autoresearch 早于会话级状态文件。先保留严格会话化读取，
  // 再仅对匹配或未绑定的状态放行狭窄的遗留/共享桥接。
  if (!state && sessionId) {
    const legacyState = readModeState<AutoresearchStopState>('autoresearch', workingDir);
    if (!legacyState?.session_id || legacyState.session_id === sessionId) {
      state = legacyState;
      stateSourceSessionId = undefined;
    }
  }

  const stateRecord = state as Record<string, unknown> | null;
  const hasTimestampFields = Boolean(
    stateRecord
    && ['updated_at', 'started_at'].some((key) =>
      typeof stateRecord[key] === 'string' && String(stateRecord[key]).length > 0,
    ),
  );

  if (!state || !state.active || (hasTimestampFields && isStaleState(state))) {
    return null;
  }

  if (sessionId && state.session_id && state.session_id !== sessionId) {
    return null;
  }

  if (cancelInProgress) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'autoresearch',
    };
  }

  const phase = typeof state.current_phase === 'string'
    ? state.current_phase.trim().toLowerCase()
    : '';
  if (phase === 'completed' || phase === 'failed' || phase === 'stopped' || phase === 'cancelled') {
    return {
      shouldBlock: false,
      message: '',
      mode: 'autoresearch',
    };
  }

  const deadlineMs = getAutoresearchDeadlineMs(state);
  if (deadlineMs != null && Date.now() >= deadlineMs) {
    writeModeState('autoresearch', {
      ...(state as unknown as Record<string, unknown>),
      active: false,
      current_phase: 'stopped',
      completed_at: new Date().toISOString(),
      stop_reason: 'max-runtime ceiling reached',
    }, workingDir, stateSourceSessionId);

    return {
      shouldBlock: false,
      message: '[AUTORESEARCH COMPLETE] Max-runtime ceiling reached. Stop hook released the stateful autoresearch run.',
      mode: 'autoresearch',
      metadata: {
        iteration: typeof state.iteration === 'number' ? state.iteration : undefined,
      },
    };
  }

  const remaining = deadlineMs == null
    ? 'unknown'
    : `${Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000))}s`;
  const missionSlug = typeof state.mission_slug === 'string' && state.mission_slug
    ? state.mission_slug
    : 'unknown-mission';

  return {
    shouldBlock: true,
    message: `<autoresearch-continuation>

[AUTORESEARCH - STATEFUL MISSION ACTIVE]
Mission: ${missionSlug}
The autoresearch loop is still active and should continue iterating.
Do not stop just because the latest evaluation did not pass.
Strict stop boundary: explicit max-runtime ceiling.
Remaining runtime: ${remaining}

</autoresearch-continuation>

---
`,
    mode: 'autoresearch',
    metadata: {
      iteration: typeof state.iteration === 'number' ? state.iteration : undefined,
      phase: state.current_phase,
    },
  };
}

function getNormalizedRalplanPhase(state: Record<string, unknown> | null | undefined): string | null {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const rawPhase = state.current_phase ?? state.phase ?? state.status;
  if (typeof rawPhase !== 'string') {
    return null;
  }

  const phase = rawPhase.trim().toLowerCase();
  if (!phase) {
    return null;
  }

  if (phase === 'handoff' || phase.startsWith('handoff:') || phase.startsWith('handoff-')) {
    return 'handoff';
  }

  return phase;
}

/**
 * 检查 Ralplan 状态以进行独立 ralplan 模式强制。
 * Ralplan 状态由 MCP state_write 工具写入。
 * 阻断决策使用 `active`、`session_id` 以及规范化后的 phase/status 字段。
 */
async function checkRalplan(
  sessionId?: string,
  directory?: string,
  cancelInProgress?: boolean
): Promise<PersistentModeResult | null> {
  const workingDir = resolveToWorktreeRoot(directory);
  const state = readModeState<RalplanState>('ralplan', workingDir, sessionId);
  const stateRecord = state as any;
  const hasTimestampFields = Boolean(
    stateRecord &&
    ['last_checked_at', 'updated_at', 'started_at'].some((key) =>
      typeof stateRecord[key] === 'string' && String(stateRecord[key]).length > 0,
    ),
  );

  // 会话级 ralplan 状态在 CI 中可以合法省略时间戳。
  // 仅当存在新鲜度时间戳时才应用过期状态抑制。
  if (!state || !state.active || (hasTimestampFields && isStaleState(state))) {
    return null;
  }

  // 会话隔离
  if (sessionId && state.session_id && state.session_id !== sessionId) {
    return null;
  }

  if (isAwaitingConfirmation(state)) {
    return null;
  }

  // 终态阶段检测——ralplan 完成时允许 stop
  const currentPhase = getNormalizedRalplanPhase(state as unknown as Record<string, unknown>);
  if (currentPhase && RALPLAN_TERMINAL_PHASES.has(currentPhase)) {
    writeStopBreaker(workingDir, 'ralplan', 0, sessionId);
    return { shouldBlock: false, message: '', mode: 'ralplan' };
  }


  // 取消进行中则绕过
  if (cancelInProgress) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'ralplan'
    };
  }

  // 编排器在委派工作仍活动时允许空闲，
  // 但原始运行中代理计数可能滞后于真实生命周期，因为
  // SubagentStop/post-tool-use 记账发生在 stop 事件之后。仅当
  // 跟踪器自身更新足够新、看起来仍存活时才信任此绕过；否则 fail closed 并保持共识强制活动。
  const activeAgents = getActiveAgentSnapshot(workingDir);
  const activeAgentStateUpdatedAt = activeAgents.lastUpdatedAt ? new Date(activeAgents.lastUpdatedAt).getTime() : NaN;
  const hasFreshActiveAgentState =
    Number.isFinite(activeAgentStateUpdatedAt)
    && Date.now() - activeAgentStateUpdatedAt <= RALPLAN_ACTIVE_AGENT_RECENCY_WINDOW_MS;

  if (activeAgents.count > 0 && hasFreshActiveAgentState) {
    writeStopBreaker(workingDir, 'ralplan', 0, sessionId);
    return {
      shouldBlock: false,
      message: '',
      mode: 'ralplan',
    };
  }

  // 断路器
  const breakerCount = readStopBreaker(workingDir, 'ralplan', sessionId, RALPLAN_STOP_BLOCKER_TTL_MS) + 1;
  if (breakerCount > RALPLAN_STOP_BLOCKER_MAX) {
    writeStopBreaker(workingDir, 'ralplan', 0, sessionId);

    // 停用过期的 ralplan 状态，使后续 Stop 事件无法在工作流已耗尽
    // 断路器预算后开启全新的强化循环（30/30 -> 1/30）。
    (state as unknown as Record<string, unknown>).active = false;
    (state as unknown as Record<string, unknown>).deactivated_reason = 'stop_breaker_exhausted';
    (state as unknown as Record<string, unknown>).completed_at = new Date().toISOString();
    writeModeState('ralplan', state as unknown as Record<string, unknown>, workingDir, sessionId);

    return {
      shouldBlock: false,
      message: `[RALPLAN CIRCUIT BREAKER] Stop enforcement exceeded ${RALPLAN_STOP_BLOCKER_MAX} reinforcements. Allowing stop and deactivating stale ralplan state to prevent infinite restart loops.`,
      mode: 'ralplan'
    };
  }
  writeStopBreaker(workingDir, 'ralplan', breakerCount, sessionId);

  return {
    shouldBlock: true,
    message: `<ralplan-continuation>

[RALPLAN - CONSENSUS PLANNING | REINFORCEMENT ${breakerCount}/${RALPLAN_STOP_BLOCKER_MAX}]

The ralplan consensus workflow is active. Continue the Planner/Architect/Critic planning loop only.
Ralplan is read-only/planning mode: do not implement, invoke execution skills, edit source, commit, push, or open PRs from this continuation.
When consensus is reached, stop at a pending-approval handoff and require explicit user approval before execution.
When done, run \`/wise:cancel\` to cleanly exit.

</ralplan-continuation>

---

`,
    mode: 'ralplan',
  };
}

/**
 * 检查 Ultrawork 状态并判断是否应强化
 */
async function checkUltrawork(
  sessionId?: string,
  directory?: string,
  _hasIncompleteTodos?: boolean,
  cancelInProgress?: boolean
): Promise<PersistentModeResult | null> {
  const workingDir = resolveToWorktreeRoot(directory);
  const state = readUltraworkState(workingDir, sessionId);

  if (!state || !state.active || isStaleState(state)) {
    return null;
  }

  // 会话隔离。`readUltraworkState()` 已强制宽松形式
  // （"仅当两侧都有已定义 session_id 且不同时才拒绝"）。之前的严格检查
  // 会拒绝一侧未定义的合法情形——与 ralph 计数 bug 同一根因。
  if (state.session_id && sessionId && state.session_id !== sessionId) {
    return null;
  }

  if (isAwaitingConfirmation(state)) {
    return null;
  }

  // 使用 checkPersistentModes 缓存的取消信号以避免 TOCTOU 重读。
  if (cancelInProgress) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 若所有跟踪的工作都已完成，自动停用 ultrawork 并允许退出。
  // Issue #2419：否则 Stop 钩子可能在任务完成后仍持续阻断，
  // 使 ultrawork 保持活动直到手动 /cancel 或会话结束。
  if (!_hasIncompleteTodos) {
    deactivateUltrawork(workingDir, sessionId);
    return {
      shouldBlock: false,
      message: '[ULTRAWORK COMPLETE] No incomplete tasks remain. Ultrawork state cleared.',
      mode: 'none'
    };
  }

  // 对 ultrawork 强制硬上限迭代次数（与 ralph 强制一致）。
  const hardMax = getHardMaxIterations();
  if (hardMax > 0 && state.reinforcement_count >= hardMax) {
    deactivateUltrawork(workingDir, sessionId);
    return {
      shouldBlock: true,
      message: '[ULTRAWORK - HARD LIMIT] Reached hard max iterations (' + hardMax + '). Mode auto-disabled. Restart with /wise:ultrawork if needed.',
      mode: 'ultrawork',
      metadata: { reinforcementCount: state.reinforcement_count }
    };
  }

  // 在仍有未完成工作时强化 ultrawork 模式。
  // 防止任务中途因 bash 错误或瞬时故障导致的误停止。
  const newState = incrementReinforcement(workingDir, sessionId);
  if (!newState) {
    return null;
  }

  const message = getUltraworkPersistenceMessage(newState);

  return {
    shouldBlock: true,
    message,
    mode: 'ultrawork',
    metadata: {
      reinforcementCount: newState.reinforcement_count
    }
  };
}

/**
 * 检查未完成的 todo（基线强制）
 * 含最大尝试计数器，防止代理卡住时的无限循环
 */
async function _checkTodoContinuation(
  sessionId?: string,
  directory?: string
): Promise<PersistentModeResult | null> {
  const result = await checkIncompleteTodos(sessionId, directory);

  if (result.count === 0) {
    // todo 清空时重置计数器
    if (sessionId) {
      resetTodoContinuationAttempts(sessionId);
    }
    return null;
  }

  // 跟踪 continuation 尝试以防止无限循环
  const attemptCount = sessionId ? trackTodoContinuationAttempt(sessionId) : 1;

  // 基于来源使用动态标签（Tasks vs todos）
  const _sourceLabel = result.source === 'task' ? 'Tasks' : 'todos';
  const sourceLabelLower = result.source === 'task' ? 'tasks' : 'todos';

  if (attemptCount > MAX_TODO_CONTINUATION_ATTEMPTS) {
    // 尝试过多——代理似乎卡住，允许 stop 但告警
    return {
      shouldBlock: false,
      message: `[TODO CONTINUATION LIMIT] Attempted ${MAX_TODO_CONTINUATION_ATTEMPTS} continuations without progress. ${result.count} ${sourceLabelLower} remain incomplete. Consider reviewing the stuck ${sourceLabelLower} or asking the user for guidance.`,
      mode: 'none',
      metadata: {
        todoCount: result.count,
        todoContinuationAttempts: attemptCount
      }
    };
  }

  const nextTodo = getNextPendingTodo(result);
  const nextTaskInfo = nextTodo
    ? `\n\nNext ${result.source === 'task' ? 'Task' : 'todo'}: "${nextTodo.content}" (${nextTodo.status})`
    : '';

  const attemptInfo = attemptCount > 1
    ? `\n[Continuation attempt ${attemptCount}/${MAX_TODO_CONTINUATION_ATTEMPTS}]`
    : '';

  const message = `<todo-continuation>

${TODO_CONTINUATION_PROMPT}

[Status: ${result.count} of ${result.total} ${sourceLabelLower} remaining]${nextTaskInfo}${attemptInfo}

</todo-continuation>

---

`;

  return {
    shouldBlock: true,
    message,
    mode: 'todo-continuation',
    metadata: {
      todoCount: result.count,
      todoContinuationAttempts: attemptCount
    }
  };
}

/**
 * 主持久模式检查器
 * 按优先级顺序检查所有持久模式并返回相应动作
 */
export async function checkPersistentModes(
  sessionId?: string,
  directory?: string,
  stopContext?: StopContext  // 新增：来自 todo-continuation 类型
): Promise<PersistentModeResult> {
  const workingDir = resolveToWorktreeRoot(directory);

  // 硬 bypass 不变量：在任何这些环境级 kill switch 下绝不强制 stop continuation。
  // bridge.ts 也在钩子入口守护 DISABLE_WISE 和 WISE_SKIP_HOOKS，但此处再次检查，
  // 使直接调用方与嵌套辅助（team worker、测试）遵守同一契约。
  if (
    process.env.DISABLE_WISE === '1' ||
    process.env.DISABLE_WISE === 'true' ||
    process.env.WISE_TEAM_WORKER
  ) {
    return { shouldBlock: false, message: '', mode: 'none' };
  }
  const skipHooks = (process.env.WISE_SKIP_HOOKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (skipHooks.includes('persistent-mode') || skipHooks.includes('stop-continuation')) {
    return { shouldBlock: false, message: '', mode: 'none' };
  }

  // 尽力而为：在使用工作流槽账本作为 stop-gating 权威前，使其与终态模式状态对齐。
  // 这既修剪旧墓碑，也为已通过 Skill PostToolUse 完成钩子以外的路径达到终态/非活动状态的
  // autopilot/Ralph/ralplan 模式状态的活跃槽打墓碑。
  await reconcileTerminalWorkflowSlots(workingDir, sessionId);

  // 关键：绝不阻断 context-limit/critical-context stop。
  // 阻断这些会造成 Claude Code 无法压缩或退出的死锁。
  // 参见：https://github.com/wise-claw/wise/issues/213
  if (isCriticalContextStop(stopContext)) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 显式 /cancel 路径必须始终绕过 continuation 重新强化。
  // 防止关闭期间 stop 钩子持久化重新武装 Ralph/Ultrawork
  // （自愈、最大迭代延长、强化）的取消竞态。
  if (isExplicitCancelCommand(stopContext)) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // /cancel 流程中来自 state_clear 的会话级取消信号。
  // 缓存一次并传给子函数以避免 TOCTOU 重读（issue #1058）。
  const cancelInProgress = isSessionCancelInProgress(workingDir, sessionId);
  if (cancelInProgress) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 检查用户中止——跳过所有 continuation 强制
  if (isUserAbort(stopContext)) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 关键：绝不阻断 rate-limit stop。
  // API 返回 429 / 配额耗尽时，Claude Code 停止会话。
  // 阻断这些 stop 会造成无限重试循环：钩子注入 continuation prompt →
  // Claude 再次触发限流 → 再次 stop → 循环。
  // 修复：https://github.com/wise-claw/wise/issues/777
  if (isRateLimitStop(stopContext)) {
    return {
      shouldBlock: false,
      message: '[RALPH PAUSED - RATE LIMITED] API rate limit detected. Ralph loop paused until the rate limit resets. Resume manually once the limit clears.',
      mode: 'none'
    };
  }

  // 关键：绝不阻断认证/授权失败。
  // 过期的 OAuth/未授权响应否则可能触发无限 continuation 循环
  // （尤其配合分阶段 Team 模式 prompt）。
  // 修复：issue #1308
  if (isAuthenticationError(stopContext)) {
    return {
      shouldBlock: false,
      message: '[PERSISTENT MODE PAUSED - AUTHENTICATION ERROR] Authentication failure detected (for example 401/403 or expired OAuth token). Re-authenticate, then resume manually.',
      mode: 'none'
    };
  }

  // 关键：绝不阻断计划的 wakeup 恢复。
  // 原生 ScheduleWakeup 触发的 `/loop` 轮次是恢复，而非继续或
  // 清理先前持久模式的信号。此处重新强化可能从过期状态注入
  // `/cancel` 指引，导致计划轮次在真正工作运行前自我取消。
  if (isScheduledWakeupStop(stopContext)) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 过大的工具输出可能导致 Claude Code 在将载荷重定向到
  // `tool-results/*.txt` 文件指针后结束当前轮次。该 stop 并非真正的
  // 空闲/停滞信号：在重定向后立即注入可见的 Ralph/Ultrawork/todo
  // continuation 横幅会在代理仍任务中时刷屏 transcript。仅抑制
  // 此类重定向的一个小连续窗口；若重定向持续重复，则回落到常规
  // 持久化检查，使真正的停滞仍得到重新强化。
  if (isOversizeToolResultRedirectStop(stopContext)) {
    const redirectStopCount = readStopBreaker(
      workingDir,
      'oversize-tool-result-redirect',
      sessionId,
      OVERSIZE_TOOL_RESULT_REDIRECT_STOP_TTL_MS,
    ) + 1;
    writeStopBreaker(workingDir, 'oversize-tool-result-redirect', redirectStopCount, sessionId);

    if (redirectStopCount <= OVERSIZE_TOOL_RESULT_REDIRECT_STOP_MAX) {
      return {
        shouldBlock: false,
        message: '',
        mode: 'none'
      };
    }
  } else {
    writeStopBreaker(workingDir, 'oversize-tool-result-redirect', 0, sessionId);
  }

  // 若本会话拥有待处理的异步工作，静默是有意的：Claude
  // Code 会在后台完成时通知或通过 ScheduleWakeup 恢复。
  // 不要将该等待窗口转成 Ralph/持久模式停滞循环。
  if (hasPendingOwnedAsyncWork(workingDir, sessionId)) {
    return {
      shouldBlock: false,
      message: '',
      mode: 'none'
    };
  }

  // 首先检查未完成的 todo（ultrawork 需要此信息）
  // 注意：stopContext 已在上面检查，但为一致性仍传入
  const todoResult = await checkIncompleteTodos(sessionId, workingDir, stopContext);
  const hasIncompleteTodos = todoResult.count > 0;

  // 在直接模式优先级捷径前查询一次工作流账本。
  // `resolveAuthoritativeWorkflowSkill()` 返回活动链的根
  // （`autopilot → ralph` 中的 autopilot），使 stop 强制上溯到
  // 活动父级，而非当前在其下执行的子级。
  // 已打墓碑的槽单独跟踪，使崩溃会话的过期模式文件在 TTL 修剪或
  // 新鲜激活前不会重新武装优先级检查。
  const tombstonedWorkflowModes = new Set<string>();
  let workflowAuthority: string | null = null;
  try {
    const { readSkillActiveStateNormalized, resolveAuthoritativeWorkflowSkill } =
      await import('../skill-state/index.js');
    const ledger = readSkillActiveStateNormalized(workingDir, sessionId);
    const authority = resolveAuthoritativeWorkflowSkill(ledger);
    workflowAuthority = authority?.skill_name ?? null;
    for (const [name, slot] of Object.entries(ledger.active_skills)) {
      if (slot.completed_at) tombstonedWorkflowModes.add(name);
    }
  } catch {
    // 账本不可用——回退到遗留模式文件检测。
  }

  // 嵌套工作流运行的权威优先排序。
  //
  // `resolveAuthoritativeWorkflowSkill()` 返回活动链的根。
  // 在 `autopilot → ralph` 中，autopilot 是权威父级，ralph
  // 在其下运行——stop 强制必须解析到活动父级，使其迭代记账持续推进。
  // 账本沉默或权威已是 ralph 时，遗留排序（ralph > autopilot）仍适用。
  const autopilotPriorityFirst = workflowAuthority === 'autopilot';

  const runAutopilotPriority = async (): Promise<PersistentModeResult | null> => {
    if (
      tombstonedWorkflowModes.has('autopilot') ||
      !isAutopilotActive(workingDir, sessionId)
    ) {
      return null;
    }
    const autopilotResult = await checkAutopilot(sessionId, workingDir);
    if (!autopilotResult?.shouldBlock) return null;
    return {
      shouldBlock: true,
      message: autopilotResult.message,
      mode: 'autopilot',
      metadata: {
        iteration: autopilotResult.metadata?.iteration,
        maxIterations: autopilotResult.metadata?.maxIterations,
        phase: autopilotResult.phase,
        tasksCompleted: autopilotResult.metadata?.tasksCompleted,
        tasksTotal: autopilotResult.metadata?.tasksTotal,
        toolError: autopilotResult.metadata?.toolError,
      },
    };
  };

  const runRalphPriority = async (): Promise<PersistentModeResult | null> => {
    // 当权威注册表表明 Ralph 非活动时跳过。使 Stop 强制与
    // state_list_active 对齐，并忽略 cancel/state_clear 使注册表为空后的
    // 过期恢复/缓存产物（含已打墓碑的工作流槽）。
    if (tombstonedWorkflowModes.has('ralph') || !isModeActive('ralph', workingDir, sessionId)) return null;
    return checkRalphLoop(sessionId, workingDir, cancelInProgress);
  };

  if (autopilotPriorityFirst) {
    const autopilotResult = await runAutopilotPriority();
    if (autopilotResult) return autopilotResult;
    const ralphResult = await runRalphPriority();
    if (ralphResult) return ralphResult;
  } else {
    const ralphResult = await runRalphPriority();
    if (ralphResult) return ralphResult;
    const autopilotResult = await runAutopilotPriority();
    if (autopilotResult) return autopilotResult;
  }

  // 优先级 1.6：Autoresearch（有状态单任务运行时）
  const autoresearchResult = await checkAutoresearch(sessionId, workingDir, cancelInProgress);
  if (autoresearchResult) {
    return autoresearchResult;
  }

  // 优先级 1.7：Ralplan（独立共识规划）
  // Ralplan 共识循环（Planner/Architect/Critic）需要硬阻断。
  // ralplan 在 ralph 下运行时由 checkRalphLoop() 处理（优先级 1）。
  // 返回任意非 null 结果（含断路器 shouldBlock=false 带 message）。
  // ralplan 槽已打墓碑时抑制，使完成时吵闹的重新交接停止，
  // 直到墓碑 TTL 过期或新槽重新开启。
  if (!tombstonedWorkflowModes.has('ralplan')) {
    const ralplanResult = await checkRalplan(sessionId, workingDir, cancelInProgress);
    if (ralplanResult) {
      return ralplanResult;
    }
  }

  // 优先级 1.8：Team Pipeline（独立 team 模式）
  // team 不带 ralph 运行时由此提供 stop 钩子阻断。
  // team 带 ralph 运行时由 checkRalphLoop() 处理（优先级 1）。
  // 返回任意非 null 结果（含断路器 shouldBlock=false 带 message）。
  if (!tombstonedWorkflowModes.has('team')) {
    const teamResult = await checkTeamPipeline(sessionId, workingDir, cancelInProgress);
    if (teamResult) {
      return teamResult;
    }
  }

  // 优先级 2：Ultrawork 模式（带持久化的性能模式）
  if (!tombstonedWorkflowModes.has('ultrawork') && isModeActive('ultrawork', workingDir, sessionId)) {
    const ultraworkResult = await checkUltrawork(sessionId, workingDir, hasIncompleteTodos, cancelInProgress);
    if (ultraworkResult) {
      return ultraworkResult;
    }
  }

  // 优先级 3：Skill 活动状态（issue #1033）
  // code-review、plan、tdd 等 skill 通过 Skill 工具调用时写入
  // skill-active-state.json。防止 skill 进行中过早 stop。
  try {
    const { checkSkillActiveState } = await import('../skill-state/index.js');
    const skillResult = checkSkillActiveState(workingDir, sessionId);
    if (skillResult.shouldBlock) {
      return {
        shouldBlock: true,
        message: skillResult.message,
        mode: 'ultrawork' as const, // 复用 ultrawork 模式类型以保持兼容
        metadata: {
          phase: `skill:${skillResult.skillName || 'unknown'}`,
        }
      };
    }
  } catch {
    // skill-state 模块不可用时优雅跳过
  }

  // 无需阻断
  return {
    shouldBlock: false,
    message: '',
    mode: 'none'
  };
}

/**
 * 为 Claude Code 创建钩子输出。
 * `shouldBlock` 为 true 时返回 `continue: false` 以硬阻断 stop 事件。
 * 终态、逃生出口与错误时返回 `continue: true`。
 */
export function createHookOutput(result: PersistentModeResult): {
  continue: boolean;
  message?: string;
} {
  return {
    continue: !result.shouldBlock,
    message: result.message || undefined
  };
}
