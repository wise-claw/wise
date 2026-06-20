/**
 * 流水线编排器
 *
 * 可配置流水线的核心，将 autopilot/ultrawork/ultrapilot 统一为单一顺序工作流：RALPLAN -> EXECUTION -> RALPH -> QA。
 *
 * 每个阶段由 PipelineStageAdapter 实现，可通过 PipelineConfig 跳过。
 * 编排器负责管理状态转换、信号检测与提示词生成。
 *
 * @see https://github.com/wise-claw/wise/issues/1130
 */

import type {
  PipelineConfig,
  PipelineContext,
  PipelineStageAdapter,
  PipelineStageState,
  PipelineTracking,
  PipelinePhase,
  PipelineStageId,
  StageStatus,
} from "./pipeline-types.js";
import {
  DEFAULT_PIPELINE_CONFIG,
  STAGE_ORDER,
  DEPRECATED_MODE_ALIASES,
} from "./pipeline-types.js";
import { ALL_ADAPTERS, getAdapterById } from "./adapters/index.js";
import {
  readAutopilotState,
  writeAutopilotState,
  initAutopilot,
} from "./state.js";
import type { AutopilotState, AutopilotConfig } from "./types.js";
import {
  resolveAutopilotPlanPath,
  resolveOpenQuestionsPlanPath,
} from "../../config/plan-output.js";

// ============================================================================
// 配置
// ============================================================================

/**
 * 根据用户提供的部分配置解析出 PipelineConfig，并与默认值合并。
 *
 * 同时处理已弃用的模式别名：若用户调用 'ultrawork' 或 'ultrapilot'，
 * 则应用对应的配置覆盖。
 */
export function resolvePipelineConfig(
  userConfig?: Partial<PipelineConfig>,
  deprecatedMode?: string,
): PipelineConfig {
  let config = { ...DEFAULT_PIPELINE_CONFIG };

  // 应用已弃用模式别名的覆盖配置
  if (deprecatedMode && deprecatedMode in DEPRECATED_MODE_ALIASES) {
    const alias = DEPRECATED_MODE_ALIASES[deprecatedMode];
    config = { ...config, ...alias.config };
  }

  // 应用用户覆盖配置
  if (userConfig) {
    if (userConfig.planning !== undefined)
      config.planning = userConfig.planning;
    if (userConfig.execution !== undefined)
      config.execution = userConfig.execution;
    if (userConfig.verification !== undefined)
      config.verification = userConfig.verification;
    if (userConfig.qa !== undefined) config.qa = userConfig.qa;
  }

  return config;
}

/**
 * 检查调用是否来自已弃用的模式，并返回弃用警告。
 */
export function getDeprecationWarning(mode: string): string | null {
  if (mode in DEPRECATED_MODE_ALIASES) {
    return DEPRECATED_MODE_ALIASES[mode].message;
  }
  return null;
}

// ============================================================================
// 流水线状态管理
// ============================================================================

/**
 * 根据解析后的配置构建初始流水线跟踪状态。
 * 为所有阶段创建条目，被跳过的阶段标记为 'skipped'。
 */
export function buildPipelineTracking(
  config: PipelineConfig,
): PipelineTracking {
  const _adapters = getActiveAdapters(config);
  const stages: PipelineStageState[] = STAGE_ORDER.map((stageId) => {
    const adapter = getAdapterById(stageId);
    const isActive = adapter && !adapter.shouldSkip(config);
    return {
      id: stageId,
      status: isActive
        ? ("pending" as StageStatus)
        : ("skipped" as StageStatus),
      iterations: 0,
    };
  });

  // 查找第一个未跳过的阶段
  const firstActiveIndex = stages.findIndex((s) => s.status !== "skipped");

  return {
    pipelineConfig: config,
    stages,
    currentStageIndex: firstActiveIndex >= 0 ? firstActiveIndex : 0,
  };
}

