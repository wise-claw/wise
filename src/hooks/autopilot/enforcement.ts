/**
 * Autopilot 强制执行与信号检测
 *
 * 与 ralph-loop 强制执行并行——拦截 stop 并持续运行，
 * 直到检测到阶段完成信号。
 *
 * 同时负责在会话记录中检测信号。
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getClaudeConfigDir } from "../../utils/config-dir.js";
import { getHardMaxIterations } from "../../lib/security-config.js";
import {
  resolveAutopilotPlanPath,
  resolveOpenQuestionsPlanPath,
} from "../../config/plan-output.js";
import {
  readAutopilotState,
  writeAutopilotState,
  transitionPhase,
  transitionRalphToUltraQA,
  transitionUltraQAToValidation,
  transitionToComplete,
} from "./state.js";
import { getPhasePrompt } from "./prompts.js";
import type {
  AutopilotState,
  AutopilotPhase,
  AutopilotSignal,
} from "./types.js";
import {
  readLastToolError,
  getToolErrorRetryGuidance,
  type ToolErrorState,
} from "../persistent-mode/index.js";
import {
  readPipelineTracking,
  hasPipelineTracking,
  getCurrentStageAdapter,
  getCurrentCompletionSignal,
  advanceStage,
  incrementStageIteration,
  generateTransitionPrompt,
  formatPipelineHUD,
} from "./pipeline.js";
import { formatAutopilotRuntimeInsight } from "./runtime-insight.js";

export interface AutopilotEnforcementResult {
  /** 是否阻止 stop 事件 */
  shouldBlock: boolean;
  /** 注入上下文的消息 */
  message: string;
  /** 当前阶段 */
  phase: AutopilotPhase;
  /** 额外元数据 */
  metadata?: {
    iteration?: number;
    maxIterations?: number;
    tasksCompleted?: number;
    tasksTotal?: number;
    toolError?: ToolErrorState;
  };
}

// ============================================================================
// 信号检测
// ============================================================================

/**
 * 信号模式——每个信号都可能出现在会话记录中
 */
const SIGNAL_PATTERNS: Record<AutopilotSignal, RegExp> = {
  EXPANSION_COMPLETE: /EXPANSION_COMPLETE/i,
  PLANNING_COMPLETE: /PLANNING_COMPLETE/i,
  EXECUTION_COMPLETE: /EXECUTION_COMPLETE/i,
  QA_COMPLETE: /QA_COMPLETE/i,
  VALIDATION_COMPLETE: /VALIDATION_COMPLETE/i,
  AUTOPILOT_COMPLETE: /AUTOPILOT_COMPLETE/i,
  TRANSITION_TO_QA: /TRANSITION_TO_QA/i,
  TRANSITION_TO_VALIDATION: /TRANSITION_TO_VALIDATION/i,
};

/**
 * 在会话记录中检测特定信号
 */
