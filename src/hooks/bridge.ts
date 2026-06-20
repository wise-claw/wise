/**
 * 钩子桥接 - 由 shell 脚本调用的 TypeScript 逻辑
 *
 * 本模块为 shell 钩子调用 TypeScript 进行复杂处理提供主入口。
 * shell 脚本读取 stdin，将其传递给本模块，再把 JSON 输出写入 stdout。
 *
 * Shell 调用方式：
 * ```bash
 * #!/bin/bash
 * INPUT=$(cat)
 * echo "$INPUT" | node ~/.claude/wise/hook-bridge.mjs --hook=keyword-detector
 * ```
 */

import { pathToFileURL } from "url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { resolveToWorktreeRoot, getWiseRoot } from "../lib/worktree-paths.js";
import { readModeState, writeModeState } from "../lib/mode-state-io.js";
import { SESSION_END_MODE_STATE_FILES } from "../lib/mode-names.js";
import { formatWiseCliInvocation } from "../utils/wise-cli-rendering.js";
import { createSwallowedErrorLogger } from "../lib/swallowed-error.js";
import { dispatchNotificationInBackground } from "./background-notifications.js";
import { readCanonicalTeamStateCandidate } from "./team-canonical-state.js";

// 热路径导入：每次/大多数钩子调用都会用到（keyword-detector、pre/post-tool-use）
import {
  removeCodeBlocks,
  getAllKeywordsWithSizeCheck,
  applyRalplanGate,
  sanitizeForKeywordDetection,
  NON_LATIN_SCRIPT_PATTERN,
} from "./keyword-detector/index.js";
import {
  processOrchestratorPreTool,
  processOrchestratorPostTool,
} from "./wise-orchestrator/index.js";
import { normalizeHookInput } from "./bridge-normalize.js";
import {
  addBackgroundTask,
  completeBackgroundTask,
  completeMostRecentMatchingBackgroundTask,
  getRunningTaskCount,
  remapBackgroundTaskId,
  remapMostRecentMatchingBackgroundTaskId,
} from "../hud/background-tasks.js";
import { readHudState, writeHudState } from "../hud/state.js";
import { compactWiseStartupGuidance, loadConfig } from "../config/loader.js";
import {
  activatePromptPrerequisiteState,
  buildPromptPrerequisiteDenyReason,
  buildPromptPrerequisiteReminder,
  clearPromptPrerequisiteState,
  getPromptPrerequisiteConfig,
  isPromptPrerequisiteBlockingTool,
  parsePromptPrerequisiteSections,
  readPromptPrerequisiteState,
  recordPromptPrerequisiteProgress,
  shouldEnforcePromptPrerequisites,
} from "./prompt-prerequisites/index.js";
import {
  resolveAutopilotPlanPath,
  resolveOpenQuestionsPlanPath,
} from "../config/plan-output.js";
import { formatAutopilotRuntimeInsight } from "./autopilot/runtime-insight.js";
import {
  writeSkillActiveState,
  isCanonicalWorkflowSkill,
  upsertWorkflowSkillSlot,
  markWorkflowSkillCompleted,
  pruneExpiredWorkflowSkillTombstones,
  readSkillActiveStateNormalized,
  writeSkillActiveStateCopies,
  type ActiveSkillSlot,
} from "./skill-state/index.js";
import { parseExplicitWorkflowSlashInvocation } from "./keyword-detector/index.js";
import {
  ULTRATHINK_MESSAGE,
  SEARCH_MESSAGE,
  ANALYZE_MESSAGE,
  TDD_MESSAGE,
  CODE_REVIEW_MESSAGE,
  SECURITY_REVIEW_MESSAGE,
  RALPH_MESSAGE,
  PROMPT_TRANSLATION_MESSAGE,
} from "../installer/hooks.js";
import { getUltraworkMessage } from "./keyword-detector/ultrawork/index.js";
// 代理仪表盘用于 pre/post-tool-use 热路径
import { getAgentDashboard } from "./subagent-tracker/index.js";
// 会话回放的 recordFileTouch 用于 pre-tool-use 热路径
import { recordFileTouch } from "./subagent-tracker/session-replay.js";
// 延迟加载模块的类型-only 导入（零运行时开销）
import type {
  SubagentStartInput,
  SubagentStopInput,
} from "./subagent-tracker/index.js";
import type { PreCompactInput } from "./pre-compact/index.js";
import type { SetupInput } from "./setup/index.js";
import {
  getBackgroundBashPermissionFallback,
  getBackgroundTaskPermissionFallback,
  type PermissionRequestInput,
} from "./permission-handler/index.js";
import type { SessionEndInput } from "./session-end/index.js";
import type { StopContext } from "./todo-continuation/index.js";
// 安全：包装不可信文件内容以防止 prompt 注入
import { wrapUntrustedFileContent } from "../agents/prompt-helpers.js";

const PKILL_F_FLAG_PATTERN = /\bpkill\b.*\s-f\b/;
const PKILL_FULL_FLAG_PATTERN = /\bpkill\b.*--full\b/;
const WORKER_BLOCKED_TMUX_PATTERN = /\btmux\s+/i;
const WORKER_BLOCKED_TEAM_CLI_PATTERN = /\b(?:wise|omx)\s+team\b(?!\s+api\b)/i;
const WORKER_BLOCKED_SKILL_PATTERN = /\$(team|ultrawork|autopilot|ralph)\b/i;

const TEAM_TERMINAL_VALUES = new Set([
  "completed",
  "complete",
  "cancelled",
  "canceled",
  "cancel",
  "failed",
  "aborted",
  "terminated",
  "done",
]);
const TEAM_ACTIVE_STAGES = new Set([
  "team-plan",
  "team-prd",
  "team-exec",
  "team-verify",
  "team-fix",
]);
const TEAM_STOP_BLOCKER_MAX = 20;
const TEAM_STOP_BLOCKER_TTL_MS = 5 * 60 * 1000;
const TEAM_STAGE_ALIASES: Record<string, string> = {
  planning: "team-plan",
  prd: "team-prd",
  executing: "team-exec",
  execution: "team-exec",
  verify: "team-verify",
  verification: "team-verify",
  fix: "team-fix",
  fixing: "team-fix",
};

const BACKGROUND_AGENT_ID_PATTERN = /agentId:\s*([a-zA-Z0-9_-]+)/;
const BACKGROUND_BASH_ID_PATTERN = /(?:background (?:bash )?(?:command|process|task).*?(?:id|ID)|bash_id|task_id)[:=]\s*([a-zA-Z0-9_-]+)/i;
const TASK_OUTPUT_ID_PATTERN = /<task_id>([^<]+)<\/task_id>/i;
const TASK_OUTPUT_STATUS_PATTERN = /<status>([^<]+)<\/status>/i;
const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/;
const MODE_CONFIRMATION_SKILL_MAP: Record<string, string[]> = {
  ralph: ["ralph", "ultrawork"],
  ultrawork: ["ultrawork"],
  autopilot: ["autopilot"],
  ralplan: ["ralplan"],
};

const SESSION_START_CONTEXT_BUDGET = 6000;
const SESSION_START_OMISSION_NOTICE = '[Additional SessionStart context omitted to preserve the 6000-character aggregate budget.]';
const SESSION_STARTED_MARKER_FILE = "session-started.json";
const LINUX_BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

interface SessionStartedMarker {
  session_id?: string;
  started_at?: string;
  cwd?: string;
  pid?: number;
  ppid?: number;
  boot_id?: string;
}