/**
 * 获取指定配置下已激活（未跳过）适配器的有序列表。
 */
export function getActiveAdapters(
  config: PipelineConfig,
): PipelineStageAdapter[] {
  return ALL_ADAPTERS.filter((adapter) => !adapter.shouldSkip(config));
}

/**
 * 从 autopilot 状态读取流水线跟踪信息。
 * 若状态中不含流水线跟踪信息则返回 null。
 */
export function readPipelineTracking(
  state: AutopilotState,
): PipelineTracking | null {
  const extended = state as AutopilotState & { pipeline?: PipelineTracking };
  return extended.pipeline ?? null;
}

/**
 * 将流水线跟踪信息写入 autopilot 状态并持久化到磁盘。
 */
export function writePipelineTracking(
  directory: string,
  tracking: PipelineTracking,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  (state as AutopilotState & { pipeline: PipelineTracking }).pipeline =
    tracking;
  return writeAutopilotState(directory, state, sessionId);
}

// ============================================================================
// 流水线初始化
// ============================================================================

/**
 * 初始化一个新的基于流水线的 autopilot 会话。
 *
 * 这是统一入口，取代了原先 autopilot、ultrawork 和 ultrapilot 各自单独的 initAutopilot 调用。
 *
 * @param directory - 工作目录
 * @param idea - 用户最初的想法/任务
 * @param sessionId - 用于状态隔离的会话 ID
 * @param autopilotConfig - 标准 autopilot 配置覆盖
 * @param pipelineConfig - 流水线专用配置
 * @param deprecatedMode - 若通过已弃用的模式名调用（ultrawork/ultrapilot）
 * @returns 初始化后的 autopilot 状态，若启动被阻止则返回 null
 */
export function initPipeline(
  directory: string,
  idea: string,
  sessionId?: string,
  autopilotConfig?: Partial<AutopilotConfig>,
  pipelineConfig?: Partial<PipelineConfig>,
  deprecatedMode?: string,
): AutopilotState | null {
  // 解析流水线配置
  const resolvedConfig = resolvePipelineConfig(pipelineConfig, deprecatedMode);

  // 初始化基础 autopilot 状态
  const state = initAutopilot(directory, idea, sessionId, autopilotConfig);
  if (!state) return null;

  // 构建并附加流水线跟踪信息
  const tracking = buildPipelineTracking(resolvedConfig);

  // 将第一个激活阶段标记为 active
  if (
    tracking.currentStageIndex >= 0 &&
    tracking.currentStageIndex < tracking.stages.length
  ) {
    tracking.stages[tracking.currentStageIndex].status = "active";
    tracking.stages[tracking.currentStageIndex].startedAt =
      new Date().toISOString();
  }

  // 将流水线跟踪信息与 autopilot 状态一同持久化
  (state as AutopilotState & { pipeline: PipelineTracking }).pipeline =
    tracking;
  writeAutopilotState(directory, state, sessionId);

  return state;
}

// ============================================================================
// 阶段转换
// ============================================================================

/**
 * 获取当前流水线阶段的适配器。
 * 若流水线处于终止状态或所有阶段都已完成则返回 null。
 */
export function getCurrentStageAdapter(
  tracking: PipelineTracking,
): PipelineStageAdapter | null {
  const { stages, currentStageIndex } = tracking;

  if (currentStageIndex < 0 || currentStageIndex >= stages.length) {
    return null;
  }

  const currentStage = stages[currentStageIndex];
  if (currentStage.status === "skipped" || currentStage.status === "complete") {
    // 查找下一个激活阶段
    return getNextStageAdapter(tracking);
  }

  return getAdapterById(currentStage.id) ?? null;
}

/**
 * 获取当前阶段之后下一个未跳过阶段的适配器。
 * 若没有剩余阶段则返回 null。
 */
export function getNextStageAdapter(
  tracking: PipelineTracking,
): PipelineStageAdapter | null {
  const { stages, currentStageIndex } = tracking;

  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    if (stages[i].status !== "skipped") {
      return getAdapterById(stages[i].id) ?? null;
    }
  }

  return null;
}

