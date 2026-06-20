/**
 * Autopilot 钩子模块
 *
 * /autopilot 命令的主入口——从想法到可运行代码的自主执行。
 */

// 类型
export type {
  AutopilotPhase,
  AutopilotState,
  AutopilotConfig,
  AutopilotResult,
  AutopilotSummary,
  AutopilotExpansion,
  AutopilotPlanning,
  AutopilotExecution,
  AutopilotQA,
  AutopilotValidation,
  ValidationResult,
  ValidationVerdictType,
  ValidationVerdict,
  QAStatus,
  AutopilotSignal
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';

// 状态管理与阶段切换
export {
  readAutopilotState,
  writeAutopilotState,
  clearAutopilotState,
  isAutopilotActive,
  getAutopilotStateAge,
  initAutopilot,
  transitionPhase,
  incrementAgentCount,
  updateExpansion,
  updatePlanning,
  updateExecution,
  updateQA,
  updateValidation,
  ensureAutopilotDir,
  getSpecPath,
  getPlanPath,
  transitionRalphToUltraQA,
  transitionUltraQAToValidation,
  transitionToComplete,
  transitionToFailed,
  getTransitionPrompt,
  type TransitionResult
} from './state.js';

// prompt 生成
export {
  getExpansionPrompt,
  getDirectPlanningPrompt,
  getExecutionPrompt,
  getQAPrompt,
  getValidationPrompt,
  getPhasePrompt
} from './prompts.js';

// 校验协调与摘要生成
export {
  recordValidationVerdict,
  getValidationStatus,
  startValidationRound,
  shouldRetryValidation,
  getIssuesToFix,
  getValidationSpawnPrompt,
  formatValidationResults,
  generateSummary,
  formatSummary,
  formatCompactSummary,
  formatFailureSummary,
  formatFileList,
  type ValidationCoordinatorResult
} from './validation.js';

// 取消
export {
  cancelAutopilot,
  clearAutopilot,
  canResumeAutopilot,
  resumeAutopilot,
  formatCancelMessage,
  STALE_STATE_MAX_AGE_MS,
  type CancelResult
} from './cancel.js';

// 信号检测与强制执行
export {
  detectSignal,
  getExpectedSignalForPhase,
  detectAnySignal,
  checkAutopilot,
  type AutopilotEnforcementResult
} from './enforcement.js';

// 流水线类型
export type {
  PipelineStageId,
  PipelineTerminalState,
  PipelinePhase,
  StageStatus,
  ExecutionBackend,
  VerificationConfig,
  PipelineConfig,
  PipelineContext,
  PipelineStageAdapter,
  PipelineStageState,
  PipelineTracking,
} from './pipeline-types.js';

export {
  DEFAULT_PIPELINE_CONFIG,
  STAGE_ORDER,
  DEPRECATED_MODE_ALIASES,
} from './pipeline-types.js';

// 流水线编排器
export {
  resolvePipelineConfig,
  getDeprecationWarning,
  buildPipelineTracking,
  getActiveAdapters,
  readPipelineTracking,
  writePipelineTracking,
  initPipeline,
  getCurrentStageAdapter,
  getNextStageAdapter,
  advanceStage,
  failCurrentStage,
  incrementStageIteration,
  getCurrentCompletionSignal,
  getSignalToStageMap,
  generatePipelinePrompt,
  generateTransitionPrompt,
  getPipelineStatus,
  formatPipelineHUD,
  hasPipelineTracking,
} from './pipeline.js';

// 阶段适配器
export {
  ALL_ADAPTERS,
  getAdapterById,
  ralplanAdapter,
  executionAdapter,
  ralphAdapter,
  qaAdapter,
  RALPLAN_COMPLETION_SIGNAL,
  EXECUTION_COMPLETION_SIGNAL,
  RALPH_COMPLETION_SIGNAL,
  QA_COMPLETION_SIGNAL,
} from './adapters/index.js';