function compactBudgetedText(text: string, maxChars: number): string {
  const notice = "\n...[truncated to preserve SessionStart context budget]";
  if (!text || text.length <= maxChars) return text || "";
  if (maxChars <= notice.length) return notice.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - notice.length).trimEnd()}${notice}`;
}

function buildSessionStartAdditionalContext(messages: string[]): string {
  if (messages.length === 0) return "";

  const priorityOrder = [
    /\[MODEL ROUTING OVERRIDE/,
    /\[AUTOPILOT MODE RESTORED\]/,
    /\[ULTRAWORK MODE RESTORED\]/,
    /\[RALPLAN MODE RESTORED\]/,
    /\[TEAM MODE RESTORED\]/,
    /\[ROOT AGENTS\.md LOADED\]/,
    /\[PENDING TASKS DETECTED\]/,
  ];
  const ordered = messages
    .map((message, index) => {
      const priority = priorityOrder.findIndex((pattern) => pattern.test(message));
      return { message, index, priority: priority === -1 ? priorityOrder.length + index : priority };
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.message);

  let used = 0;
  const selected: string[] = [];
  for (const message of ordered) {
    const separatorLength = selected.length > 0 ? 1 : 0;
    if (used + separatorLength + message.length > SESSION_START_CONTEXT_BUDGET) {
      const remainingBudget = SESSION_START_CONTEXT_BUDGET - used - separatorLength;
      if (remainingBudget > 0) {
        selected.push(
          remainingBudget > 120
            ? compactBudgetedText(message, remainingBudget)
            : compactBudgetedText(SESSION_START_OMISSION_NOTICE, remainingBudget),
        );
      }
      break;
    }
    selected.push(message);
    used += separatorLength + message.length;
  }

  return selected.join("\n");
}

function readLinuxBootId(): string | undefined {
  const testBootId = process.env.WISE_TEST_BOOT_ID?.trim();
  if (testBootId) return testBootId;

  try {
    if (!existsSync(LINUX_BOOT_ID_PATH)) return undefined;
    const bootId = readFileSync(LINUX_BOOT_ID_PATH, "utf-8").trim();
    return bootId.length > 0 ? bootId : undefined;
  } catch {
    return undefined;
  }
}

function sessionStateDir(directory: string, sessionId: string): string {
  return join(getWiseRoot(directory), "state", "sessions", sessionId);
}

function sessionStartedMarkerPath(directory: string, sessionId: string): string {
  return join(sessionStateDir(directory, sessionId), SESSION_STARTED_MARKER_FILE);
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function writeSessionStartedMarker(directory: string, sessionId?: string): void {
  if (!sessionId || !SAFE_SESSION_ID_PATTERN.test(sessionId)) return;

  try {
    const dir = sessionStateDir(directory, sessionId);
    mkdirSync(dir, { recursive: true });
    const marker: SessionStartedMarker = {
      session_id: sessionId,
      started_at: new Date().toISOString(),
      cwd: directory,
      pid: process.pid,
      // 此处不要持久化 process.ppid：已安装的钩子通过
      // scripts/run.cjs 运行，该短命进程在本钩子返回后即退出。
      // 将该 runner PID 当作存活属主会导致后续 SessionStart 钩子
      // 误清理仍然存活的会话状态。
      boot_id: readLinuxBootId(),
    };
    writeFileSync(sessionStartedMarkerPath(directory, sessionId), JSON.stringify(marker, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    // SessionStart 标记是尽力而为的，绝不能阻断启动。
  }
}

function removeSessionStartedMarker(directory: string, sessionId?: string): void {
  if (!sessionId || !SAFE_SESSION_ID_PATTERN.test(sessionId)) return;

  try {
    const markerPath = sessionStartedMarkerPath(directory, sessionId);
    if (existsSync(markerPath)) {
      unlinkSync(markerPath);
    }
  } catch {
    // 仅做尽力而为的标记清理。
  }
}

function hasSessionEndSummary(directory: string, sessionId: string): boolean {
  return existsSync(join(getWiseRoot(directory), "sessions", `${sessionId}.json`));
}

function cleanupSessionModeStateFiles(directory: string, sessionId: string): void {
  const dir = sessionStateDir(directory, sessionId);

  for (const { file } of SESSION_END_MODE_STATE_FILES) {
    const filePath = join(dir, file);
    const state = readJsonObject(filePath);

    // SessionStart 的对账刻意比 SessionEnd 更窄：
    // 只删除显式 stale 会话目录内的文件。不要触碰
    // legacy/全局状态，即使它无属主或与某个模式同名。
    if (state?.active === true || file === "skill-active-state.json") {
      try {
        unlinkSync(filePath);
      } catch {
        // 删除失败时保留文件原样。
      }
    }
  }
}

function cleanupMissionStateForSession(directory: string, sessionId: string): void {
  const missionStatePath = join(getWiseRoot(directory), "state", "mission-state.json");
  const parsed = readJsonObject(missionStatePath) as {
    updatedAt?: string;
    missions?: Array<Record<string, unknown>>;
  } | null;

  if (!Array.isArray(parsed?.missions)) return;

  const before = parsed.missions.length;
  parsed.missions = parsed.missions.filter((mission) => {
    if (mission.source !== "session") return true;
    const missionId = typeof mission.id === "string" ? mission.id : "";
    return !missionId.includes(sessionId);
  });

  if (parsed.missions.length === before) return;

  try {
    parsed.updatedAt = new Date().toISOString();
    writeFileSync(missionStatePath, JSON.stringify(parsed, null, 2));
  } catch {
    // 仅做尽力而为的清理。
  }
}

/**
 * 仅当 SessionStart 存在持久的废弃证据时返回 true。
 *
 * Claude Code 的 SessionStart 输入当前提供 session_id、transcript_path、
 * cwd、source、model、agent_type 等会话元数据，但没有交互式会话的稳定
 * 属主进程。在已安装的 WISE 钩子中，直接父进程属于 scripts/run.cjs 且
 * 刻意设计为短命，因此此处的同启动 PID 存活检查并不可靠。SessionEnd
 * 仍是主要的同启动清理路径；SessionStart 仅对账持久残留，例如上一次
 * OS 启动留下的标记。
 */
function hasDurableAbandonmentEvidence(marker: SessionStartedMarker): boolean {
  const storedBootId = typeof marker.boot_id === "string" ? marker.boot_id : undefined;
  const currentBootId = readLinuxBootId();
  if (storedBootId && currentBootId && storedBootId !== currentBootId) {
    return true;
  }

  // 同启动硬杀清理需要持久的属主信号。Claude Code 目前
  // 未向钩子提供该信号，因此保留 active 状态，而不是从
  // hook-runner 进程谱系或 transcript 元数据中猜测。
  return false;
}

async function reconcileAbandonedSessionStarts(directory: string, currentSessionId?: string): Promise<void> {
  const sessionsDir = join(getWiseRoot(directory), "state", "sessions");
  if (!existsSync(sessionsDir)) return;

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return;
  }

  for (const sessionId of entries) {
    if (!SAFE_SESSION_ID_PATTERN.test(sessionId) || sessionId === currentSessionId) continue;

    const markerPath = sessionStartedMarkerPath(directory, sessionId);
    const marker = readJsonObject(markerPath) as SessionStartedMarker | null;
    if (!marker) continue;

    // 仅认显式属主：标记必须属于该会话目录。
    if (marker.session_id !== sessionId) continue;

    // 若 SessionEnd 已写入其摘要，则只删除遗留标记。
    if (hasSessionEndSummary(directory, sessionId)) {
      removeSessionStartedMarker(directory, sessionId);
      continue;
    }

    if (!hasDurableAbandonmentEvidence(marker)) continue;

    // 刻意收窄：只清理 WISE 会话级 mode/mission 状态。
    // 不要在此处调用 team 运行时关闭；SessionStart 不得杀掉 tmux PID。
    cleanupSessionModeStateFiles(directory, sessionId);
    cleanupMissionStateForSession(directory, sessionId);
    removeSessionStartedMarker(directory, sessionId);

    try {
      const remaining = readdirSync(sessionStateDir(directory, sessionId));
      if (remaining.length === 0) {
        rmdirSync(sessionStateDir(directory, sessionId));
      }
    } catch {
      // 不动非空/不可读的目录。
    }
  }
}


function getExtraField(input: HookInput, key: string): unknown {
  return (input as Record<string, unknown>)[key];
}

function getHookToolUseId(input: HookInput): string | undefined {
  const value = getExtraField(input, "tool_use_id");
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getHookContextString(input: HookInput, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getExtraField(input, key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function extractAsyncAgentId(toolOutput: unknown): string | undefined {
  if (typeof toolOutput !== "string") {
    return undefined;
  }
  return toolOutput.match(BACKGROUND_AGENT_ID_PATTERN)?.[1];
}

function extractBackgroundBashId(toolOutput: unknown): string | undefined {
  if (typeof toolOutput !== "string") {
    return undefined;
  }
  return toolOutput.match(BACKGROUND_BASH_ID_PATTERN)?.[1];
}

function bashLaunchIsBackgroundPending(toolOutput: unknown): boolean {
  if (typeof toolOutput !== "string") {
    return false;
  }

  const normalized = toolOutput.toLowerCase();
  return normalized.includes("running in the background")
    || normalized.includes("started in the background")
    || normalized.includes("background command")
    || normalized.includes("background process")
    || Boolean(extractBackgroundBashId(toolOutput));
}

function parseTaskOutputLifecycle(toolOutput: unknown): { taskId: string; status: string } | null {
  if (typeof toolOutput !== "string") {
    return null;
  }

  const taskId = toolOutput.match(TASK_OUTPUT_ID_PATTERN)?.[1]?.trim();
  const status = toolOutput.match(TASK_OUTPUT_STATUS_PATTERN)?.[1]?.trim().toLowerCase();
  if (!taskId || !status) {
    return null;
  }

  return { taskId, status };
}

function taskOutputDidFail(status: string): boolean {
  return status === "failed" || status === "error";
}

function taskLaunchDidFail(toolOutput: unknown): boolean {
  if (typeof toolOutput !== "string") {
    return false;
  }

  const normalized = toolOutput.toLowerCase();
  return normalized.includes("error") || normalized.includes("failed");
}

function getSessionStateDir(directory: string, sessionId?: string): string {
  const stateDir = join(getWiseRoot(directory), "state");
  if (sessionId && SAFE_SESSION_ID_PATTERN.test(sessionId)) {
    return join(stateDir, "sessions", sessionId);
  }
  return stateDir;
}

function getScheduledWakeupStatePath(directory: string, sessionId?: string): string {
  return join(getSessionStateDir(directory, sessionId), "scheduled-wakeup-state.json");
}

function parseWakeupDueAt(toolInput: unknown): string | undefined {
  if (!toolInput || typeof toolInput !== "object") {
    return undefined;
  }

  const input = toolInput as Record<string, unknown>;
  const absolute = input.due_at ?? input.wakeup_at ?? input.scheduled_for ?? input.deadline_at ?? input.at;
  if (typeof absolute === "string") {
    const parsed = new Date(absolute).getTime();
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  const delaySeconds = input.seconds ?? input.delay_seconds ?? input.delaySeconds;
  if (typeof delaySeconds === "number" && Number.isFinite(delaySeconds)) {
    return new Date(Date.now() + Math.max(0, delaySeconds) * 1000).toISOString();
  }

  const delayMs = input.milliseconds ?? input.delay_ms ?? input.delayMs;
  if (typeof delayMs === "number" && Number.isFinite(delayMs)) {
    return new Date(Date.now() + Math.max(0, delayMs)).toISOString();
  }

  const delayMinutes = input.minutes ?? input.delay_minutes ?? input.delayMinutes;
  if (typeof delayMinutes === "number" && Number.isFinite(delayMinutes)) {
    return new Date(Date.now() + Math.max(0, delayMinutes) * 60_000).toISOString();
  }

  return undefined;
}

function recordScheduledWakeup(directory: string, sessionId: string | undefined, toolInput: unknown): void {
  try {
    const statePath = getScheduledWakeupStatePath(directory, sessionId);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          active: true,
          pending: true,
          status: "pending",
          session_id: sessionId,
          created_at: new Date().toISOString(),
          due_at: parseWakeupDueAt(toolInput),
        },
        null,
        2,
      ),
    );
  } catch {
    // 唤醒状态是尽力而为的；绝不让钩子失败。
  }
}

function getModeStatePaths(directory: string, modeName: string, sessionId?: string): string[] {
  const stateDir = join(getWiseRoot(directory), "state");
  const safeSessionId = typeof sessionId === "string" && SAFE_SESSION_ID_PATTERN.test(sessionId)
    ? sessionId
    : undefined;

  return [
    safeSessionId ? join(stateDir, "sessions", safeSessionId, `${modeName}-state.json`) : null,
    join(stateDir, `${modeName}-state.json`),
  ].filter((statePath): statePath is string => Boolean(statePath));
}

function updateModeAwaitingConfirmation(
  directory: string,
  modeName: string,
  sessionId: string | undefined,
  awaitingConfirmation: boolean,
): void {
  for (const statePath of getModeStatePaths(directory, modeName, sessionId)) {
    if (!existsSync(statePath)) {
      continue;
    }

    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
      if (!state || typeof state !== "object") {
        continue;
      }

      if (awaitingConfirmation) {
        state.awaiting_confirmation = true;
        state.awaiting_confirmation_set_at = new Date().toISOString();
      } else if (state.awaiting_confirmation === true) {
        delete state.awaiting_confirmation;
        delete state.awaiting_confirmation_set_at;
      } else {
        continue;
      }

      const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(state, null, 2));
      renameSync(tmpPath, statePath);
    } catch {
      // 仅做尽力而为的状态同步。
    }
  }
}

function markModeAwaitingConfirmation(
  directory: string,
  sessionId: string | undefined,
  ...modeNames: string[]
): void {
  for (const modeName of modeNames) {
    updateModeAwaitingConfirmation(directory, modeName, sessionId, true);
  }
}

function confirmSkillModeStates(directory: string, skillName: string, sessionId?: string): void {
  for (const modeName of MODE_CONFIRMATION_SKILL_MAP[skillName] ?? []) {
    updateModeAwaitingConfirmation(directory, modeName, sessionId, false);
  }
}

function getSkillInvocationArgs(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }

  const input = toolInput as Record<string, unknown>;
  const candidates = [
    input.args,
    input.arguments,
    input.argument,
    input.skill_args,
    input.skillArgs,
    input.prompt,
    input.description,
    input.input,
  ];

  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function isConsensusPlanningSkillInvocation(skillName: string | null, toolInput: unknown): boolean {
  if (!skillName) {
    return false;
  }

  if (skillName === "ralplan") {
    return true;
  }

  if (skillName !== "wise-plan" && skillName !== "plan") {
    return false;
  }

  return getSkillInvocationArgs(toolInput).toLowerCase().includes("--consensus");
}

function activateRalplanState(directory: string, sessionId?: string): void {
  writeModeState(
    "ralplan",
    {
      active: true,
      session_id: sessionId,
      current_phase: "ralplan",
      started_at: new Date().toISOString(),
    },
    directory,
    sessionId,
  );
}

function deactivateRalplanState(directory: string, sessionId?: string): void {
  const state = readModeState<Record<string, unknown>>("ralplan", directory, sessionId);
  if (!state) {
    return;
  }

  const currentPhase =
    typeof state.current_phase === "string" ? state.current_phase : undefined;
  const terminalPhases = new Set([
    "complete",
    "completed",
    "failed",
    "cancelled",
    "done",
  ]);
  const completedAt =
    typeof state.completed_at === "string"
      ? state.completed_at
      : new Date().toISOString();

  writeModeState(
    "ralplan",
    {
      ...state,
      active: false,
      current_phase:
        currentPhase && terminalPhases.has(currentPhase.toLowerCase())
          ? currentPhase
          : "complete",
      completed_at: completedAt,
      deactivated_reason:
        typeof state.deactivated_reason === "string"
          ? state.deactivated_reason
          : "skill_completed",
    },
    directory,
    sessionId,
  );
}

function seedRalplanStartupState(directory: string, sessionId?: string): void {
  const existingState = readModeState<Record<string, unknown>>("ralplan", directory, sessionId);
  if (existingState?.active === true) {
    if (existingState.awaiting_confirmation === true) {
      markModeAwaitingConfirmation(directory, sessionId, "ralplan");
    }
    return;
  }

  activateRalplanState(directory, sessionId);
  markModeAwaitingConfirmation(directory, sessionId, "ralplan");
}

async function seedAutopilotStartupState(
  directory: string,
  prompt: string,
  sessionId?: string,
): Promise<void> {
  const { readAutopilotState, writeAutopilotState, DEFAULT_CONFIG } = await import("./autopilot/index.js");
  const existingState = readAutopilotState(directory, sessionId);
  const existingAutopilotRecord = existingState as unknown as Record<string, unknown> | null;

  if (existingState?.active === true) {
    if (existingAutopilotRecord?.awaiting_confirmation === true) {
      markModeAwaitingConfirmation(directory, sessionId, "autopilot");
    }
    return;
  }

  const now = new Date().toISOString();
  const wrote = writeAutopilotState(
    directory,
    {
      active: true,
      phase: "expansion",
      current_phase: "expansion",
      iteration: 1,
      max_iterations: DEFAULT_CONFIG.maxIterations ?? 10,
      originalIdea: prompt,
      expansion: {
        analyst_complete: false,
        architect_complete: false,
        spec_path: null,
        requirements_summary: "",
        tech_stack: [],
      },
      planning: {
        plan_path: null,
        architect_iterations: 0,
        approved: false,
      },
      execution: {
        ralph_iterations: 0,
        ultrawork_active: false,
        tasks_completed: 0,
        tasks_total: 0,
        files_created: [],
        files_modified: [],
      },
      qa: {
        ultraqa_cycles: 0,
        build_status: "pending",
        lint_status: "pending",
        test_status: "pending",
      },
      validation: {
        architects_spawned: 0,
        verdicts: [],
        all_approved: false,
        validation_rounds: 0,
      },
      started_at: now,
      completed_at: null,
      phase_durations: {},
      total_agents_spawned: 0,
      wisdom_entries: 0,
      session_id: sessionId,
      project_path: directory,
    },
    sessionId,
  );
  if (wrote) {
    markModeAwaitingConfirmation(directory, sessionId, "autopilot");
  }
}

interface TeamStagedState {
  active?: boolean;
  stage?: string;
  current_stage?: string;
  currentStage?: string;
  current_phase?: string;
  phase?: string;
  status?: string;
  session_id?: string;
  sessionId?: string;
  team_name?: string;
  teamName?: string;
  started_at?: string;
  startedAt?: string;
  task?: string;
  cancelled?: boolean;
  canceled?: boolean;
  completed?: boolean;
  terminal?: boolean;
  reinforcement_count?: number;
  last_checked_at?: string;
}

function readTeamStagedState(
  directory: string,
  sessionId?: string,
): TeamStagedState | null {
  const stateDir = join(getWiseRoot(directory), "state");
  const statePaths = sessionId
    ? [
        join(stateDir, "sessions", sessionId, "team-state.json"),
        join(stateDir, "team-state.json"),
      ]
    : [join(stateDir, "team-state.json")];

  let coarseState: TeamStagedState | null = null;
  for (const statePath of statePaths) {
    if (!existsSync(statePath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(
        readFileSync(statePath, "utf-8"),
      ) as TeamStagedState;
      if (typeof parsed !== "object" || parsed === null) {
        continue;
      }

      const stateSessionId = parsed.session_id || parsed.sessionId;
      if (sessionId && stateSessionId && stateSessionId !== sessionId) {
        continue;
      }

      coarseState = parsed;
      if (parsed.active === true && !isTeamStateTerminal(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  const canonical = readCanonicalTeamStateCandidate(directory, sessionId);
  if (canonical) {
    return {
      active: canonical.active,
      session_id: canonical.sessionId,
      team_name: canonical.teamName,
      stage: canonical.stage,
      current_stage: canonical.stage,
      current_phase: canonical.stage,
      phase: canonical.stage,
      status: canonical.stage,
      task: canonical.task,
      started_at: canonical.startedAt,
      last_checked_at: canonical.updatedAt,
      reinforcement_count: 0,
    };
  }

  return coarseState;
}

function getTeamStage(state: TeamStagedState): string {
  return (
    state.stage ||
    state.current_stage ||
    state.currentStage ||
    state.current_phase ||
    state.phase ||
    "team-exec"
  );
}

function getTeamStageForEnforcement(state: TeamStagedState): string | null {
  const rawStage =
    state.stage ??
    state.current_stage ??
    state.currentStage ??
    state.current_phase ??
    state.phase;
  if (typeof rawStage !== "string") {
    return null;
  }
  const stage = rawStage.trim().toLowerCase();
  if (!stage) {
    return null;
  }
  if (TEAM_ACTIVE_STAGES.has(stage)) {
    return stage;
  }
  const alias = TEAM_STAGE_ALIASES[stage];
  return alias && TEAM_ACTIVE_STAGES.has(alias) ? alias : null;
}

function readTeamStopBreakerCount(
  directory: string,
  sessionId?: string,
): number {
  const stateDir = join(getWiseRoot(directory), "state");
  const breakerPath = sessionId
    ? join(stateDir, "sessions", sessionId, "team-stop-breaker.json")
    : join(stateDir, "team-stop-breaker.json");

  try {
    if (!existsSync(breakerPath)) {
      return 0;
    }
    const parsed = JSON.parse(readFileSync(breakerPath, "utf-8")) as {
      count?: unknown;
      updated_at?: unknown;
    };
    if (typeof parsed.updated_at === "string") {
      const updatedAt = new Date(parsed.updated_at).getTime();
      if (
        Number.isFinite(updatedAt) &&
        Date.now() - updatedAt > TEAM_STOP_BLOCKER_TTL_MS
      ) {
        return 0;
      }
    }
    const count = typeof parsed.count === "number" ? parsed.count : Number.NaN;
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
  } catch {
    return 0;
  }
}

function writeTeamStopBreakerCount(
  directory: string,
  sessionId: string | undefined,
  count: number,
): void {
  const stateDir = join(getWiseRoot(directory), "state");
  const breakerPath = sessionId
    ? join(stateDir, "sessions", sessionId, "team-stop-breaker.json")
    : join(stateDir, "team-stop-breaker.json");
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

  if (safeCount === 0) {
    try {
      if (existsSync(breakerPath)) {
        unlinkSync(breakerPath);
      }
    } catch {
      // 空操作
    }
    return;
  }

  try {
    mkdirSync(dirname(breakerPath), { recursive: true });
    writeFileSync(
      breakerPath,
      JSON.stringify(
        { count: safeCount, updated_at: new Date().toISOString() },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    // 空操作
  }
}

function isTeamStateTerminal(state: TeamStagedState): boolean {
  if (
    state.terminal === true ||
    state.cancelled === true ||
    state.canceled === true ||
    state.completed === true
  ) {
    return true;
  }

  const status = String(state.status || "").toLowerCase();
  const stage = String(getTeamStage(state)).toLowerCase();

  return TEAM_TERMINAL_VALUES.has(status) || TEAM_TERMINAL_VALUES.has(stage);
}

function getTeamStagePrompt(stage: string): string {
  switch (stage) {
    case "team-plan":
      return "Continue planning and decomposition, then move into execution once the task graph is ready.";
    case "team-prd":
      return "Continue clarifying scope and acceptance criteria, then proceed to execution once criteria are explicit.";
    case "team-exec":
      return "Continue execution: monitor teammates, unblock dependencies, and drive tasks to terminal status for this pass.";
    case "team-verify":
      return "Continue verification: validate outputs, run required checks, and decide pass or fix-loop entry.";
    case "team-fix":
      return "Continue fix loop work, then return to execution/verification until no required follow-up remains.";
    default:
      return "Continue from the current Team stage and preserve staged workflow semantics.";
  }
}

function teamWorkerIdentityFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const wise =
    typeof env.WISE_TEAM_WORKER === "string" ? env.WISE_TEAM_WORKER.trim() : "";
  if (wise) return wise;
  const omx =
    typeof env.OMX_TEAM_WORKER === "string" ? env.OMX_TEAM_WORKER.trim() : "";
  return omx;
}

function workerBashBlockReason(command: string): string | null {
  if (!command.trim()) return null;
  if (WORKER_BLOCKED_TMUX_PATTERN.test(command)) {
    return "Team worker cannot run tmux pane/session orchestration commands.";
  }
  if (WORKER_BLOCKED_TEAM_CLI_PATTERN.test(command)) {
    return `Team worker cannot run team orchestration commands. Use only \`${formatWiseCliInvocation("team api ... --json")}\`.`;
  }
  if (WORKER_BLOCKED_SKILL_PATTERN.test(command)) {
    return "Team worker cannot invoke orchestration skills (`$team`, `$ultrawork`, `$autopilot`, `$ralph`).";
  }
  return null;
}