/**
 * 将流水线推进到下一阶段。
 *
 * 将当前阶段标记为完成，查找下一个未跳过的阶段并将其标记为 active。
 * 返回新的当前阶段适配器，若流水线已完成则返回 null。
 */
export function advanceStage(
  directory: string,
  sessionId?: string,
): { adapter: PipelineStageAdapter | null; phase: PipelinePhase } {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return { adapter: null, phase: "failed" };

  const tracking = readPipelineTracking(state);
  if (!tracking) return { adapter: null, phase: "failed" };

  const { stages, currentStageIndex } = tracking;

  // 将当前阶段标记为完成
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentStage = stages[currentStageIndex];
    currentStage.status = "complete";
    currentStage.completedAt = new Date().toISOString();

    // 若适配器支持则调用 onExit
    const currentAdapter = getAdapterById(currentStage.id);
    if (currentAdapter?.onExit) {
      const context = buildContext(state, tracking);
      currentAdapter.onExit(context);
    }
  }

  // 查找下一个未跳过的阶段
  let nextIndex = -1;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    if (stages[i].status !== "skipped") {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    // 所有阶段完成——流水线结束
    tracking.currentStageIndex = stages.length;
    writePipelineTracking(directory, tracking, sessionId);
    return { adapter: null, phase: "complete" };
  }

  // 激活下一阶段
  tracking.currentStageIndex = nextIndex;
  stages[nextIndex].status = "active";
  stages[nextIndex].startedAt = new Date().toISOString();
  writePipelineTracking(directory, tracking, sessionId);

  // 若适配器支持则调用 onEnter
  const nextAdapter = getAdapterById(stages[nextIndex].id)!;
  if (nextAdapter.onEnter) {
    const context = buildContext(state, tracking);
    nextAdapter.onEnter(context);
  }

  return { adapter: nextAdapter, phase: stages[nextIndex].id };
}

/**
 * 将当前阶段标记为失败，并将流水线标记为失败。
 */
export function failCurrentStage(
  directory: string,
  error: string,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  const tracking = readPipelineTracking(state);
  if (!tracking) return false;

  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    stages[currentStageIndex].status = "failed";
    stages[currentStageIndex].error = error;
  }

  return writePipelineTracking(directory, tracking, sessionId);
}

/**
 * 递增当前阶段的迭代计数器。
 */
export function incrementStageIteration(
  directory: string,
  sessionId?: string,
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return false;

  const tracking = readPipelineTracking(state);
  if (!tracking) return false;

  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    stages[currentStageIndex].iterations++;
  }

  return writePipelineTracking(directory, tracking, sessionId);
}

// ============================================================================
// 流水线信号检测
// ============================================================================

/**
 * 获取当前流水线阶段期望的完成信号。
 */
export function getCurrentCompletionSignal(
  tracking: PipelineTracking,
): string | null {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex < 0 || currentStageIndex >= stages.length) return null;

  const adapter = getAdapterById(stages[currentStageIndex].id);
  return adapter?.completionSignal ?? null;
}

/**
 * 从所有流水线完成信号到其阶段 ID 的映射。
 */
export function getSignalToStageMap(): Map<string, PipelineStageId> {
  const map = new Map<string, PipelineStageId>();
  for (const adapter of ALL_ADAPTERS) {
    map.set(adapter.completionSignal, adapter.id);
  }
  return map;
}

// ============================================================================
// 提示词生成
// ============================================================================

/**
 * 生成当前流水线阶段的延续提示词。
 * 这是强制执行钩子所消费的主要输出。
 */
export function generatePipelinePrompt(
  directory: string,
  sessionId?: string,
): string | null {
  const state = readAutopilotState(directory, sessionId);
  if (!state) return null;

  const tracking = readPipelineTracking(state);
  if (!tracking) return null;

  const adapter = getCurrentStageAdapter(tracking);
  if (!adapter) return null;

  const context = buildContext(state, tracking);
  return adapter.getPrompt(context);
}