export function detectSignal(
  sessionId: string,
  signal: AutopilotSignal,
): boolean {
  const claudeDir = getClaudeConfigDir();
  const possiblePaths = [
    join(claudeDir, "sessions", sessionId, "transcript.md"),
    join(claudeDir, "sessions", sessionId, "messages.json"),
    join(claudeDir, "transcripts", `${sessionId}.md`),
  ];

  const pattern = SIGNAL_PATTERNS[signal];
  if (!pattern) return false;

  for (const transcriptPath of possiblePaths) {
    if (existsSync(transcriptPath)) {
      try {
        const content = readFileSync(transcriptPath, "utf-8");
        if (pattern.test(content)) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}

/**
 * 获取当前阶段对应的预期信号
 */
export function getExpectedSignalForPhase(
  phase: string,
): AutopilotSignal | null {
  switch (phase) {
    case "expansion":
      return "EXPANSION_COMPLETE";
    case "planning":
      return "PLANNING_COMPLETE";
    case "execution":
      return "EXECUTION_COMPLETE";
    case "qa":
      return "QA_COMPLETE";
    case "validation":
      return "VALIDATION_COMPLETE";
    default:
      return null;
  }
}

/**
 * 检测会话记录中的任意 autopilot 信号（用于阶段推进）
 */
export function detectAnySignal(sessionId: string): AutopilotSignal | null {
  for (const signal of Object.keys(SIGNAL_PATTERNS) as AutopilotSignal[]) {
    if (detectSignal(sessionId, signal)) {
      return signal;
    }
  }
  return null;
}

// ============================================================================
// 强制执行
// ============================================================================

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

function isOrphanedRoutingEchoState(state: AutopilotState): boolean {
  const phase = typeof state.phase === "string" ? state.phase.trim().toLowerCase() : "";
  if (phase && phase !== "unspecified") return false;

  const stateRecord = state as unknown as Record<string, unknown>;
  const promptText = [
    stateRecord.originalIdea,
    stateRecord.original_idea,
    stateRecord.prompt,
    stateRecord.task_description,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();

  return /^\[MAGIC KEYWORDS?(?: DETECTED)?:\s*AUTOPILOT\s*\]\s*$/i.test(promptText);
}

/**
 * 获取当前阶段之后的下一个阶段
 */
function getNextPhase(current: AutopilotPhase): AutopilotPhase | null {
  switch (current) {
    case "expansion":
      return "planning";
    case "planning":
      return "execution";
    case "execution":
      return "qa";
    case "qa":
      return "validation";
    case "validation":
      return "complete";
    default:
      return null;
  }
}

/**
 * 检查 autopilot 状态并判断是否应继续运行
 * 这是 persistent-mode 钩子调用的主强制执行函数
 */
export async function checkAutopilot(
  sessionId?: string,
  directory?: string,
): Promise<AutopilotEnforcementResult | null> {
  const workingDir = directory || process.cwd();
  const state = readAutopilotState(workingDir, sessionId);

  if (!state || !state.active) {
    return null;
  }

  // 严格会话隔离：仅处理匹配会话的状态
  if (state.session_id !== sessionId) {
    return null;
  }

  if (isAwaitingConfirmation(state)) {
    return null;
  }

  if (isOrphanedRoutingEchoState(state)) {
    return null;
  }

  // 检查硬性最大迭代数（全局安全限制）
  const hardMax = getHardMaxIterations();
  if (hardMax > 0 && state.iteration >= hardMax) {
    transitionPhase(workingDir, "failed", sessionId);
    return {
      shouldBlock: false,
      message: `[AUTOPILOT STOPPED] Hard max iterations (${hardMax}) reached. Security limit enforced.`,
      phase: "failed",
    };
  }

  // 检查最大迭代数（安全限制）
  if (state.iteration >= state.max_iterations) {
    transitionPhase(workingDir, "failed", sessionId);
    return {
      shouldBlock: false,
      message: `[AUTOPILOT STOPPED] Max iterations (${state.max_iterations}) reached. Consider reviewing progress.`,
      phase: "failed",
    };
  }

  // 检查是否已完成
  if (state.phase === "complete") {
    return {
      shouldBlock: false,
      message: `[AUTOPILOT COMPLETE] All phases finished successfully!`,
      phase: "complete",
    };
  }

  if (state.phase === "failed") {
    return {
      shouldBlock: false,
      message: `[AUTOPILOT FAILED] Session ended in failure state.`,
      phase: "failed",
    };
  }

  // ====================================================================
  // 流水线感知的强制执行
  // 如果状态包含流水线跟踪信息，则使用流水线编排器
  // 进行信号检测和阶段推进，而非使用旧版阶段逻辑。
  // ====================================================================
  if (hasPipelineTracking(state)) {
    return checkPipelineAutopilot(state, sessionId, workingDir);
  }

  // ====================================================================
  // 旧版强制执行（流水线之前的状态）
  // ====================================================================

  // 检查阶段完成信号
  const expectedSignal = getExpectedSignalForPhase(state.phase);
  if (expectedSignal && sessionId && detectSignal(sessionId, expectedSignal)) {
    // 阶段完成——切换到下一阶段
    const nextPhase = getNextPhase(state.phase);
    if (nextPhase) {
      // 处理特殊切换
      if (state.phase === "execution" && nextPhase === "qa") {
        const result = transitionRalphToUltraQA(workingDir, sessionId);
        if (!result.success) {
          // 切换失败，继续在当前阶段运行
          return generateContinuationPrompt(state, workingDir);
        }
      } else if (state.phase === "qa" && nextPhase === "validation") {
        const result = transitionUltraQAToValidation(workingDir, sessionId);
        if (!result.success) {
          return generateContinuationPrompt(state, workingDir, sessionId);
        }
      } else if (nextPhase === "complete") {
        transitionToComplete(workingDir, sessionId);
        return {
          shouldBlock: false,
          message: `[AUTOPILOT COMPLETE] All phases finished successfully!`,
          phase: "complete",
        };
      } else {
        transitionPhase(workingDir, nextPhase, sessionId);
      }

      // 获取新状态并为下一阶段生成 prompt
      const newState = readAutopilotState(workingDir, sessionId);
      if (newState) {
        return generateContinuationPrompt(newState, workingDir, sessionId);
      }
    }
  }

  // 未检测到信号——继续当前阶段
  return generateContinuationPrompt(state, workingDir, sessionId);
}

/**
 * 为当前阶段生成续接 prompt
 */
function generateContinuationPrompt(
  state: AutopilotState,
  directory: string,
  sessionId?: string,
): AutopilotEnforcementResult {
  // 在生成消息前读取工具错误
  const toolError = readLastToolError(directory);
  const errorGuidance = getToolErrorRetryGuidance(toolError);
  const runtimeInsight = formatAutopilotRuntimeInsight(directory, sessionId);

  // 递增迭代数
  state.iteration += 1;
  writeAutopilotState(directory, state, sessionId);

  const phasePrompt = getPhasePrompt(state.phase, {
    idea: state.originalIdea,
    specPath: state.expansion.spec_path || `.wise/autopilot/spec.md`,
    planPath: state.planning.plan_path || resolveAutopilotPlanPath(),
    openQuestionsPath: resolveOpenQuestionsPlanPath(),
  });

  const continuationPrompt = `<autopilot-continuation>
${errorGuidance ? errorGuidance + "\n" : ""}
${runtimeInsight ? `${runtimeInsight}\n\n` : ""}
[AUTOPILOT - PHASE: ${state.phase.toUpperCase()} | ITERATION ${state.iteration}/${state.max_iterations}]

Your previous response did not signal phase completion. Continue working on the current phase.

${phasePrompt}

IMPORTANT: When the phase is complete, output the appropriate signal:
- Expansion: EXPANSION_COMPLETE
- Planning: PLANNING_COMPLETE
- Execution: EXECUTION_COMPLETE
- QA: QA_COMPLETE
- Validation: VALIDATION_COMPLETE

</autopilot-continuation>

---

`;

  return {
    shouldBlock: true,
    message: continuationPrompt,
    phase: state.phase,
    metadata: {
      iteration: state.iteration,
      maxIterations: state.max_iterations,
      tasksCompleted: state.execution.tasks_completed,
      tasksTotal: state.execution.tasks_total,
      toolError: toolError || undefined,
    },
  };
}

// ============================================================================
// 流水线感知的强制执行
// ============================================================================

/**
 * 针对带有流水线跟踪信息的 autopilot 状态的流水线感知强制执行。
 * 使用流水线编排器进行信号检测和阶段推进。
 */
function checkPipelineAutopilot(
  state: AutopilotState,
  sessionId: string | undefined,
  directory: string,
): AutopilotEnforcementResult | null {
  const tracking = readPipelineTracking(state);
  if (!tracking) return null;

  const currentAdapter = getCurrentStageAdapter(tracking);
  if (!currentAdapter) {
    // 没有更多阶段——流水线已完成
    return {
      shouldBlock: false,
      message:
        "[AUTOPILOT COMPLETE] All pipeline stages finished successfully!",
      phase: "complete",
    };
  }

  // 检查当前阶段的完成信号是否已发出
  const completionSignal = getCurrentCompletionSignal(tracking);
  if (
    completionSignal &&
    sessionId &&
    detectPipelineSignal(sessionId, completionSignal)
  ) {
    // 当前阶段完成——推进到下一阶段
    const { adapter: nextAdapter, phase: nextPhase } = advanceStage(
      directory,
      sessionId,
    );

    if (!nextAdapter || nextPhase === "complete") {
      // 流水线完成
      transitionPhase(directory, "complete", sessionId);
      return {
        shouldBlock: false,
        message:
          "[AUTOPILOT COMPLETE] All pipeline stages finished successfully!",
        phase: "complete",
      };
    }

    if (nextPhase === "failed") {
      return {
        shouldBlock: false,
        message: "[AUTOPILOT FAILED] Pipeline stage transition failed.",
        phase: "failed",
      };
    }

    // 生成切换 + 下一阶段 prompt
    const transitionMsg = generateTransitionPrompt(
      currentAdapter.id,
      nextAdapter.id,
    );

    // 重新读取跟踪信息以获取更新后的状态
    const updatedState = readAutopilotState(directory, sessionId);
    const updatedTracking = updatedState
      ? readPipelineTracking(updatedState)
      : null;
    const hudLine = updatedTracking ? formatPipelineHUD(updatedTracking) : "";

    const context = {
      idea: state.originalIdea,
      directory: state.project_path || directory,
      sessionId,
      specPath: state.expansion.spec_path || ".wise/autopilot/spec.md",
      planPath: state.planning.plan_path || resolveAutopilotPlanPath(),
      openQuestionsPath: resolveOpenQuestionsPlanPath(),
      config: tracking.pipelineConfig,
    };

    const stagePrompt = nextAdapter.getPrompt(context);

    return {
      shouldBlock: true,
      message: `<autopilot-pipeline-transition>
${hudLine}

${transitionMsg}

${stagePrompt}
</autopilot-pipeline-transition>

---

`,
      phase: state.phase,
      metadata: {
        iteration: state.iteration,
        maxIterations: state.max_iterations,
      },
    };
  }

  // 未检测到信号——继续当前阶段
  incrementStageIteration(directory, sessionId);

  const toolError = readLastToolError(directory);
  const errorGuidance = getToolErrorRetryGuidance(toolError);
  const runtimeInsight = formatAutopilotRuntimeInsight(directory, sessionId);

  // 递增总迭代数
  state.iteration += 1;
  writeAutopilotState(directory, state, sessionId);

  const updatedTracking = readPipelineTracking(
    readAutopilotState(directory, sessionId)!,
  );
  const hudLine = updatedTracking ? formatPipelineHUD(updatedTracking) : "";

  const context = {
    idea: state.originalIdea,
    directory: state.project_path || directory,
    sessionId,
    specPath: state.expansion.spec_path || ".wise/autopilot/spec.md",
    planPath: state.planning.plan_path || resolveAutopilotPlanPath(),
    openQuestionsPath: resolveOpenQuestionsPlanPath(),
    config: tracking.pipelineConfig,
  };

  const stagePrompt = currentAdapter.getPrompt(context);

  const continuationPrompt = `<autopilot-pipeline-continuation>
${errorGuidance ? errorGuidance + "\n" : ""}
${runtimeInsight ? `${runtimeInsight}\n\n` : ""}
${hudLine}

[AUTOPILOT PIPELINE - STAGE: ${currentAdapter.name.toUpperCase()} | ITERATION ${state.iteration}/${state.max_iterations}]

Your previous response did not signal stage completion. Continue working on the current stage.

${stagePrompt}

IMPORTANT: When this stage is complete, output the signal: ${currentAdapter.completionSignal}

</autopilot-pipeline-continuation>

---

`;

  return {
    shouldBlock: true,
    message: continuationPrompt,
    phase: state.phase,
    metadata: {
      iteration: state.iteration,
      maxIterations: state.max_iterations,
      tasksCompleted: state.execution.tasks_completed,
      tasksTotal: state.execution.tasks_total,
      toolError: toolError || undefined,
    },
  };
}

/**
 * 在会话记录中检测流水线专属信号。
 */
function detectPipelineSignal(sessionId: string, signal: string): boolean {
  const claudeDir = getClaudeConfigDir();
  const possiblePaths = [
    join(claudeDir, "sessions", sessionId, "transcript.md"),
    join(claudeDir, "sessions", sessionId, "messages.json"),
    join(claudeDir, "transcripts", `${sessionId}.md`),
  ];

  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, "i");

  for (const transcriptPath of possiblePaths) {
    if (existsSync(transcriptPath)) {
      try {
        const content = readFileSync(transcriptPath, "utf-8");
        if (pattern.test(content)) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}