/**
 * 返回给定钩子类型所需的 camelCase 键。
 * 集中管理键要求，避免归一化与校验之间出现偏差。
 */
export function requiredKeysForHook(hookType: string): string[] {
  switch (hookType) {
    case "session-end":
    case "subagent-start":
    case "subagent-stop":
    case "pre-compact":
    case "setup-init":
    case "setup-maintenance":
      return ["sessionId", "directory"];
    case "permission-request":
      return ["sessionId", "directory", "toolName"];
    default:
      return [];
  }
}

/**
 * 校验输入对象是否包含所有必填字段。
 * 所有必填字段齐全则返回 true，否则返回 false。
 * 失败时以 debug 级别记录缺失的键。
 */
function validateHookInput<T>(
  input: unknown,
  requiredFields: string[],
  hookType?: string,
): input is T {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  const missing = requiredFields.filter(
    (field) => !(field in obj) || obj[field] === undefined,
  );
  if (missing.length > 0) {
    console.error(
      `[hook-bridge] validateHookInput failed for "${hookType ?? "unknown"}": missing keys: ${missing.join(", ")}`,
    );
    return false;
  }
  return true;
}

/**
 * 来自 Claude Code 钩子的输入格式（经 stdin）
 */
export interface HookInput {
  /** 会话标识符 */
  sessionId?: string;
  /** 可选的 agent 名称上下文，用于路由 prompt 变体 */
  agentName?: string;
  /** 可选的 model 标识符上下文，用于路由 prompt 变体 */
  model?: string;
  /** 用户 prompt 文本 */
  prompt?: string;
  /** 消息内容（prompt 的替代形式） */
  message?: {
    content?: string;
  };
  /** 消息片段（替代结构） */
  parts?: Array<{
    type: string;
    text?: string;
  }>;
  /** 工具名（用于工具钩子） */
  toolName?: string;
  /** 工具输入参数 */
  toolInput?: unknown;
  /** 工具输出（用于 post-tool 钩子） */
  toolOutput?: unknown;
  /** 工作目录 */
  directory?: string;
}

/**
 * Claude Code 钩子的输出格式（写到 stdout）
 */
export interface HookOutput {
  /** 是否继续执行该操作 */
  continue: boolean;
  /** 可选的注入上下文消息 */
  message?: string;
  /** 阻断原因（当 continue=false 时） */
  reason?: string;
  /** 修改后的工具输入（用于 pre-tool 钩子） */
  modifiedInput?: unknown;
}

type SerializableHookOutput = HookOutput & {
  suppressOutput?: boolean;
  systemMessage?: string;
  hookSpecificOutput?: Record<string, unknown>;
};

function hasInjectableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 在序列化给 Claude Code 之前剥离空的钩子文本字段。
 *
 * 某些钩子处理器把空字符串当作内部哨兵。把这些空字符串透传给
 * shell 钩子协议会在下一轮创建空的 system-message/context 注入，
 * 这在 Task/Agent 完成后 Claude 决定是否继续时尤其危险。
 */
export function sanitizeHookOutputForSerialization(
  output: SerializableHookOutput,
): SerializableHookOutput {
  const sanitized: SerializableHookOutput = { ...output };

  if (!hasInjectableText(sanitized.message)) {
    delete sanitized.message;
  }

  if (!hasInjectableText(sanitized.systemMessage)) {
    delete sanitized.systemMessage;
  }

  const hookSpecificOutput = sanitized.hookSpecificOutput;
  if (hookSpecificOutput && typeof hookSpecificOutput === "object") {
    const nextHookSpecificOutput = { ...hookSpecificOutput };

    if (!hasInjectableText(nextHookSpecificOutput.additionalContext)) {
      delete nextHookSpecificOutput.additionalContext;
    }

    sanitized.hookSpecificOutput =
      Object.keys(nextHookSpecificOutput).length > 0
        ? nextHookSpecificOutput
        : undefined;

    if (!sanitized.hookSpecificOutput) {
      delete sanitized.hookSpecificOutput;
    }
  }

  return sanitized;
}

function isDelegationToolName(toolName: string | undefined): boolean {
  const normalizedToolName = (toolName || "").toLowerCase();
  return normalizedToolName === "task" || normalizedToolName === "agent";
}

/**
 * 可处理的钩子类型
 */
export type HookType =
  | "keyword-detector"
  | "stop-continuation"
  | "ralph"
  | "persistent-mode"
  | "session-start"
  | "session-end" // 新增：会话结束时清理与指标采集
  | "pre-tool-use"
  | "post-tool-use"
  | "autopilot"
  | "subagent-start" // 新增：追踪 agent 派生
  | "subagent-stop" // 新增：校验 agent 完成
  | "pre-compact" // 新增：压缩前保存状态
  | "setup-init" // 新增：一次性初始化
  | "setup-maintenance" // 新增：周期性维护
  | "permission-request" // 新增：智能自动批准
  | "code-simplifier"; // 新增：Stop 时自动简化最近修改的文件

/**
 * 从多种输入格式中提取 prompt 文本
 */