/**
 * 在阶段之间推进时生成阶段转换提示词。
 */
export function generateTransitionPrompt(
  fromStage: PipelineStageId,
  toStage: PipelineStageId | "complete",
): string {
  if (toStage === "complete") {
    return `## PIPELINE COMPLETE

All pipeline stages have completed successfully!

Signal: AUTOPILOT_COMPLETE
`;
  }

  const toAdapter = getAdapterById(toStage);
  const toName = toAdapter?.name ?? toStage;

  return `## PIPELINE STAGE TRANSITION: ${fromStage.toUpperCase()} -> ${toStage.toUpperCase()}

The ${fromStage} stage is complete. Transitioning to: **${toName}**

`;
}

// ============================================================================
// 流水线状态与检查
// ============================================================================

/**
 * 获取流水线当前状态的概要，用于展示。
 */
export function getPipelineStatus(tracking: PipelineTracking): {
  currentStage: PipelineStageId | null;
  completedStages: PipelineStageId[];
  pendingStages: PipelineStageId[];
  skippedStages: PipelineStageId[];
  isComplete: boolean;
  progress: string;
} {
  const completed: PipelineStageId[] = [];
  const pending: PipelineStageId[] = [];
  const skipped: PipelineStageId[] = [];
  let current: PipelineStageId | null = null;

  for (const stage of tracking.stages) {
    switch (stage.status) {
      case "complete":
        completed.push(stage.id);
        break;
      case "active":
        current = stage.id;
        break;
      case "pending":
        pending.push(stage.id);
        break;
      case "skipped":
        skipped.push(stage.id);
        break;
    }
  }

  const activeStages = tracking.stages.filter((s) => s.status !== "skipped");
  const completedCount = completed.length;
  const totalActive = activeStages.length;
  const isComplete = current === null && pending.length === 0;
  const progress = `${completedCount}/${totalActive} stages`;

  return {
    currentStage: current,
    completedStages: completed,
    pendingStages: pending,
    skippedStages: skipped,
    isComplete,
    progress,
  };
}

/**
 * 将流水线状态格式化为 HUD 显示内容。
 */
export function formatPipelineHUD(tracking: PipelineTracking): string {
  const status = getPipelineStatus(tracking);
  const parts: string[] = [];

  for (const stage of tracking.stages) {
    const adapter = getAdapterById(stage.id);
    const name = adapter?.name ?? stage.id;
    switch (stage.status) {
      case "complete":
        parts.push(`[OK] ${name}`);
        break;
      case "active":
        parts.push(`[>>] ${name} (iter ${stage.iterations})`);
        break;
      case "pending":
        parts.push(`[..] ${name}`);
        break;
      case "skipped":
        parts.push(`[--] ${name}`);
        break;
      case "failed":
        parts.push(`[!!] ${name}`);
        break;
    }
  }

  return `Pipeline ${status.progress}: ${parts.join(" | ")}`;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从 autopilot 状态与流水线跟踪信息构建 PipelineContext。
 */
function buildContext(
  state: AutopilotState,
  tracking: PipelineTracking,
): PipelineContext {
  return {
    idea: state.originalIdea,
    directory: state.project_path || process.cwd(),
    sessionId: state.session_id,
    specPath: state.expansion.spec_path || ".wise/autopilot/spec.md",
    planPath: state.planning.plan_path || resolveAutopilotPlanPath(),
    openQuestionsPath: resolveOpenQuestionsPlanPath(),
    config: tracking.pipelineConfig,
  };
}

/**
 * 检查某个状态是否包含流水线跟踪信息（即是否通过新流水线初始化）。
 */
export function hasPipelineTracking(state: AutopilotState): boolean {
  return readPipelineTracking(state) !== null;
}
