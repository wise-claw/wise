/**
 * Autopilot 状态管理与阶段转换
 *
 * 负责：
 * - 跨阶段为 autopilot 工作流维护持久化状态
 * - 阶段转换，尤其是 Ralph → UltraQA 和 UltraQA → Validation
 * - 状态机操作
 */

import { mkdirSync, statSync } from "fs";
import { join } from "path";
import {
  writeModeState,
  readModeState,
  clearModeStateFile,
} from "../../lib/mode-state-io.js";
import {
  resolveStatePath,
  resolveSessionStatePath,
  getWiseRoot,
} from "../../lib/worktree-paths.js";
import type {
  AutopilotState,
  AutopilotPhase,
  AutopilotConfig,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { loadConfig } from "../../config/loader.js";
import { resolvePlanOutputAbsolutePath } from "../../config/plan-output.js";
import {
  readRalphState,
  writeRalphState,
  clearRalphState,
  clearLinkedUltraworkState,
} from "../ralph/index.js";
import {
  startUltraQA,
  clearUltraQAState,
  readUltraQAState,
} from "../ultraqa/index.js";
import { canStartMode } from "../mode-registry/index.js";

const SPEC_DIR = "autopilot";

// ============================================================================
// 状态管理
// ============================================================================

/**
 * 确保 autopilot 目录存在
 */
export function ensureAutopilotDir(directory: string): string {
  const autopilotDir = join(getWiseRoot(directory), SPEC_DIR);
  mkdirSync(autopilotDir, { recursive: true });
  return autopilotDir;
}

/**
 * 从磁盘读取 autopilot 状态
 */
export function readAutopilotState(
  directory: string,
  sessionId?: string,
): AutopilotState | null {
  const state = readModeState<AutopilotState & { current_phase?: AutopilotPhase }>(
    "autopilot",
    directory,
    sessionId,
  );

  if (state && !state.phase && state.current_phase) {
    state.phase = state.current_phase;
  }

  // 校验会话身份
  if (
    state &&
    sessionId &&
    state.session_id &&
    state.session_id !== sessionId
  ) {
    return null;
  }

  return state;
}

/**
 * 将 autopilot 状态写入磁盘
 */
export function writeAutopilotState(
  directory: string,
  state: AutopilotState,
  sessionId?: string,
): boolean {
  const stateRecord = state as unknown as Record<string, unknown>;
  const phase = typeof stateRecord.phase === "string"
    ? stateRecord.phase
    : typeof stateRecord.current_phase === "string"
      ? stateRecord.current_phase
      : undefined;
  const normalizedState = phase
    ? { ...stateRecord, phase, current_phase: phase }
    : stateRecord;

  return writeModeState(
    "autopilot",
    normalizedState,
    directory,
    sessionId,
  );
}

/**
 * 清除 autopilot 状态
 */
export function clearAutopilotState(
  directory: string,
  sessionId?: string,
): boolean {
  return clearModeStateFile("autopilot", directory, sessionId);
}

/**
 * 获取 autopilot 状态文件的时长（毫秒）。
 * 若不存在状态文件则返回 null。
 */
export function getAutopilotStateAge(
  directory: string,
  sessionId?: string,
): number | null {
  const stateFile = sessionId
    ? resolveSessionStatePath("autopilot", sessionId, directory)
    : resolveStatePath("autopilot", directory);
  try {
    const stats = statSync(stateFile);
    return Date.now() - stats.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

/**
 * 检查 autopilot 是否处于激活状态
 */
export function isAutopilotActive(
  directory: string,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  return state !== null && state.active === true;
}

/**
 * 初始化新的 autopilot 会话
 */
export function initAutopilot(
  directory: string,
  idea: string,
  sessionId?: string,
  config?: Partial<AutopilotConfig>,
): AutopilotState | null {
  // 通过 mode-registry 进行互斥检查
  const canStart = canStartMode("autopilot", directory);
  if (!canStart.allowed) {
    console.error(canStart.message);
    return null;
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const now = new Date().toISOString();

  const state: AutopilotState = {
    active: true,
    phase: "expansion",
    current_phase: "expansion",
    iteration: 1,
    max_iterations: mergedConfig.maxIterations ?? 10,
    originalIdea: idea,

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
  };

  ensureAutopilotDir(directory);
  writeAutopilotState(directory, state, sessionId);

  return state;
}

/**
 * 转换到新阶段
 */
export function transitionPhase(
  directory: string,
  newPhase: AutopilotPhase,
  sessionId?: string,
): AutopilotState | null {
  const state = readAutopilotState(directory, sessionId);

  if (!state || !state.active) {
    return null;
  }

  const now = new Date().toISOString();
  const oldPhase = state.phase;

  // 记录旧阶段的时长（若已记录开始时间）
  const phaseStartKey = `${oldPhase}_start_ms`;
  if (state.phase_durations[phaseStartKey] !== undefined) {
    const duration = Date.now() - state.phase_durations[phaseStartKey];
    state.phase_durations[oldPhase] = duration;
  }

  // 转换到新阶段并记录开始时间
  state.phase = newPhase;
  (state as AutopilotState & { current_phase?: AutopilotPhase }).current_phase = newPhase;
  state.phase_durations[`${newPhase}_start_ms`] = Date.now();

  if (newPhase === "complete" || newPhase === "failed") {
    state.completed_at = now;
    state.active = false;
  }

  writeAutopilotState(directory, state, sessionId);
  return state;
}

/**
 * 递增代理派生计数器
 */
export function incrementAgentCount(
  directory: string,
  count: number = 1,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  state.total_agents_spawned += count;
  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 更新扩展阶段数据
 */
export function updateExpansion(
  directory: string,
  updates: Partial<AutopilotState["expansion"]>,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  state.expansion = { ...state.expansion, ...updates };
  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 更新规划阶段数据
 */
export function updatePlanning(
  directory: string,
  updates: Partial<AutopilotState["planning"]>,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  state.planning = { ...state.planning, ...updates };
  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 更新执行阶段数据
 */
export function updateExecution(
  directory: string,
  updates: Partial<AutopilotState["execution"]>,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  state.execution = { ...state.execution, ...updates };
  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 更新 QA 阶段数据
 */
export function updateQA(
  directory: string,
  updates: Partial<AutopilotState["qa"]>,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  state.qa = { ...state.qa, ...updates };
  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 更新校验阶段数据
 */
export function updateValidation(
  directory: string,
  updates: Partial<AutopilotState["validation"]>,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  state.validation = { ...state.validation, ...updates };
  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 获取规格说明文件路径
 */
export function getSpecPath(directory: string): string {
  return join(getWiseRoot(directory), SPEC_DIR, "spec.md");
}

/**
 * 获取计划文件路径
 */
export function getPlanPath(directory: string): string {
  return resolvePlanOutputAbsolutePath(
    directory,
    "autopilot-impl",
    loadConfig(),
  );
}

// ============================================================================
// 阶段转换
// ============================================================================

export interface TransitionResult {
  success: boolean;
  error?: string;
  state?: AutopilotState;
}

/**
 * 从 Ralph（阶段 2：执行）转换到 UltraQA（阶段 3：QA）
 *
 * 该函数通过以下步骤处理互斥：
 * 1. 将 Ralph 的进度保存到 autopilot 状态
 * 2. 干净地终止 Ralph 模式（及关联的 Ultrawork）
 * 3. 启动 UltraQA 模式
 * 4. 为可能的回滚保留上下文
 */
export function transitionRalphToUltraQA(
  directory: string,
  sessionId: string,
): TransitionResult {
  const autopilotState = readAutopilotState(directory, sessionId);

  if (!autopilotState || autopilotState.phase !== "execution") {
    return {
      success: false,
      error: "Not in execution phase - cannot transition to QA",
    };
  }

  const ralphState = readRalphState(directory, sessionId);

  // 步骤 1：将 Ralph 进度保存到 autopilot 状态
  const executionUpdated = updateExecution(
    directory,
    {
      ralph_iterations:
        ralphState?.iteration ?? autopilotState.execution.ralph_iterations,
      ralph_completed_at: new Date().toISOString(),
      ultrawork_active: false,
    },
    sessionId,
  );

  if (!executionUpdated) {
    return {
      success: false,
      error: "Failed to update execution state",
    };
  }

  // 步骤 2：停用 Ralph（设置 active=false）以使 UltraQA 的互斥检查通过，
  // 但保留磁盘上的状态文件，以便 UltraQA 失败时回滚。
  if (ralphState) {
    writeRalphState(directory, { ...ralphState, active: false }, sessionId);
  }
  if (ralphState?.linked_ultrawork) {
    clearLinkedUltraworkState(directory, sessionId);
  }

  // 步骤 3：转换到 QA 阶段
  const newState = transitionPhase(directory, "qa", sessionId);
  if (!newState) {
    // 回滚：重新激活 Ralph
    if (ralphState) {
      writeRalphState(directory, ralphState, sessionId);
    }
    return {
      success: false,
      error: "Failed to transition to QA phase",
    };
  }

  // 步骤 4：启动 UltraQA（Ralph 已停用，互斥检查通过）
  const qaResult = startUltraQA(directory, "tests", sessionId, {
    maxCycles: 5,
  });

  if (!qaResult.success) {
    // 回滚：恢复 Ralph 状态和执行阶段
    if (ralphState) {
      writeRalphState(directory, ralphState, sessionId);
    }
    transitionPhase(directory, "execution", sessionId);
    updateExecution(directory, { ralph_completed_at: undefined }, sessionId);

    return {
      success: false,
      error: qaResult.error || "Failed to start UltraQA",
    };
  }

  // 步骤 5：UltraQA 已启动——彻底清除 Ralph 状态（尽力而为）
  clearRalphState(directory, sessionId);

  return {
    success: true,
    state: newState,
  };
}

/**
 * 从 UltraQA（阶段 3：QA）转换到校验（阶段 4）
 */
export function transitionUltraQAToValidation(
  directory: string,
  sessionId?: string,
): TransitionResult {
  const autopilotState = readAutopilotState(directory, sessionId);

  if (!autopilotState || autopilotState.phase !== "qa") {
    return {
      success: false,
      error: "Not in QA phase - cannot transition to validation",
    };
  }

  const qaState = readUltraQAState(directory, sessionId);

  // 保留 QA 进度
  const qaUpdated = updateQA(
    directory,
    {
      ultraqa_cycles: qaState?.cycle ?? autopilotState.qa.ultraqa_cycles,
      qa_completed_at: new Date().toISOString(),
    },
    sessionId,
  );

  if (!qaUpdated) {
    return {
      success: false,
      error: "Failed to update QA state",
    };
  }

  // 终止 UltraQA
  clearUltraQAState(directory, sessionId);

  // 转换到校验阶段
  const newState = transitionPhase(directory, "validation", sessionId);
  if (!newState) {
    return {
      success: false,
      error: "Failed to transition to validation phase",
    };
  }

  return {
    success: true,
    state: newState,
  };
}

/**
 * 从校验（阶段 4）转换到完成
 */
export function transitionToComplete(
  directory: string,
  sessionId?: string,
): TransitionResult {
  const state = transitionPhase(directory, "complete", sessionId);

  if (!state) {
    return {
      success: false,
      error: "Failed to transition to complete phase",
    };
  }

  return { success: true, state };
}

/**
 * 转换到失败状态
 */
export function transitionToFailed(
  directory: string,
  error: string,
  sessionId?: string,
): TransitionResult {
  const state = transitionPhase(directory, "failed", sessionId);

  if (!state) {
    return {
      success: false,
      error: "Failed to transition to failed phase",
    };
  }

  return { success: true, state };
}

/**
 * 获取供 Claude 执行转换的提示词
 */
export function getTransitionPrompt(
  fromPhase: string,
  toPhase: string,
): string {
  if (fromPhase === "execution" && toPhase === "qa") {
    return `## PHASE TRANSITION: Execution → QA

The execution phase is complete. Transitioning to QA phase.

**CRITICAL**: Ralph mode must be cleanly terminated before UltraQA can start.

The transition handler has:
1. Preserved Ralph iteration count and progress
2. Cleared Ralph state (and linked Ultrawork)
3. Started UltraQA in 'tests' mode

You are now in QA phase. Run the QA cycle:
1. Build: Run the project's build command
2. Lint: Run the project's lint command
3. Test: Run the project's test command

Fix any failures and repeat until all pass.

Signal when QA passes: QA_COMPLETE
`;
  }

  if (fromPhase === "qa" && toPhase === "validation") {
    return `## PHASE TRANSITION: QA → Validation

All QA checks have passed. Transitioning to validation phase.

The transition handler has:
1. Preserved UltraQA cycle count
2. Cleared UltraQA state
3. Updated phase to 'validation'

You are now in validation phase. Spawn parallel validation architects:

\`\`\`
// Spawn all three in parallel
Task(subagent_type="wise:architect", model="opus",
  prompt="FUNCTIONAL COMPLETENESS REVIEW: Verify all requirements from spec are implemented")

Task(subagent_type="wise:security-reviewer", model="opus",
  prompt="SECURITY REVIEW: Check for vulnerabilities, injection risks, auth issues")

Task(subagent_type="wise:code-reviewer", model="opus",
  prompt="CODE QUALITY REVIEW: Check patterns, maintainability, test coverage")
\`\`\`

Aggregate verdicts:
- All APPROVED → Signal: AUTOPILOT_COMPLETE
- Any REJECTED → Fix issues and re-validate (max 3 rounds)
`;
  }

  if (fromPhase === "expansion" && toPhase === "planning") {
    return `## PHASE TRANSITION: Expansion → Planning

The idea has been expanded into a detailed specification.

Read the spec and create an implementation plan using the Architect agent (direct planning mode).

Signal when Critic approves the plan: PLANNING_COMPLETE
`;
  }

  if (fromPhase === "planning" && toPhase === "execution") {
    return `## PHASE TRANSITION: Planning → Execution

The plan has been approved. Starting execution phase with Ralph + Ultrawork.

Execute tasks from the plan in parallel where possible.

Signal when all tasks complete: EXECUTION_COMPLETE
`;
  }

  return "";
}