function getPromptText(input: HookInput): string {
  if (input.prompt) {
    return input.prompt;
  }
  if (input.message?.content) {
    return input.message.content;
  }
  if (input.parts) {
    return input.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

function isExplicitAskSlashInvocation(promptText: string): boolean {
  return /^\s*\/(?:wise:)?ask\s+(?:claude|codex|gemini|grok|cursor)\b/i.test(promptText);
}

function activateRalplanStartupState(directory: string, sessionId?: string): void {
  const now = new Date().toISOString();
  writeModeState(
    "ralplan",
    {
      active: true,
      session_id: sessionId,
      current_phase: "ralplan",
      started_at: now,
      awaiting_confirmation: true,
      awaiting_confirmation_set_at: now,
      last_checked_at: now,
    },
    directory,
    sessionId,
  );
}

/**
 * 解析工作流 skill 对应的 mode 专属状态文件在磁盘上的路径。
 * 有 session id 时返回会话级路径，否则返回根路径。用于在
 * workflow slot 上持久化 `mode_state_path`，以便下游消费者定位 mode 负载。
 */
function resolveWorkflowSlotModeStatePath(
  directory: string,
  skillName: string,
  sessionId?: string,
): string {
  const paths = getModeStatePaths(directory, skillName, sessionId);
  return paths[0] ?? "";
}

/**
 * 通过唯一受认可的辅助函数 `writeSkillActiveStateCopies()`，在双副本
 * 账本中播种（或刷新）一个规范 workflow-slot 条目。至少写入一份副本时
 * 返回 `true`，尽力而为失败时返回 `false`。
 */
function seedWorkflowSlotForSkill(
  directory: string,
  skillName: string,
  sessionId: string | undefined,
  source: string,
  parentSkill?: string | null,
): boolean {
  if (!isCanonicalWorkflowSkill(skillName)) return false;
  const normalized = skillName.toLowerCase().replace(/^wise:/, "");

  try {
    const current = readSkillActiveStateNormalized(directory, sessionId);
    const pruned = pruneExpiredWorkflowSkillTombstones(current);

    // 提前解析 mode-state 文件指针，使下游读者无需重新推导路径即可定位 mode 负载。
    const rootStatePath = resolveStatePathSafe("skill-active", directory);
    const sessionStatePath = sessionId
      ? resolveSessionStatePathSafe("skill-active", sessionId, directory)
      : "";
    const modeStatePath = resolveWorkflowSlotModeStatePath(
      directory,
      normalized,
      sessionId,
    );

    const slotData: Partial<ActiveSkillSlot> = {
      session_id: sessionId ?? "",
      mode_state_path: modeStatePath,
      initialized_mode: normalized,
      initialized_state_path: rootStatePath,
      initialized_session_state_path: sessionStatePath,
      source,
    };
    if (parentSkill !== undefined) {
      slotData.parent_skill = parentSkill;
    }

    const next = upsertWorkflowSkillSlot(pruned, normalized, slotData);
    return writeSkillActiveStateCopies(directory, next, sessionId);
  } catch {
    return false;
  }
}

/**
 * 幂等地确认一个 workflow slot —— 当 slot 存活时刷新 `last_confirmed_at`。
 * slot 缺失或已被 tombstone 时为空操作。
 */
function confirmWorkflowSlot(
  directory: string,
  skillName: string,
  sessionId?: string,
): boolean {
  if (!isCanonicalWorkflowSkill(skillName)) return false;
  const normalized = skillName.toLowerCase().replace(/^wise:/, "");

  try {
    const current = readSkillActiveStateNormalized(directory, sessionId);
    const slot = current.active_skills[normalized];
    if (!slot || slot.completed_at) return false;
    const next = upsertWorkflowSkillSlot(current, normalized, {
      last_confirmed_at: new Date().toISOString(),
    });
    return writeSkillActiveStateCopies(directory, next, sessionId);
  } catch {
    return false;
  }
}

/**
 * 完成时对 workflow slot 做软 tombstone。slot 会保留至
 * TTL 清理器移除它，使后到的 stop 钩子看到一致的状态。
 */
function tombstoneWorkflowSlot(
  directory: string,
  skillName: string,
  sessionId?: string,
): boolean {
  if (!isCanonicalWorkflowSkill(skillName)) return false;
  const normalized = skillName.toLowerCase().replace(/^wise:/, "");
  try {
    const current = readSkillActiveStateNormalized(directory, sessionId);
    if (!current.active_skills[normalized]) return false;
    const next = markWorkflowSkillCompleted(current, normalized);
    return writeSkillActiveStateCopies(directory, next, sessionId);
  } catch {
    return false;
  }
}

function resolveStatePathSafe(stateName: string, directory: string): string {
  try {
    // 延迟解析以避免循环导入；同一模块在 skill-state 中
    // 通过 mode-paths 注册表导入。
    return join(getWiseRoot(directory), "state", `${stateName}-state.json`);
  } catch {
    return "";
  }
}

function resolveSessionStatePathSafe(
  stateName: string,
  sessionId: string,
  directory: string,
): string {
  try {
    return join(
      getWiseRoot(directory),
      "state",
      "sessions",
      sessionId,
      `${stateName}-state.json`,
    );
  } catch {
    return "";
  }
}

/**
 * 当用户发出显式 slash 命令时，与 workflow slot 一并调用的 mode 专属
 * 播种入口。当某 mode 不需要 pre-skill 状态时，各分支为空操作
 *（例如 `team`，其 team skill 本身通过 worker 派生拥有初始状态）。
 */
async function seedModeStateForExplicitWorkflowSlash(
  skill: string,
  directory: string,
  promptText: string,
  sessionId?: string,
): Promise<void> {
  switch (skill) {
    case "ralplan":
      activateRalplanStartupState(directory, sessionId);
      return;
    case "autopilot":
      await seedAutopilotStartupState(directory, promptText, sessionId);
      return;
    default:
      // ralph / ultrawork / team / ultraqa / deep-interview / self-improve
      // 在各自的 Skill PostToolUse 处理器内部完成状态激活。
      // 对它们做 pre-Skill 播种会覆盖已有的进行中状态
      //（例如嵌套的 `autopilot → ralph`）；仅靠 workflow slot 就足以
      // 防止 stop-hook 强制提前终止。
      return;
  }
}

/**
 * 处理关键词检测钩子
 * 检测魔法关键词并返回注入消息
 * 同时为需要持久状态的 mode（ralph、ultrawork）激活状态
 */
async function processKeywordDetector(input: HookInput): Promise<HookOutput> {
  // Team worker 守卫：防止在 team worker 内部做关键词检测，以避免
  // 无限派生循环（worker 检测到 "team" -> 调用 team skill -> 派生更多 worker）
  if (process.env.WISE_TEAM_WORKER) {
    return { continue: true };
  }

  const promptText = getPromptText(input);
  if (!promptText) {
    return { continue: true };
  }

  // `/ask <provider> ...` 把 prompt 的剩余部分委派给
  // 外部顾问。不要把该负载中的魔法关键词解读为
  // 当前 Claude Code 会话的指令。
  if (isExplicitAskSlashInvocation(promptText)) {
    return { continue: true };
  }

  // 移除代码块以防误报
  const cleanedText = removeCodeBlocks(promptText);

  const sessionId = input.sessionId;
  const directory = resolveToWorktreeRoot(input.directory);
  const messages: string[] = [];

  // 统一的显式 slash 调用处理器 —— 覆盖全部 8 个规范
  // workflow skill（autopilot、ralph、team、ultrawork、ultraqa、
  // deep-interview、ralplan、self-improve）。在 Skill 工具触发之前，
  // 通过受认可的双副本辅助函数播种 workflow slot，并在 mode 需要
  // pre-Skill 状态时播种 mode 专属状态文件。ralplan 路径额外返回
  // 旧的 [RALPLAN INIT] 上下文注入，使既有路由测试保持通过。
  const explicitSlash = parseExplicitWorkflowSlashInvocation(promptText);
  if (explicitSlash) {
    seedWorkflowSlotForSkill(
      directory,
      explicitSlash.skill,
      sessionId,
      "prompt-submit:explicit-slash",
    );
    await seedModeStateForExplicitWorkflowSlash(
      explicitSlash.skill,
      directory,
      promptText,
      sessionId,
    );

    if (explicitSlash.skill === "ralplan") {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            `[RALPLAN INIT] Explicit /ralplan invoke detected during UserPromptSubmit.\n` +
            `ralplan state is armed for startup and marked awaiting confirmation, so the stop hook will not block this initialization path.\n` +
            `Proceed immediately with the consensus planning workflow for:\n${promptText}`,
        },
      } as HookOutput & { hookSpecificOutput: Record<string, unknown> };
    }
    // 对于非 ralplan 的 workflow slash 调用，继续往下走，让常规
    // 关键词流水线仍发出 mode 消息常量并走正常激活路径。workflow slot
    // 已就绪，因此 stop-hook 会把即将到来的 Skill 调用视为已授权。
  }

  // 在 HUD 状态中记录 prompt 提交时间
  try {
    const hudState = readHudState(directory, input.sessionId) || {
      timestamp: new Date().toISOString(),
      backgroundTasks: [],
    };
    hudState.lastPromptTimestamp = new Date().toISOString();
    hudState.timestamp = new Date().toISOString();
    writeHudState(hudState, directory, input.sessionId);
  } catch {
    // 静默失败 - 不打断关键词检测
  }

  // 加载配置以获取任务规模检测设置
  const config = loadConfig();
  const taskSizeConfig = config.taskSizeDetection ?? {};
  const promptPrerequisiteConfig = getPromptPrerequisiteConfig(config);

  // 获取所有关键词，可选按任务规模过滤（issue #790）
  const sizeCheckResult = getAllKeywordsWithSizeCheck(cleanedText, {
    enabled: taskSizeConfig.enabled !== false,
    smallWordLimit: taskSizeConfig.smallWordLimit ?? 50,
    largeWordLimit: taskSizeConfig.largeWordLimit ?? 200,
    suppressHeavyModesForSmallTasks:
      taskSizeConfig.suppressHeavyModesForSmallTasks !== false,
  });

  // 在任务规模抑制之前应用 ralplan 优先闸门（issue #997）。
  // 重建完整关键词集合，使闸门能看到任务规模抑制可能已为小任务
  // 移除的执行类关键词。
  const fullKeywords = [
    ...sizeCheckResult.keywords,
    ...sizeCheckResult.suppressedKeywords,
  ];
  const gateResult = applyRalplanGate(fullKeywords, cleanedText);

  let keywords: typeof fullKeywords;
  if (gateResult.gateApplied) {
    // 闸门触发：重定向到 ralplan（任务规模抑制已无意义 —— 我们在做规划，而非执行）
    keywords = gateResult.keywords;
    const gated = gateResult.gatedKeywords.join(", ");
    messages.push(
      `[RALPLAN GATE] Redirecting ${gated} → ralplan for scoping.\n` +
        `Tip: add a concrete anchor to run directly next time:\n` +
        `  \u2022 "ralph fix the bug in src/auth.ts"  (file path)\n` +
        `  \u2022 "ralph implement #42"               (issue number)\n` +
        `  \u2022 "ralph fix processKeyword"           (symbol name)\n` +
        `Or prefix with \`force:\` / \`!\` to bypass.`,
    );
  } else {
    // 闸门未触发：按正常方式使用任务规模抑制后的结果
    keywords = sizeCheckResult.keywords;

    // 当重型 mode 因小任务被抑制时通知用户
    if (
      sizeCheckResult.suppressedKeywords.length > 0 &&
      sizeCheckResult.taskSizeResult
    ) {
      const suppressed = sizeCheckResult.suppressedKeywords.join(", ");
      const reason = sizeCheckResult.taskSizeResult.reason;
      messages.push(
        `[TASK-SIZE: SMALL] Heavy orchestration mode(s) suppressed: ${suppressed}.\n` +
          `Reason: ${reason}\n` +
          `Running directly without heavy agent stacking. ` +
          `Prefix with \`quick:\`, \`simple:\`, or \`tiny:\` to always use lightweight mode. ` +
          `Use explicit mode keywords (e.g. \`ralph\`) only when you need full orchestration.`,
      );
    }
  }

  const promptPrerequisiteParse = parsePromptPrerequisiteSections(promptText, promptPrerequisiteConfig);
  const executionKeywords = fullKeywords.filter((keywordType) =>
    promptPrerequisiteConfig.executionKeywords.includes(keywordType),
  );
  if (shouldEnforcePromptPrerequisites(executionKeywords, promptPrerequisiteParse, promptPrerequisiteConfig)) {
    const state = activatePromptPrerequisiteState(
      directory,
      sessionId,
      executionKeywords,
      promptPrerequisiteParse,
    );
    if (state) {
      messages.push(buildPromptPrerequisiteReminder(state));
    }
  } else if (executionKeywords.length > 0) {
    clearPromptPrerequisiteState(directory, sessionId);
  }

  const sanitizedText = sanitizeForKeywordDetection(cleanedText);
  if (NON_LATIN_SCRIPT_PATTERN.test(sanitizedText)) {
    messages.push(PROMPT_TRANSLATION_MESSAGE);
  }

  // 为 keyword-detector 唤醒 OpenClaw 网关（非阻塞，对所有 prompt 触发）
  if (input.sessionId) {
    _openclaw.wake("keyword-detector", {
      sessionId: input.sessionId,
      projectPath: directory,
      prompt: cleanedText,
    });
  }

  if (keywords.length === 0) {
    if (messages.length > 0) {
      return { continue: true, message: messages.join("\n\n---\n\n") };
    }
    return { continue: true };
  }

  // 处理每个关键词并收集消息
  for (const keywordType of keywords) {
    switch (keywordType) {
      case "ralph": {
        // 延迟加载 ralph 模块
        const {
          createRalphLoopHook,
          detectCriticModeFlag,
          stripCriticModeFlag,
        } = await import("./ralph/index.js");

        const criticMode = detectCriticModeFlag(promptText) ?? undefined;
        const cleanPrompt = stripCriticModeFlag(promptText);

        // 激活 ralph 状态，同时自动激活 ultrawork
        const hook = createRalphLoopHook(directory);
        const started = hook.startLoop(
          sessionId,
          cleanPrompt,
          {
            ...(criticMode ? { criticMode } : {}),
          },
        );
        if (started) {
          markModeAwaitingConfirmation(directory, sessionId, 'ralph', 'ultrawork');
        }

        messages.push(RALPH_MESSAGE);
        break;
      }

      case "ultrawork": {
        // 延迟加载 ultrawork 模块
        const { activateUltrawork } = await import("./ultrawork/index.js");
        // 激活持久的 ultrawork 状态
        const activated = activateUltrawork(promptText, sessionId, directory);
        if (activated) {
          markModeAwaitingConfirmation(directory, sessionId, 'ultrawork');
        }
        messages.push(
          getUltraworkMessage(
            getHookContextString(input, "agentName", "agent_name"),
            getHookContextString(input, "model", "modelId", "model_id"),
          ),
        );
        break;
      }

      case "ultrathink":
        messages.push(ULTRATHINK_MESSAGE);
        break;

      case "deepsearch":
        messages.push(SEARCH_MESSAGE);
        break;

      case "analyze":
        messages.push(ANALYZE_MESSAGE);
        break;

      case "tdd":
        messages.push(TDD_MESSAGE);
        break;

      case "code-review":
        messages.push(CODE_REVIEW_MESSAGE);
        break;

      case "security-review":
        messages.push(SECURITY_REVIEW_MESSAGE);
        break;

      // 对于没有专属消息常量的 mode，返回通用激活消息
      // 这些由 UserPromptSubmit 钩子处理以进行 skill 调用
      case "cancel":
      case "autopilot":
      case "ralplan":
      case "deep-interview":
        if (keywordType === "autopilot") {
          await seedAutopilotStartupState(directory, cleanedText, sessionId);
        } else if (keywordType === "ralplan") {
          seedRalplanStartupState(directory, sessionId);
        }
        messages.push(
          `[MODE: ${keywordType.toUpperCase()}] Skill invocation handled by UserPromptSubmit hook.`,
        );
        break;

      case "codex":
      case "gemini":
      case "cursor": {
        const teamStartCommand = formatWiseCliInvocation(`team start --agent ${keywordType} --count N --task "<task from user message>"`);
        messages.push(
          `[MAGIC KEYWORD: team]\n` +
            `User intent: delegate to ${keywordType} CLI workers via ${formatWiseCliInvocation('team')}.\n` +
            `Agent type: ${keywordType}. Parse N from user message (default 1).\n` +
            `Invoke: ${teamStartCommand}`,
        );
        break;
      }

      default:
        // 跳过未知关键词
        break;
    }
  }

  // 用分隔符返回合并后的消息
  if (messages.length === 0) {
    return { continue: true };
  }

  return {
    continue: true,
    message: messages.join("\n\n---\n\n"),
  };
}

/**
 * 处理 stop continuation 钩子（旧路径）。
 * 始终返回 continue: true —— 真正的强制逻辑在 processPersistentMode() 中。
 */
async function processStopContinuation(_input: HookInput): Promise<HookOutput> {
  // 始终允许 stop - 不做硬阻断
  return { continue: true };
}

/**
 * 处理持久 mode 钩子（增强版 stop continuation）
 * ultrawork、ralph 和 todo-continuation 的统一处理器。
 *
 * 注意：旧的 `processRalph` 函数已在 issue #1058 中移除。
 * ralph 现在由 `persistent-mode/index.ts` 中的 `checkRalphLoop` 专门处理，
 * 后者逻辑更丰富（PRD 检查、team 流水线协调、工具错误注入、取消缓存、
 * ultrawork 自愈，以及 architect 拒绝处理）。
 */
async function processPersistentMode(input: HookInput): Promise<HookOutput> {
  const rawSessionId = (input as Record<string, unknown>).session_id as
    | string
    | undefined;
  const sessionId = input.sessionId ?? rawSessionId;
  const directory = resolveToWorktreeRoot(input.directory);

  // 延迟加载 persistent-mode 和 todo-continuation 模块
  const {
    checkPersistentModes,
    createHookOutput,
    shouldWakeOpenClawOnStop,
    shouldSendIdleNotification,
    recordIdleNotificationSent,
  } = await import("./persistent-mode/index.js");
  const { isExplicitCancelCommand, isAuthenticationError } =
    await import("./todo-continuation/index.js");

  // 提取 stop 上下文以做中止检测（同时支持 camelCase 和 snake_case）
  const stopContext: StopContext = {
    stop_reason: (input as Record<string, unknown>).stop_reason as
      | string
      | undefined,
    stopReason: (input as Record<string, unknown>).stopReason as
      | string
      | undefined,
    end_turn_reason: (input as Record<string, unknown>).end_turn_reason as
      | string
      | undefined,
    endTurnReason: (input as Record<string, unknown>).endTurnReason as
      | string
      | undefined,
    user_requested: (input as Record<string, unknown>).user_requested as
      | boolean
      | undefined,
    userRequested: (input as Record<string, unknown>).userRequested as
      | boolean
      | undefined,
    prompt: input.prompt,
    tool_name: (input as Record<string, unknown>).tool_name as
      | string
      | undefined,
    toolName: input.toolName,
    tool_input: (input as Record<string, unknown>).tool_input,
    toolInput: input.toolInput,
    reason: (input as Record<string, unknown>).reason as string | undefined,
    transcript_path: (input as Record<string, unknown>).transcript_path as
      | string
      | undefined,
    transcriptPath: (input as Record<string, unknown>).transcriptPath as
      | string
      | undefined,
  };

  const result = await checkPersistentModes(sessionId, directory, stopContext);
  const output = createHookOutput(result);

  // 若 persistent-mode 已处理本次 stop 事件（或有意发出了 stop 消息），
  // 则跳过 legacy bridge.ts 的 team 强制逻辑。
  // 防止跨 mode 出现混合/重复的 continuation 提示。
  if (result.mode !== "none" || Boolean(output.message)) {
    return output;
  }

  const teamState = readTeamStagedState(directory, sessionId);
  if (
    !teamState ||
    teamState.active !== true ||
    isTeamStateTerminal(teamState)
  ) {
    writeTeamStopBreakerCount(directory, sessionId, 0);
    // 无持久 mode 且无活跃 team —— Claude 确实处于空闲。
    // 除非本次是用户中止或上下文上限，否则发送 session-idle 通知（非阻塞）。
    if (result.mode === "none" && sessionId) {
      const isAbort =
        stopContext.user_requested === true ||
        stopContext.userRequested === true;
      const isContextLimit =
        stopContext.stop_reason === "context_limit" ||
        stopContext.stopReason === "context_limit";
      if (!isAbort && !isContextLimit) {
        // 按会话冷却：会话反复空闲时防止通知刷屏。
        // 使用会话级状态，使一个会话不会抑制另一个。
        const stateDir = join(getWiseRoot(directory), "state");
        const { getIdleNotificationRepoState } = await import("./persistent-mode/idle-repo-state.js");
        const idleRepoState = getIdleNotificationRepoState(directory);
        if (shouldWakeOpenClawOnStop(stateDir, sessionId, idleRepoState)) {
          _openclaw.wake("stop", { sessionId, projectPath: directory });
        }
        if (shouldSendIdleNotification(stateDir, sessionId, idleRepoState)) {
          recordIdleNotificationSent(stateDir, sessionId, idleRepoState);
          dispatchNotificationInBackground("session-idle", {
            sessionId,
            projectPath: directory,
            profileName: process.env.WISE_NOTIFY_PROFILE,
          });
        }
      }

      // 重要：不要在 Stop 钩子中清理 reply-listener/session-registry。
      // 会话仍活跃时，Stop 也可能为正常 "idle" 轮次触发。
      // 回复清理只在真正的 SessionEnd 钩子中处理。
    }
    return output;
  }

  // 显式取消应抑制 team continuation 提示。
  if (isExplicitCancelCommand(stopContext)) {
    writeTeamStopBreakerCount(directory, sessionId, 0);
    return output;
  }

  // 鉴权失败（401/403/OAuth 过期）不应注入 Team continuation。
  // 否则 stop 钩子会在凭证无效时强制重试循环。
  if (isAuthenticationError(stopContext)) {
    writeTeamStopBreakerCount(directory, sessionId, 0);
    return output;
  }

  const stage = getTeamStageForEnforcement(teamState);
  if (!stage) {
    // 对缺失/损坏/未知的 phase/state 值采取失败放行。
    writeTeamStopBreakerCount(directory, sessionId, 0);
    return output;
  }

  const newBreakerCount = readTeamStopBreakerCount(directory, sessionId) + 1;
  if (newBreakerCount > TEAM_STOP_BLOCKER_MAX) {
    // 断路器：绝不允许无限的 stop-hook 阻断循环。
    writeTeamStopBreakerCount(directory, sessionId, 0);
    return output;
  }
  writeTeamStopBreakerCount(directory, sessionId, newBreakerCount);

  const stagePrompt = getTeamStagePrompt(stage);
  const teamName = teamState.team_name || teamState.teamName || "team";
  const currentMessage = output.message ? `${output.message}\n` : "";

  return {
    ...output,
    continue: false,
    message: `${currentMessage}<team-stage-continuation>

[TEAM MODE CONTINUATION]

Team "${teamName}" is currently in stage: ${stage}
${stagePrompt}

While stage state is active and non-terminal, keep progressing the staged workflow.
When team verification passes or cancel is requested, allow terminal cleanup behavior.

</team-stage-continuation>

---

`,
  };
}

/**
 * 处理会话启动钩子
 * 恢复持久 mode 状态并按需注入上下文
 */
async function processSessionStart(input: HookInput): Promise<HookOutput> {
  const sessionId = input.sessionId;
  const directory = resolveToWorktreeRoot(input.directory);

  writeSessionStartedMarker(directory, sessionId);
  await reconcileAbandonedSessionStarts(directory, sessionId);

  // 延迟加载 session-start 依赖
  const { initSilentAutoUpdate } = await import("../features/auto-update.js");
  const { readAutopilotState } = await import("./autopilot/index.js");
  const { readUltraworkState } = await import("./ultrawork/index.js");
  const { checkIncompleteTodos } = await import("./todo-continuation/index.js");
  const { buildAgentsOverlay } = await import("./agents-overlay.js");

  // 触发静默自动更新检查（非阻塞，内部自行检查配置）
  initSilentAutoUpdate();

  // 发送 session-start 通知（非阻塞，吞掉错误）
  if (sessionId) {
    dispatchNotificationInBackground("session-start", {
      sessionId,
      projectPath: directory,
      profileName: process.env.WISE_NOTIFY_PROFILE,
    });
    // 为 session-start 唤醒 OpenClaw 网关（非阻塞）
    _openclaw.wake("session-start", { sessionId, projectPath: directory });
  }

  // 若已配置则启动回复监听守护进程（非阻塞，吞掉错误）
  if (sessionId) {
    Promise.all([
      import("../notifications/reply-listener.js"),
      import("../notifications/config.js"),
    ])
      .then(
        ([
          { startReplyListener },
          {
            getReplyConfig,
            getNotificationConfig,
            getReplyListenerPlatformConfig,
          },
        ]) => {
          const replyConfig = getReplyConfig();
          if (!replyConfig) return;
          const notifConfig = getNotificationConfig();
          const platformConfig = getReplyListenerPlatformConfig(notifConfig);
          startReplyListener({
            ...replyConfig,
            ...platformConfig,
          });
        },
      )
      .catch(() => {});
  }

  const messages: string[] = [];

  // 注入启动 codebase map（issue #804）—— 第一个上下文条目，让 agent 快速定位
  try {
    const overlayResult = buildAgentsOverlay(directory);
    if (overlayResult.message) {
      messages.push(overlayResult.message);
    }
  } catch {
    // 非阻塞：codebase map 失败绝不能打断会话启动
  }

  // 检查活跃的 autopilot 状态 - 仅当其属于本会话时才恢复
  const autopilotState = readAutopilotState(directory, sessionId);
  if (autopilotState?.active && autopilotState.session_id === sessionId) {
    messages.push(`<session-restore>

[AUTOPILOT MODE RESTORED]

You have an active autopilot session from ${autopilotState.started_at}.
Original idea: ${autopilotState.originalIdea}
Current phase: ${autopilotState.phase}

Treat this as prior-session context only. Prioritize the user's newest request, and resume autopilot only if the user explicitly asks to continue it.

</session-restore>

---

`);
  }

  // 检查活跃的 ultrawork 状态 - 仅当其属于本会话时才恢复
  const ultraworkState = readUltraworkState(directory, sessionId);
  if (ultraworkState?.active && ultraworkState.session_id === sessionId) {
    messages.push(`<session-restore>

[ULTRAWORK MODE RESTORED]

You have an active ultrawork session from ${ultraworkState.started_at}.
Original task: ${ultraworkState.original_prompt}

Treat this as prior-session context only. Prioritize the user's newest request, and resume ultrawork only if the user explicitly asks to continue it.

</session-restore>

---

`);
  }

  const ralplanState = readModeState<Record<string, unknown>>("ralplan", directory, sessionId);
  if (ralplanState?.active === true && ralplanState.session_id === sessionId) {
    const ralplanPhase =
      typeof ralplanState.current_phase === "string"
        ? ralplanState.current_phase
        : typeof ralplanState.phase === "string"
          ? ralplanState.phase
          : typeof ralplanState.status === "string"
            ? ralplanState.status
            : "ralplan";
    const restoreStatus =
      ralplanState.awaiting_confirmation === true
        ? "awaiting skill confirmation"
        : "active";

    messages.push(`<session-restore>

[RALPLAN MODE RESTORED]

You have an active ralplan consensus planning session from ${ralplanState.started_at ?? "an earlier turn"}.
Current phase: ${ralplanPhase}
Status: ${restoreStatus}

Treat this as prior-session context only. Prioritize the user's newest request, and resume ralplan only if the user explicitly asks to continue it.

</session-restore>

---

`);
  }

  const teamState = readTeamStagedState(directory, sessionId);
  if (teamState?.active) {
    const teamName = teamState.team_name || teamState.teamName || "team";
    const stage = getTeamStage(teamState);

    if (isTeamStateTerminal(teamState)) {
      messages.push(`<session-restore>

[TEAM MODE TERMINAL STATE DETECTED]

Team "${teamName}" stage state is terminal (${stage}).
If this is expected, run normal cleanup/cancel completion flow and clear stale Team state files.

</session-restore>

---

`);
    } else {
      messages.push(`<session-restore>

[TEAM MODE RESTORED]

You have an active Team staged run for "${teamName}".
Current stage: ${stage}
${getTeamStagePrompt(stage)}

Treat this as prior-session context only. Prioritize the user's newest request, and resume the staged Team workflow only if the user explicitly asks to continue it.

</session-restore>

---

`);
    }
  }

  // 若存在则加载根 AGENTS.md（deepinit 产出 - issue #613）
  const agentsMdPath = join(directory, "AGENTS.md");
  if (existsSync(agentsMdPath)) {
    try {
      let agentsContent = compactWiseStartupGuidance(
        readFileSync(agentsMdPath, "utf-8"),
      ).trim();
      if (agentsContent) {
        // 截断到约 5000 token（20000 字符）以避免上下文膨胀
        const MAX_AGENTS_CHARS = 20000;
        if (agentsContent.length > MAX_AGENTS_CHARS) {
          agentsContent = agentsContent.slice(0, MAX_AGENTS_CHARS);
        }
        // 安全：包装不可信文件内容以防止 prompt 注入
        const wrappedContent = wrapUntrustedFileContent(
          agentsMdPath,
          agentsContent,
        );
        messages.push(`<session-restore>

[ROOT AGENTS.md LOADED]

The following project documentation was generated by deepinit to help AI agents understand the codebase:

${wrappedContent}

</session-restore>

---

`);
      }
    } catch {
      // 文件无法读取时跳过
    }
  }

  // 检查未完成的 todo
  const todoResult = await checkIncompleteTodos(sessionId, directory);
  if (todoResult.count > 0) {
    messages.push(`<session-restore>

[PENDING TASKS DETECTED]

You have ${todoResult.count} incomplete tasks from a previous session.
Please continue working on these tasks.

</session-restore>

---

`);
  }

  // Bedrock/Vertex/代理覆盖：告知 LLM 不要在 Task 调用上传 model。
  // 这能防止 LLM 遵循静态 CLAUDE.md 指令
  // "Pass model on Task calls: haiku, sonnet, opus"，该指令在非标准
  // provider 上会产生无效 model ID。（issues #1135, #1201）
  try {
    const sessionConfig = loadConfig();
    if (sessionConfig.routing?.forceInherit) {
      messages.push(`<system-reminder>

[MODEL ROUTING OVERRIDE — NON-STANDARD PROVIDER DETECTED]

This environment uses a non-standard model provider (AWS Bedrock, Google Vertex AI, or a proxy such as CC Switch / LiteLLM).

How to pass \`model\` on Task/Agent calls:
- Prefer a tier alias: \`model: "sonnet"\`, \`model: "opus"\`, \`model: "haiku"\`, or \`model: "fable"\` (Claude Fable 5, above Opus). WISE's pre-tool enforcer resolves these to provider-safe IDs when one of these env vars is set: \`ANTHROPIC_DEFAULT_SONNET_MODEL\` (and siblings \`ANTHROPIC_DEFAULT_OPUS_MODEL\` / \`ANTHROPIC_DEFAULT_HAIKU_MODEL\` / \`ANTHROPIC_DEFAULT_FABLE_MODEL\`), \`CLAUDE_CODE_BEDROCK_SONNET_MODEL\` (and siblings \`CLAUDE_CODE_BEDROCK_OPUS_MODEL\` / \`CLAUDE_CODE_BEDROCK_HAIKU_MODEL\` / \`CLAUDE_CODE_BEDROCK_FABLE_MODEL\`), or \`WISE_SUBAGENT_MODEL\`.
- If none of those env vars are configured, the enforcer will deny the tier alias with an env-var configuration hint — set one of them in your \`settings.json\` env or shell profile.
- The enforcer denies tier aliases it cannot resolve. It also denies provider-specific IDs that carry a \`[1m]\` context-window suffix or otherwise fail subagent-safe validation (sub-agents cannot inherit \`[1m]\`). Valid provider-specific IDs without extended-context suffixes are allowed.

When the session model carries a \`[1m]\` suffix, passing an explicit \`model\` is REQUIRED — omitting it will be denied (sub-agents cannot inherit the \`[1m]\` suffix). Use a tier alias (requires resolver env vars above); the Agent tool schema does not accept provider-specific IDs, so tier aliases are the only valid option.

When the session model has no \`[1m]\` suffix, omitting \`model\` is safe UNLESS a custom sub-agent definition pins a bare Anthropic model ID (e.g. \`model: claude-sonnet-4-6\` in agent frontmatter). When resolver env vars are configured, the enforcer will deny that call with tier-alias guidance; when they are absent, the call is not denied by the enforcer but will fail at the provider. Either way, custom sub-agents should pin tier aliases (not bare Anthropic IDs) in their frontmatter. Shipped WISE agents already do this and are unaffected.

The CLAUDE.md instruction "Pass model on Task calls: haiku, sonnet, opus" applies here — subject to the resolution prerequisites above.

</system-reminder>`);
    }
  } catch {
    // 非阻塞：配置加载失败绝不能打断会话启动
  }

  if (messages.length > 0) {
    return {
      continue: true,
      message: buildSessionStartAdditionalContext(messages),
    };
  }

  return { continue: true };
}

type AskUserQuestionToolOption = {
  label?: unknown;
  value?: unknown;
  description?: unknown;
};

type AskUserQuestionToolPrompt = {
  question?: unknown;
  header?: unknown;
  options?: AskUserQuestionToolOption[];
  allow_other?: unknown;
  allowOther?: unknown;
  other_label?: unknown;
  otherLabel?: unknown;
  multiSelect?: unknown;
  multi_select?: unknown;
};

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function extractAskUserQuestionPrompts(toolInput: unknown) {
  const input = toolInput as { questions?: AskUserQuestionToolPrompt[] } | undefined;
  const questions = Array.isArray(input?.questions) ? input.questions : [];

  return questions
    .map((question) => {
      const questionText = stringOrUndefined(question.question);
      if (!questionText) return null;

      const rawOptions = Array.isArray(question.options) ? question.options : [];
      const options = rawOptions
        .map((option) => {
          const label = stringOrUndefined(option.label);
          if (!label) return null;
          const value = stringOrUndefined(option.value);
          const description = stringOrUndefined(option.description);
          return {
            label,
            ...(value ? { value } : {}),
            ...(description ? { description } : {}),
          };
        })
        .filter((option): option is { label: string; value?: string; description?: string } => option !== null);

      const allowOther = question.allowOther ?? question.allow_other;
      const otherLabel = stringOrUndefined(question.otherLabel ?? question.other_label);
      const multiSelect = question.multiSelect ?? question.multi_select;

      const header = stringOrUndefined(question.header);

      return {
        question: questionText,
        ...(header ? { header } : {}),
        options,
        allowOther: allowOther === false ? false : true,
        otherLabel: otherLabel ?? "Other",
        multiSelect: multiSelect === true,
      };
    })
    .filter((question): question is NonNullable<typeof question> => question !== null);
}

/**
 * AskUserQuestion 的即发即忘通知（issue #597）。
 * 为可测试性而抽出；动态导入使得直接断言 notify() 调用时机敏感，
 * 因此测试改为 spy 这个包装器。
 */
export function dispatchAskUserQuestionNotification(
  sessionId: string,
  directory: string,
  toolInput: unknown,
): void {
  const prompts = extractAskUserQuestionPrompts(toolInput);
  const questionText =
    prompts
      .map((q) => q.question)
      .filter(Boolean)
      .join("; ") || "User input requested";

  dispatchNotificationInBackground("ask-user-question", {
    sessionId,
    projectPath: directory,
    question: questionText,
    askUserQuestionPrompts: prompts,
    profileName: process.env.WISE_NOTIFY_PROFILE,
  });
}

/** @internal 对象包装器，使测试能 spy 派发调用。 */
export const _notify = {
  askUserQuestion: dispatchAskUserQuestionNotification,
};

/**
 * @internal OpenClaw 网关派发的对象包装器。
 * 沿用 _notify 模式以保持可测试性（测试 spy _openclaw.wake，
 * 而不是 mock 动态导入）。
 *
 * 即发即忘：延迟导入 + 双层 .catch() 确保 OpenClaw
 * 永不阻塞钩子或暴露错误。
 */
export const _openclaw = {
  wake: (
    event: import("../openclaw/types.js").OpenClawHookEvent,
    context: import("../openclaw/types.js").OpenClawContext,
  ) => {
    if (process.env.WISE_OPENCLAW !== "1") return;
    const logOpenClawWakeFailure = createSwallowedErrorLogger(
      `hooks.bridge openclaw wake failed for ${event}`,
    );
    import("../openclaw/index.js")
      .then(({ wakeOpenClaw }) => wakeOpenClaw(event, context).catch(logOpenClawWakeFailure))
      .catch(logOpenClawWakeFailure);
  },
};

/**
 * 处理 pre-tool-use 钩子
 * 检查委派强制并追踪后台任务
 */
function processPreToolUse(input: HookInput): HookOutput {
  const directory = resolveToWorktreeRoot(input.directory);
  const teamWorkerIdentity = teamWorkerIdentityFromEnv();
  const promptPrerequisiteConfig = getPromptPrerequisiteConfig(loadConfig());

  if (teamWorkerIdentity) {
    if (input.toolName === "Task") {
      return {
        continue: false,
        reason: "team-worker-task-blocked",
        message: `Worker ${teamWorkerIdentity} is not allowed to spawn/delegate Task tool calls. Execute directly in worker context.`,
      };
    }

    if (input.toolName === "Skill") {
      const skillName = getInvokedSkillName(input.toolInput) ?? "unknown";
      return {
        continue: false,
        reason: "team-worker-skill-blocked",
        message: `Worker ${teamWorkerIdentity} cannot invoke Skill(${skillName}) in team-worker mode.`,
      };
    }

    if (input.toolName === "Bash") {
      const command =
        (input.toolInput as { command?: string } | undefined)?.command ?? "";
      const reason = workerBashBlockReason(command);
      if (reason) {
        return {
          continue: false,
          reason: "team-worker-bash-blocked",
          message: `${reason}\nCommand blocked: ${command}`,
        };
      }
    }
  }

  // 优先检查委派强制
  const enforcementResult = processOrchestratorPreTool({
    toolName: input.toolName || "",
    toolInput: (input.toolInput as Record<string, unknown>) || {},
    sessionId: input.sessionId,
    directory,
  });

  // 若强制逻辑阻断，立即返回
  if (!enforcementResult.continue) {
    return {
      continue: false,
      reason: enforcementResult.reason,
      message: enforcementResult.message,
    };
  }

  const preToolMessages = enforcementResult.message
    ? [enforcementResult.message]
    : [];
  let modifiedToolInput: Record<string, unknown> | undefined;

  // 在记录进度之前检查阻断 —— 否则一个被拒绝的工具
  //（例如 Edit）若同时命中前置条件，其进度会被持久化，
  // 尽管该工具从未真正执行。
  const promptPrerequisiteState = readPromptPrerequisiteState(directory, input.sessionId);
  if (
    promptPrerequisiteState?.active
    && isPromptPrerequisiteBlockingTool(input.toolName, promptPrerequisiteConfig)
  ) {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: buildPromptPrerequisiteDenyReason(promptPrerequisiteState, input.toolName),
      },
    } as HookOutput & { hookSpecificOutput: Record<string, unknown> };
  }

  const promptPrerequisiteProgress = recordPromptPrerequisiteProgress(
    directory,
    input.sessionId,
    input.toolName,
    input.toolInput,
  );

  if (promptPrerequisiteProgress?.isComplete) {
    preToolMessages.push(
      "[PROMPT PREREQUISITES COMPLETE] Required context tools/files were read. Editing and agent delegation are unblocked.",
    );
  }

  // 注意：生产环境中的死代码 —— 仅为 Vitest 驱动的回归覆盖而保留。
  // 生产环境的 PreToolUse 在 `hooks/hooks.json` 中接到了
  // `scripts/pre-tool-enforcer.mjs`（不是本 bridge）。此代码块只能通过
  // `processHook('pre-tool-use', ...)` 到达，而后者仅被 src/**/__tests__/
  // 下的测试调用。此处发出的消息与 enforcer 保持措辞对齐以防意外漂移，
  // 但绝不可依赖它来塑造生产环境中的 LLM 行为。已标记待删除 —— 见
  // `.wise/plans/open-questions.md` 中 model-routing 对齐部分的 Open Questions 条目。
  // Force-inherit：当 forceInherit 启用时（Bedrock、Vertex、CC Switch 等），
  // 拒绝携带 `model` 参数的 Task/Agent 调用。
  // Claude Code 的钩子协议不支持 modifiedInput，因此我们无法
  // 静默剥离 model。改为拒绝该调用，让 Claude 不带 model 参数重试，
  // 从而让 agent 继承父会话的 model。
  //（issues #1135, #1201, #1415）
  if (isDelegationToolName(input.toolName)) {
    const originalInput = input.toolInput as
      | Record<string, unknown>
      | undefined;
    const inputModel = originalInput?.model;

    if (inputModel) {
      const config = loadConfig();
      if (config.routing?.forceInherit) {
        // 使用 permissionDecision:"deny" —— 这是 Claude Code 支持的、
        // 唯一能在 PreToolUse 中带反馈阻断特定工具调用的机制。
        // 钩子协议不支持 modifiedInput。
        const denyReason = `[MODEL ROUTING] This environment uses a non-standard provider (Bedrock/Vertex/proxy). Omit the \`model\` parameter on ${input.toolName} calls so agents inherit the parent session's model. The model "${inputModel}" was rejected.`;
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: denyReason,
          },
        } as HookOutput & { hookSpecificOutput: Record<string, unknown> };
      }
    }
  }

  if (input.toolName === "Task") {
    const originalTaskInput = input.toolInput as
      | Record<string, unknown>
      | undefined;

    if (originalTaskInput?.run_in_background === true) {
      const subagentType =
        typeof originalTaskInput.subagent_type === "string"
          ? originalTaskInput.subagent_type
          : undefined;
      const permissionFallback = getBackgroundTaskPermissionFallback(
        directory,
        subagentType,
      );

      if (permissionFallback.shouldFallback) {
        const reason = `[BACKGROUND PERMISSIONS] ${subagentType || "This background agent"} may need ${permissionFallback.missingTools.join(", ")} permissions, but background agents cannot request interactive approval. Re-run without \`run_in_background=true\` or pre-approve ${permissionFallback.missingTools.join(", ")} in Claude Code settings.`;
        return {
          continue: false,
          reason,
          message: reason,
        };
      }
    }
  }

  if (input.toolName === "Bash") {
    const originalBashInput = input.toolInput as
      | Record<string, unknown>
      | undefined;
    const nextBashInput = originalBashInput ? { ...originalBashInput } : {};

    if (nextBashInput.run_in_background === true) {
      const command =
        typeof nextBashInput.command === "string"
          ? nextBashInput.command
          : undefined;
      const permissionFallback = getBackgroundBashPermissionFallback(
        directory,
        command,
      );

      if (permissionFallback.shouldFallback) {
        const reason =
          "[BACKGROUND PERMISSIONS] This Bash command is not auto-approved for background execution. Re-run without `run_in_background=true` or pre-approve the command in Claude Code settings.";
        return {
          continue: false,
          reason,
          message: reason,
        };
      }
    }
  }

  // 当 AskUserQuestion 即将执行时通知（issue #597）
  // 即发即忘：在工具阻塞之前通知用户需要输入
  if (input.toolName === "AskUserQuestion" && input.sessionId) {
    _notify.askUserQuestion(input.sessionId, directory, input.toolInput);
    // 为 ask-user-question 唤醒 OpenClaw 网关（非阻塞）
    _openclaw.wake("ask-user-question", {
      sessionId: input.sessionId,
      projectPath: directory,
      question: (() => {
        const ti = input.toolInput as
          | { questions?: Array<{ question?: string }> }
          | undefined;
        return (
          ti?.questions
            ?.map((q) => q.question || "")
            .filter(Boolean)
            .join("; ") || ""
        );
      })(),
    });
  }

  // 当 Skill 工具被调用时激活 skill 状态（issue #1033）
  // 这会写入 skill-active-state.json，使 Stop 钩子能在 skill 执行期间
  // 防止会话被提前终止。
  // 传入 rawSkillName，让 writeSkillActiveState 能区分 WISE 内置 skill
  // 与同名的项目自定义 skill（issue #1581）。
  if (input.toolName === "Skill") {
    const skillName = getInvokedSkillName(input.toolInput);
    if (skillName) {
      const rawSkillName = getRawSkillName(input.toolInput);
      // 使用静态导入的同步写入，确保它在 Stop 钩子触发前完成。
      // 之前即发即忘的 .then() 在短命进程中会与 Stop 钩子产生竞态。
      try {
        writeSkillActiveState(directory, skillName, input.sessionId, rawSkillName);
        confirmSkillModeStates(directory, skillName, input.sessionId);
        if (isConsensusPlanningSkillInvocation(skillName, input.toolInput)) {
          activateRalplanState(directory, input.sessionId);
        }
        // Workflow-slot 账本：当 Skill 工具为 8 个规范 workflow skill 之一
        // 被调用时，确保 slot 存在且已新鲜确认。先播种（幂等 —— 当 slot
        // 已在 UserPromptSubmit 期间武装时保留既有字段），再刷新
        // `last_confirmed_at`，使 stop-hook 对账能区分真正空闲的 workflow
        // 与进行中的 workflow。
        if (isCanonicalWorkflowSkill(skillName)) {
          seedWorkflowSlotForSkill(
            directory,
            skillName,
            input.sessionId,
            "pre-tool:skill",
          );
          confirmWorkflowSlot(directory, skillName, input.sessionId);
        }
      } catch {
        // skill-state/状态同步写入是尽力而为的；出错不要让钩子失败。
      }
    }
  }

  // 当通过 Task 工具派生新 agent 时通知（issue #761）
  // 即发即忘：冗长过滤在 notify() 内部处理
  if (input.toolName === "Task" && input.sessionId) {
    const taskInput = input.toolInput as
      | {
          subagent_type?: string;
          description?: string;
        }
      | undefined;
    const agentType = taskInput?.subagent_type;
    const agentName = agentType?.includes(":")
      ? agentType.split(":").pop()
      : agentType;
    dispatchNotificationInBackground("agent-call", {
      sessionId: input.sessionId!,
      projectPath: directory,
      agentName,
      agentType,
      profileName: process.env.WISE_NOTIFY_PROFILE,
    });
  }

  // 警告 pkill -f 的自终止风险（issue #210）
  // 匹配：pkill -f、pkill -9 -f、pkill --full 等。
  if (input.toolName === "Bash") {
    const effectiveBashInput = (modifiedToolInput ?? input.toolInput) as
      | { command?: string }
      | undefined;
    const command = effectiveBashInput?.command ?? "";
    if (
      PKILL_F_FLAG_PATTERN.test(command) ||
      PKILL_FULL_FLAG_PATTERN.test(command)
    ) {
      return {
        continue: true,
        message: [
          "WARNING: `pkill -f` matches its own process command line and will self-terminate the shell (exit code 144 = SIGTERM).",
          "Safer alternatives:",
          "  - `pkill <exact-process-name>` (without -f)",
          '  - `kill $(pgrep -f "pattern")` (pgrep does not kill itself)',
          "Proceeding anyway, but the command may kill this shell session.",
        ].join("\n"),
        ...(modifiedToolInput ? { modifiedInput: modifiedToolInput } : {}),
      };
    }
  }

  // 后台进程守卫 - 防止 fork 炸弹（issue #302）
  // 超出限制时阻断新的后台任务
  if (input.toolName === "Task" || input.toolName === "Bash") {
    const toolInput = (modifiedToolInput ?? input.toolInput) as
      | {
          description?: string;
          subagent_type?: string;
          run_in_background?: boolean;
          command?: string;
        }
      | undefined;

    if (toolInput?.run_in_background) {
      const config = loadConfig();
      const maxBgTasks = config.permissions?.maxBackgroundTasks ?? 5;
      const runningCount = getRunningTaskCount(directory, input.sessionId);

      if (runningCount >= maxBgTasks) {
        return {
          continue: false,
          reason:
            `Background process limit reached (${runningCount}/${maxBgTasks}). ` +
            `Wait for running tasks to complete before starting new ones. ` +
            `Limit is configurable via permissions.maxBackgroundTasks in config or WISE_MAX_BACKGROUND_TASKS env var.`,
        };
      }
    }
  }

  // 追踪 Task 工具调用以供 HUD 展示
  if (input.toolName === "Task") {
    const toolInput = (modifiedToolInput ?? input.toolInput) as
      | {
          description?: string;
          subagent_type?: string;
          run_in_background?: boolean;
        }
      | undefined;

    if (toolInput?.description) {
      const taskId =
        getHookToolUseId(input)
        ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      addBackgroundTask(
        taskId,
        toolInput.description,
        toolInput.subagent_type,
        directory,
        input.sessionId,
      );
    }
  }

  // 同时追踪后台 Bash 调用。Ralph 的 Stop 钩子使用这个会话级
  // pending-work 信号，以避免在预期 Claude Code 会于后台命令完成时
  // 通知的情况下重复强化。
  if (input.toolName === "Bash") {
    const toolInput = (modifiedToolInput ?? input.toolInput) as
      | {
          command?: string;
          run_in_background?: boolean;
        }
      | undefined;

    if (toolInput?.run_in_background === true && toolInput.command) {
      const taskId =
        getHookToolUseId(input)
        ?? `bash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      addBackgroundTask(
        taskId,
        toolInput.command,
        "bash",
        directory,
        input.sessionId,
      );
    }
  }

  if ((input.toolName || "").toLowerCase() === "schedulewakeup") {
    recordScheduledWakeup(directory, input.sessionId, input.toolInput);
  }

  // 追踪 Edit/Write 工具的文件归属
  if (input.toolName === "Edit" || input.toolName === "Write") {
    const toolInput = input.toolInput as { file_path?: string } | undefined;
    if (toolInput?.file_path && input.sessionId) {
      // 注意：此处 pre-tool 没有 agent_id，文件归属在别处记录
      // 记录文件触碰以供回放
      recordFileTouch(
        directory,
        input.sessionId,
        "orchestrator",
        toolInput.file_path,
      );
    }
  }

  // 为 Task 工具调用注入 agent 仪表盘（调试并行 agent）
  if (input.toolName === "Task") {
    const dashboard = getAgentDashboard(directory);
    if (dashboard) {
      const combined = [...preToolMessages, dashboard]
        .filter(Boolean)
        .join("\n\n");
      return {
        continue: true,
        ...(combined ? { message: combined } : {}),
        ...(modifiedToolInput ? { modifiedInput: modifiedToolInput } : {}),
      };
    }
  }

  // 为 pre-tool-use 唤醒 OpenClaw 网关（非阻塞，仅对允许的工具触发）。
  // AskUserQuestion 已有专属的高信号 OpenClaw 事件。
  if (input.sessionId && input.toolName !== "AskUserQuestion") {
    _openclaw.wake("pre-tool-use", {
      sessionId: input.sessionId,
      projectPath: directory,
      toolName: input.toolName,
      toolInput: input.toolInput,
    });
  }

  return {
    continue: true,
    ...(preToolMessages.length > 0
      ? { message: preToolMessages.join("\n\n") }
      : {}),
    ...(modifiedToolInput ? { modifiedInput: modifiedToolInput } : {}),
  };
}

/**
 * 处理 post-tool-use 钩子
 */
function getInvokedSkillName(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }

  const input = toolInput as Record<string, unknown>;
  const rawSkill =
    input.skill ?? input.skill_name ?? input.skillName ?? input.command ?? null;

  if (typeof rawSkill !== "string" || rawSkill.trim().length === 0) {
    return null;
  }

  const normalized = rawSkill.trim();
  const namespaced = normalized.includes(":")
    ? normalized.split(":").at(-1)
    : normalized;
  return namespaced?.toLowerCase() || null;
}

/**
 * 从 Skill 工具输入中提取原始（未归一化）skill 名。
 * 用于区分 WISE 内置 skill（带 'wise:' 前缀）与同裸名的项目自定义
 * skill 或其他插件 skill。
 * 参见：https://github.com/wise-claw/wise/issues/1581
 */
function getRawSkillName(toolInput: unknown): string | undefined {
  if (!toolInput || typeof toolInput !== "object") return undefined;
  const input = toolInput as Record<string, unknown>;
  const raw = input.skill ?? input.skill_name ?? input.skillName ?? input.command ?? null;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

async function processPostToolUse(input: HookInput): Promise<HookOutput> {
  const directory = resolveToWorktreeRoot(input.directory);
  const messages: string[] = [];

  // 确保当执行通过 Skill 工具启动时，mode 状态激活也能生效
  //（例如 ralplan 共识交接进入 Skill("wise:ralph")）。
  const toolName = (input.toolName || "").toLowerCase();
  if (toolName === "skill") {
    const skillName = getInvokedSkillName(input.toolInput);
    if (skillName === "ralph") {
      const {
        createRalphLoopHook,
        detectCriticModeFlag,
        stripCriticModeFlag,
      } = await import("./ralph/index.js");
      const rawPrompt =
        typeof input.prompt === "string" && input.prompt.trim().length > 0
          ? input.prompt
          : "Ralph loop activated via Skill tool";

      const criticMode = detectCriticModeFlag(rawPrompt) ?? undefined;
      const cleanPrompt = stripCriticModeFlag(rawPrompt);

      const hook = createRalphLoopHook(directory);
      hook.startLoop(
        input.sessionId,
        cleanPrompt,
        {
          ...(criticMode ? { criticMode } : {}),
        },
      );
    }

    // 在 skill 完成时清除 skill-active 状态以防误阻断。
    // 否则每个非 'none' 的 skill 都会误阻断 stop，直到 TTL 过期。
    // 守卫：仅当完成中的 skill 拥有该 active 状态时才清除。
    // 当父 skill（如 wise-setup）调用子 skill（如 mcp-setup）时，
    // 子 skill 的 PostToolUse 先触发 —— 此时绝不能删除父 skill 的状态。
    const { clearSkillActiveState, readSkillActiveState } = await import("./skill-state/index.js");
    const currentState = readSkillActiveState(directory, input.sessionId);
    const completingSkill = (getInvokedSkillName(input.toolInput) ?? "")
      .toLowerCase()
      .replace(/^wise:/, "");
    if (!currentState || !currentState.active || currentState.skill_name === completingSkill) {
      clearSkillActiveState(directory, input.sessionId);
    }
    // Workflow-slot 账本：当规范 workflow slot 的 Skill 调用完成时，
    // 对其做 tombstone。软 tombstone（而非硬删除）会保留 slot 直到
    // TTL 清理器移除它 —— 后到的 stop 钩子看到的是一致状态，而非缺失 slot。
    if (skillName && isCanonicalWorkflowSkill(skillName)) {
      tombstoneWorkflowSlot(directory, skillName, input.sessionId);
    }
    if (isConsensusPlanningSkillInvocation(skillName, input.toolInput)) {
      deactivateRalplanState(directory, input.sessionId);
    }
  }

  // 运行 orchestrator 的 post-tool 处理（remember 标签、校验提醒等）
  const orchestratorResult = processOrchestratorPostTool(
    {
      toolName: input.toolName || "",
      toolInput: (input.toolInput as Record<string, unknown>) || {},
      sessionId: input.sessionId,
      directory,
    },
    String(input.toolOutput ?? ""),
  );

  if (orchestratorResult.message) {
    messages.push(orchestratorResult.message);
  }
  if (orchestratorResult.modifiedOutput) {
    messages.push(orchestratorResult.modifiedOutput);
  }

  if (input.toolName === "Task") {
    const toolInput = input.toolInput as
      | {
          description?: string;
          subagent_type?: string;
          run_in_background?: boolean;
        }
      | undefined;
    const toolUseId = getHookToolUseId(input);
    const asyncAgentId = extractAsyncAgentId(input.toolOutput);
    const description = toolInput?.description;
    const agentType = toolInput?.subagent_type;

    if (asyncAgentId) {
      if (toolUseId) {
        remapBackgroundTaskId(toolUseId, asyncAgentId, directory, input.sessionId);
      } else if (description) {
        remapMostRecentMatchingBackgroundTaskId(
          description,
          asyncAgentId,
          directory,
          agentType,
          input.sessionId,
        );
      }
    } else {
      const failed = taskLaunchDidFail(input.toolOutput);
      if (toolUseId) {
        completeBackgroundTask(toolUseId, directory, failed, input.sessionId);
      } else if (description) {
        completeMostRecentMatchingBackgroundTask(
          description,
          directory,
          failed,
          agentType,
          input.sessionId,
        );
      }
    }
  }

  if (input.toolName === "Bash") {
    const toolInput = input.toolInput as
      | {
          command?: string;
          run_in_background?: boolean;
        }
      | undefined;
    if (toolInput?.run_in_background === true) {
      const toolUseId = getHookToolUseId(input);
      const backgroundBashId = extractBackgroundBashId(input.toolOutput);
      const command = toolInput.command;

      if (backgroundBashId) {
        if (toolUseId) {
          remapBackgroundTaskId(toolUseId, backgroundBashId, directory, input.sessionId);
        } else if (command) {
          remapMostRecentMatchingBackgroundTaskId(
            command,
            backgroundBashId,
            directory,
            "bash",
            input.sessionId,
          );
        }
      } else if (!bashLaunchIsBackgroundPending(input.toolOutput)) {
        const failed = taskLaunchDidFail(input.toolOutput);
        if (toolUseId) {
          completeBackgroundTask(toolUseId, directory, failed, input.sessionId);
        } else if (command) {
          completeMostRecentMatchingBackgroundTask(
            command,
            directory,
            failed,
            "bash",
            input.sessionId,
          );
        }
      }
    }
  }

  // 委派完成后，展示更新后的 agent 仪表盘
  if (isDelegationToolName(input.toolName)) {
    const dashboard = getAgentDashboard(directory);
    if (dashboard) {
      messages.push(dashboard);
    }
  }

  if (input.toolName === "TaskOutput") {
    const taskOutput = parseTaskOutputLifecycle(input.toolOutput);
    if (taskOutput) {
    completeBackgroundTask(
      taskOutput.taskId,
      directory,
      taskOutputDidFail(taskOutput.status),
      input.sessionId,
    );
  }
  }

  // 为 post-tool-use 唤醒 OpenClaw 网关（非阻塞，对所有工具触发）。
  // AskUserQuestion 已发出专属的 question.requested 信号。
  if (input.sessionId && input.toolName !== "AskUserQuestion") {
    _openclaw.wake("post-tool-use", {
      sessionId: input.sessionId,
      projectPath: directory,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput,
    });
  }

  if (messages.length > 0) {
    return {
      continue: true,
      message: messages.join("\n\n"),
    };
  }

  return { continue: true };
}

/**
 * 处理 autopilot 钩子
 * 管理 autopilot 状态并注入阶段 prompt
 */
async function processAutopilot(input: HookInput): Promise<HookOutput> {
  const directory = resolveToWorktreeRoot(input.directory);

  // 延迟加载 autopilot 模块
  const { readAutopilotState, getPhasePrompt } =
    await import("./autopilot/index.js");

  const state = readAutopilotState(directory, input.sessionId);

  if (!state || !state.active) {
    return { continue: true };
  }

  // 检查阶段并注入相应 prompt
  const config = loadConfig();
  const context = {
    idea: state.originalIdea,
    specPath: state.expansion.spec_path || ".wise/autopilot/spec.md",
    planPath: state.planning.plan_path || resolveAutopilotPlanPath(config),
    openQuestionsPath: resolveOpenQuestionsPlanPath(config),
  };

  const phasePrompt = getPhasePrompt(state.phase, context);
  const runtimeInsight = formatAutopilotRuntimeInsight(directory, input.sessionId);

  if (phasePrompt || runtimeInsight) {
    const detailParts = [runtimeInsight, phasePrompt].filter(Boolean);
    return {
      continue: true,
      message: `[AUTOPILOT - Phase: ${state.phase.toUpperCase()}]\n\n${detailParts.join("\n\n")}`,
    };
  }

  return { continue: true };
}

/**
 * 为性能缓存已解析的 WISE_SKIP_HOOKS（进程生命周期内环境变量不变）
 */
let _cachedSkipHooks: string[] | null = null;
function getSkipHooks(): string[] {
  if (_cachedSkipHooks === null) {
    _cachedSkipHooks =
      process.env.WISE_SKIP_HOOKS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
  }
  return _cachedSkipHooks;
}

/**
 * 重置 skip hooks 缓存（仅用于测试）
 */
export function resetSkipHooksCache(): void {
  _cachedSkipHooks = null;
}

/**
 * 主钩子处理器
 * 根据类型路由到具体钩子处理器
 */
export async function processHook(
  hookType: HookType,
  rawInput: HookInput,
): Promise<HookOutput> {
  // 插件共存的环境 kill 开关
  if (process.env.DISABLE_WISE === "1" || process.env.DISABLE_WISE === "true") {
    return { continue: true };
  }
  const skipHooks = getSkipHooks();
  if (skipHooks.includes(hookType)) {
    return { continue: true };
  }

  // 将 Claude Code 的 snake_case 字段归一化为 camelCase
  const input = normalizeHookInput(rawInput, hookType) as HookInput;

  try {
    switch (hookType) {
      case "keyword-detector":
        return await processKeywordDetector(input);

      case "stop-continuation":
        return await processStopContinuation(input);

      case "ralph":
        // ralph 现在由统一的 persistent-mode 处理器处理（issue #1058）。
        return await processPersistentMode(input);

      case "persistent-mode":
        return await processPersistentMode(input);

      case "session-start":
        return await processSessionStart(input);

      case "pre-tool-use":
        return processPreToolUse(input);

      case "post-tool-use":
        return await processPostToolUse(input);

      case "autopilot":
        return await processAutopilot(input);

      // 延迟加载的异步钩子类型
      case "session-end": {
        if (
          !validateHookInput<SessionEndInput>(
            input,
            requiredKeysForHook("session-end"),
            "session-end",
          )
        ) {
          return { continue: true };
        }
        const { handleSessionEnd } = await import("./session-end/index.js");
        // 反归一化：SessionEndInput 期望 snake_case 字段（session_id、cwd）。
        // normalizeHookInput 已把 session_id→sessionId、cwd→directory 映射过，
        // 因此调用处理器之前必须重建 snake_case 形态。
        const rawSE = input as unknown as Record<string, unknown>;
        const sessionEndInput: SessionEndInput = {
          session_id: (rawSE.sessionId ?? rawSE.session_id) as string,
          cwd: (rawSE.directory ?? rawSE.cwd) as string,
          transcript_path: rawSE.transcript_path as string,
          permission_mode: (rawSE.permission_mode ?? "default") as string,
          hook_event_name: "SessionEnd",
          reason: (rawSE.reason as SessionEndInput["reason"]) ?? "other",
        };
        const result = await handleSessionEnd(sessionEndInput);
        _openclaw.wake("session-end", {
          sessionId: sessionEndInput.session_id,
          projectPath: sessionEndInput.cwd,
          reason: sessionEndInput.reason,
        });
        return result;
      }

      case "subagent-start": {
        if (
          !validateHookInput<SubagentStartInput>(
            input,
            requiredKeysForHook("subagent-start"),
            "subagent-start",
          )
        ) {
          return { continue: true };
        }
        const { processSubagentStart } =
          await import("./subagent-tracker/index.js");
        // 从归一化后的 camelCase 输入重建 snake_case 字段。
        // normalizeHookInput 把 cwd→directory、session_id→sessionId 映射过，
        // 但 SubagentStartInput 期望原始 snake_case 字段名。
        const normalized = input as unknown as Record<string, unknown>;
        const startInput: SubagentStartInput = {
          cwd: (normalized.directory ?? normalized.cwd) as string,
          session_id: (normalized.sessionId ?? normalized.session_id) as string,
          agent_id: normalized.agent_id as string,
          agent_type: normalized.agent_type as string,
          transcript_path: normalized.transcript_path as string,
          permission_mode: normalized.permission_mode as string,
          hook_event_name: "SubagentStart",
          prompt: normalized.prompt as string | undefined,
          model: normalized.model as string | undefined,
        };
        // recordAgentStart 已在 processSubagentStart 内部调用，
        // 因此此处不再调用，以避免重复的会话回放条目。
        return processSubagentStart(startInput);
      }

      case "subagent-stop": {
        if (
          !validateHookInput<SubagentStopInput>(
            input,
            requiredKeysForHook("subagent-stop"),
            "subagent-stop",
          )
        ) {
          return { continue: true };
        }
        const { processSubagentStop } =
          await import("./subagent-tracker/index.js");
        // 从归一化后的 camelCase 输入重建 snake_case 字段。
        // 与 subagent-start 同样的归一化错配：cwd→directory、session_id→sessionId。
        const normalizedStop = input as unknown as Record<string, unknown>;
        const stopInput: SubagentStopInput = {
          cwd: (normalizedStop.directory ?? normalizedStop.cwd) as string,
          session_id: (normalizedStop.sessionId ??
            normalizedStop.session_id) as string,
          agent_id: normalizedStop.agent_id as string,
          agent_type: normalizedStop.agent_type as string,
          transcript_path: normalizedStop.transcript_path as string,
          permission_mode: normalizedStop.permission_mode as string,
          hook_event_name: "SubagentStop",
          output: normalizedStop.output as string | undefined,
          success: normalizedStop.success as boolean | undefined,
        };
        // recordAgentStop 已在 processSubagentStop 内部调用，
        // 因此此处不再调用，以避免重复的会话回放条目。
        return processSubagentStop(stopInput);
      }

      case "pre-compact": {
        if (
          !validateHookInput<PreCompactInput>(
            input,
            requiredKeysForHook("pre-compact"),
            "pre-compact",
          )
        ) {
          return { continue: true };
        }
        const { processPreCompact } = await import("./pre-compact/index.js");
        // 反归一化：PreCompactInput 期望 snake_case 字段（session_id、cwd）。
        const rawPC = input as unknown as Record<string, unknown>;
        const preCompactInput: PreCompactInput = {
          session_id: (rawPC.sessionId ?? rawPC.session_id) as string,
          cwd: (rawPC.directory ?? rawPC.cwd) as string,
          transcript_path: rawPC.transcript_path as string,
          permission_mode: (rawPC.permission_mode ?? "default") as string,
          hook_event_name: "PreCompact",
          trigger: (rawPC.trigger as "manual" | "auto") ?? "auto",
          custom_instructions: rawPC.custom_instructions as string | undefined,
        };
        return await processPreCompact(preCompactInput);
      }

      case "setup-init":
      case "setup-maintenance": {
        if (
          !validateHookInput<SetupInput>(
            input,
            requiredKeysForHook(hookType),
            hookType,
          )
        ) {
          return { continue: true };
        }
        const { processSetup } = await import("./setup/index.js");
        // 反归一化：SetupInput 期望 snake_case 字段（session_id、cwd）。
        const rawSetup = input as unknown as Record<string, unknown>;
        const setupInput: SetupInput = {
          session_id: (rawSetup.sessionId ?? rawSetup.session_id) as string,
          cwd: (rawSetup.directory ?? rawSetup.cwd) as string,
          transcript_path: rawSetup.transcript_path as string,
          permission_mode: (rawSetup.permission_mode ?? "default") as string,
          hook_event_name: "Setup",
          trigger: hookType === "setup-init" ? "init" : "maintenance",
        };
        return await processSetup(setupInput);
      }

      case "permission-request": {
        if (
          !validateHookInput<PermissionRequestInput>(
            input,
            requiredKeysForHook("permission-request"),
            "permission-request",
          )
        ) {
          return { continue: true };
        }
        const { handlePermissionRequest } =
          await import("./permission-handler/index.js");
        // 反归一化：PermissionRequestInput 期望 snake_case 字段
        //（session_id、cwd、tool_name、tool_input）。
        const rawPR = input as unknown as Record<string, unknown>;
        const permissionInput: PermissionRequestInput = {
          session_id: (rawPR.sessionId ?? rawPR.session_id) as string,
          cwd: (rawPR.directory ?? rawPR.cwd) as string,
          tool_name: (rawPR.toolName ?? rawPR.tool_name) as string,
          tool_input: (rawPR.toolInput ??
            rawPR.tool_input) as PermissionRequestInput["tool_input"],
          transcript_path: rawPR.transcript_path as string,
          permission_mode: (rawPR.permission_mode ?? "default") as string,
          hook_event_name: "PermissionRequest",
          tool_use_id: rawPR.tool_use_id as string,
        };
        return await handlePermissionRequest(permissionInput);
      }

      case "code-simplifier": {
        const directory = input.directory ?? process.cwd();
        const stateDir = join(getWiseRoot(directory), "state");
        const { processCodeSimplifier } =
          await import("./code-simplifier/index.js");
        const result = processCodeSimplifier(directory, stateDir);
        if (result.shouldBlock) {
          return { continue: false, message: result.message };
        }
        return { continue: true };
      }

      default:
        return { continue: true };
    }
  } catch (error) {
    // 记录错误但不阻断执行
    console.error(`[hook-bridge] Error in ${hookType}:`, error);
    return { continue: true };
  }
}

/**
 * shell 脚本调用的 CLI 入口
 * 从 stdin 读取 JSON，处理钩子，把 JSON 写到 stdout
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const hookArg = args.find((a) => a.startsWith("--hook="));

  if (!hookArg) {
    console.error("Usage: node hook-bridge.mjs --hook=<type>");
    process.exit(1);
  }

  const hookTypeRaw = hookArg.slice("--hook=".length).trim();
  if (!hookTypeRaw) {
    console.error("Invalid hook argument format: missing hook type");
    process.exit(1);
  }
  const hookType = hookTypeRaw as HookType;

  // 读取 stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const inputStr = Buffer.concat(chunks).toString("utf-8");

  let input: HookInput;
  try {
    input = JSON.parse(inputStr);
  } catch {
    input = {};
  }

  // 处理钩子
  const output = await processHook(hookType, input);

  // 把输出写到 stdout
  console.log(JSON.stringify(sanitizeHookOutputForSerialization(output)));
}

// 直接调用时运行（同时兼容 ESM 和打包后的 CJS）
// 在 CJS 包中，通过比较 process.argv[1] 判断是否为主模块
// 在 ESM 中，可用 import.meta.url 比较
function isMainModule(): boolean {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    // 在 CJS 包中，直接加载时总是运行 main()
    return true;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("[hook-bridge] Fatal error:", err);
    process.exit(1);
  });
}
