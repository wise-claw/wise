/**
 * Wise 钩子模块
 *
 * 本模块为 Claude Code 原生 shell 钩子系统提供 TypeScript 桥接。
 * shell 脚本调用这些 TypeScript 函数以处理复杂逻辑。
 *
 * 架构：
 * - Claude Code 在钩子事件（UserPromptSubmit、Stop 等）触发时运行 shell 脚本
 * - shell 脚本调用 Node.js 桥接进行复杂处理
 * - 桥接返回 JSON 响应，由 shell 传回 Claude Code
 */

export {
  // 关键词检测
  detectKeywordsWithType,
  extractPromptText,
  removeCodeBlocks,
  type DetectedKeyword,
  type KeywordType
} from './keyword-detector/index.js';

export {
  // Ralph 钩子（整合：loop、PRD、progress、verifier）
  // 循环
  createRalphLoopHook,
  readRalphState,
  writeRalphState,
  clearRalphState,
  clearLinkedUltraworkState,
  incrementRalphIteration,
  isUltraQAActive,
  // PRD 集成
  hasPrd,
  getPrdCompletionStatus,
  getRalphContext,
  setCurrentStory,
  enablePrdMode,
  recordStoryProgress,
  recordPattern,
  shouldCompleteByPrd,
  // PRD（结构化任务跟踪）
  readPrd,
  writePrd,
  findPrdPath,
  getPrdPath,
  getWisePrdPath,
  getPrdStatus,
  markStoryComplete,
  markStoryIncomplete,
  getStory,
  getNextStory,
  createPrd,
  createSimplePrd,
  initPrd,
  formatPrdStatus,
  formatStory,
  formatPrd,
  formatNextStoryPrompt,
  PRD_FILENAME,
  PRD_EXAMPLE_FILENAME,
  // Progress（记忆持久化）
  readProgress,
  readProgressRaw,
  parseProgress,
  findProgressPath,
  getProgressPath,
  getWiseProgressPath,
  initProgress,
  appendProgress,
  addPattern,
  getPatterns,
  getRecentLearnings,
  formatPatternsForContext,
  formatProgressForContext,
  formatLearningsForContext,
  getProgressContext,
  PROGRESS_FILENAME,
  PATTERNS_HEADER,
  ENTRY_SEPARATOR,
  // Verifier（架构师校验）
  readVerificationState,
  writeVerificationState,
  clearVerificationState,
  startVerification,
  recordArchitectFeedback,
  getArchitectVerificationPrompt,
  getArchitectRejectionContinuationPrompt,
  detectArchitectApproval,
  detectArchitectRejection,
  // 类型
  type RalphLoopState,
  type RalphLoopOptions,
  type RalphLoopHook,
  type PRD,
  type PRDStatus,
  type UserStory,
  type UserStoryInput,
  type ProgressEntry,
  type CodebasePattern,
  type ProgressLog,
  type VerificationState
} from './ralph/index.js';

export {
  // 待办延续
  createTodoContinuationHook,
  checkIncompleteTodos,
  type TodoContinuationHook
} from './todo-continuation/index.js';

export {
  // 钩子桥接（shell 脚本主入口）
  processHook,
  type HookInput,
  type HookOutput
} from './bridge.js';

export {
  // Think 模式
  createThinkModeHook,
  detectThinkKeyword,
  detectUltrathinkKeyword,
  extractPromptText as extractThinkPromptText,
  removeCodeBlocks as removeThinkCodeBlocks,
  getHighVariant,
  isAlreadyHighVariant,
  getThinkingConfig,
  getClaudeThinkingConfig,
  clearThinkModeState,
  getThinkModeState,
  isThinkModeActive,
  processThinkMode,
  shouldActivateThinkMode,
  shouldActivateUltrathink,
  THINKING_CONFIGS,
  type ThinkModeState,
  type ModelRef,
  type MessageWithModel,
  type ThinkModeInput,
  type ClaudeThinkingConfig,
  type ThinkingConfig
} from './think-mode/index.js';

export {
  // 规则注入器
  createRulesInjectorHook,
  getRulesForPath,
  findProjectRoot,
  findRuleFiles,
  parseRuleFrontmatter,
  shouldApplyRule,
  createContentHash,
  isDuplicateByRealPath,
  isDuplicateByContentHash,
  loadInjectedRules,
  saveInjectedRules,
  clearInjectedRules,
  RULES_INJECTOR_STORAGE,
  PROJECT_MARKERS,
  PROJECT_RULE_SUBDIRS,
  PROJECT_RULE_FILES,
  RULE_EXTENSIONS,
  TRACKED_TOOLS,
  type RuleMetadata,
  type RuleInfo,
  type RuleFileCandidate,
  type InjectedRulesData,
  type RuleToInject,
  type MatchResult,
  type RuleFrontmatterResult
} from './rules-injector/index.js';

export {
  // WISE 编排器
  createWiseOrchestratorHook,
  isAllowedPath,
  isWriteEditTool,
  getGitDiffStats,
  formatFileChanges,
  buildVerificationReminder,
  buildOrchestratorReminder,
  buildBoulderContinuation,
  checkBoulderContinuation,
  processOrchestratorPreTool,
  processOrchestratorPostTool,
  HOOK_NAME as WISE_ORCHESTRATOR_HOOK_NAME,
  ALLOWED_PATH_PREFIX,
  WRITE_EDIT_TOOLS,
  DIRECT_WORK_REMINDER,
  ORCHESTRATOR_DELEGATION_REQUIRED,
  BOULDER_CONTINUATION_PROMPT,
  VERIFICATION_REMINDER,
  SINGLE_TASK_DIRECTIVE,
  type ToolExecuteInput as OrchestratorToolInput,
  type ToolExecuteOutput as OrchestratorToolOutput
} from './wise-orchestrator/index.js';

export {
  // 自动斜杠命令
  createAutoSlashCommandHook,
  processSlashCommand,
  detectSlashCommand,
  extractPromptText as extractSlashPromptText,
  parseSlashCommand,
  removeCodeBlocks as removeSlashCodeBlocks,
  isExcludedCommand,
  executeSlashCommand,
  findCommand,
  discoverAllCommands,
  listAvailableCommands,
  HOOK_NAME as AUTO_SLASH_COMMAND_HOOK_NAME,
  AUTO_SLASH_COMMAND_TAG_OPEN,
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  SLASH_COMMAND_PATTERN,
  EXCLUDED_COMMANDS,
  type AutoSlashCommandHookInput,
  type AutoSlashCommandHookOutput,
  type ParsedSlashCommand,
  type AutoSlashCommandResult,
  type CommandInfo,
  type CommandMetadata,
  type CommandScope,
  type ExecuteResult
} from './auto-slash-command/index.js';

export {
  // 注释检查器
  createCommentCheckerHook,
  checkForComments,
  applyFilters as applyCommentFilters,
  BDD_KEYWORDS,
  TYPE_CHECKER_PREFIXES,
  HOOK_MESSAGE_HEADER as COMMENT_CHECKER_MESSAGE_HEADER,
  LINE_COMMENT_PATTERNS,
  EXTENSION_TO_LANGUAGE,
  type CommentInfo,
  type CommentCheckResult,
  type PendingCall as CommentPendingCall,
  type CommentCheckerConfig
} from './comment-checker/index.js';

export {
  // 统一恢复模块
  createRecoveryHook,
  handleRecovery,
  detectRecoverableError,
  // 上下文窗口上限恢复
  handleContextWindowRecovery,
  detectContextLimitError,
  detectContextLimitErrorInText,
  parseContextLimitError,
  parseTokenLimitError,
  containsTokenLimitError,
  // 编辑错误恢复
  handleEditErrorRecovery,
  detectEditError,
  detectEditErrorInOutput,
  detectEditErrorInText,
  processEditOutput,
  // 会话恢复
  handleSessionRecovery,
  detectSessionErrorType,
  isRecoverableError,
  isSessionRecoverable,
  // 存储工具
  readMessages as readRecoveryMessages,
  readParts as readRecoveryParts,
  findEmptyMessages as findRecoveryEmptyMessages,
  findMessagesWithThinkingBlocks as findRecoveryThinkingBlocks,
  findMessagesWithOrphanThinking as findRecoveryOrphanThinking,
  injectTextPart as injectRecoveryTextPart,
  prependThinkingPart as prependRecoveryThinkingPart,
  stripThinkingParts as stripRecoveryThinkingParts,
  replaceEmptyTextParts as replaceRecoveryEmptyTextParts,
  // 常量
  TOKEN_LIMIT_PATTERNS,
  TOKEN_LIMIT_KEYWORDS,
  CONTEXT_LIMIT_RECOVERY_MESSAGE,
  CONTEXT_LIMIT_SHORT_MESSAGE,
  NON_EMPTY_CONTENT_RECOVERY_MESSAGE,
  TRUNCATION_APPLIED_MESSAGE,
  RECOVERY_FAILED_MESSAGE,
  EDIT_ERROR_PATTERNS,
  EDIT_ERROR_REMINDER,
  RETRY_CONFIG,
  TRUNCATE_CONFIG,
  RECOVERY_MESSAGES,
  PLACEHOLDER_TEXT as RECOVERY_PLACEHOLDER_TEXT,
  // 类型
  type ParsedTokenLimitError,
  type RetryState,
  type TruncateState,
  type RecoveryResult,
  type RecoveryConfig,
  type RecoveryErrorType,
  type MessageData as RecoveryMessageData,
  type StoredMessageMeta as RecoveryStoredMessageMeta,
  type StoredPart as RecoveryStoredPart,
  type StoredTextPart as RecoveryStoredTextPart,
  type StoredToolPart as RecoveryStoredToolPart,
  type StoredReasoningPart as RecoveryStoredReasoningPart
} from './recovery/index.js';

export {
  // 预防性压缩
  createPreemptiveCompactionHook,
  estimateTokens,
  analyzeContextUsage,
  getSessionTokenEstimate,
  resetSessionTokenEstimate,
  clearRapidFireDebounce,
  RAPID_FIRE_DEBOUNCE_MS,
  DEFAULT_THRESHOLD as PREEMPTIVE_DEFAULT_THRESHOLD,
  CRITICAL_THRESHOLD,
  COMPACTION_COOLDOWN_MS,
  MAX_WARNINGS,
  CLAUDE_DEFAULT_CONTEXT_LIMIT,
  CHARS_PER_TOKEN,
  CONTEXT_WARNING_MESSAGE,
  CONTEXT_CRITICAL_MESSAGE,
  type ContextUsageResult,
  type PreemptiveCompactionConfig
} from './preemptive-compaction/index.js';

export {
  // 后台通知
  createBackgroundNotificationHook,
  processBackgroundNotification,
  processBackgroundNotificationHook,
  checkBackgroundNotifications,
  handleBackgroundEvent,
  HOOK_NAME as BACKGROUND_NOTIFICATION_HOOK_NAME,
  type BackgroundNotificationHookConfig,
  type BackgroundNotificationHookInput,
  type BackgroundNotificationHookOutput,
  type NotificationCheckResult
} from './background-notification/index.js';

export {
  // 目录 README / AGENTS.md 注入器
  createDirectoryReadmeInjectorHook,
  getReadmesForPath,
  loadInjectedPaths,
  saveInjectedPaths,
  clearInjectedPaths,
  README_INJECTOR_STORAGE,
  README_FILENAME,
  AGENTS_FILENAME,
  CONTEXT_FILENAMES,
  TRACKED_TOOLS as README_TRACKED_TOOLS,
  type InjectedPathsData
} from './directory-readme-injector/index.js';

export {
  // 空消息清理器
  createEmptyMessageSanitizerHook,
  sanitizeMessages,
  sanitizeMessage,
  hasTextContent,
  isToolPart,
  hasValidContent,
  PLACEHOLDER_TEXT,
  TOOL_PART_TYPES,
  HOOK_NAME as EMPTY_MESSAGE_SANITIZER_HOOK_NAME,
  DEBUG_PREFIX as EMPTY_MESSAGE_SANITIZER_DEBUG_PREFIX,
  ERROR_PATTERNS as EMPTY_MESSAGE_SANITIZER_ERROR_PATTERNS,
  type MessagePart,
  type MessageInfo,
  type MessageWithParts,
  type EmptyMessageSanitizerInput,
  type EmptyMessageSanitizerOutput,
  type EmptyMessageSanitizerConfig
} from './empty-message-sanitizer/index.js';

export {
  // Thinking Block 校验器
  createThinkingBlockValidatorHook,
  isExtendedThinkingModel,
  hasContentParts,
  startsWithThinkingBlock,
  findPreviousThinkingContent,
  prependThinkingBlock,
  validateMessage,
  validateMessages,
  getValidationStats,
  HOOK_NAME as THINKING_BLOCK_VALIDATOR_HOOK_NAME,
  CONTENT_PART_TYPES,
  THINKING_PART_TYPES,
  THINKING_MODEL_PATTERNS,
  DEFAULT_THINKING_CONTENT,
  SYNTHETIC_THINKING_ID_PREFIX,
  PREVENTED_ERROR,
  type MessagePart as ThinkingValidatorMessagePart,
  type MessageInfo as ThinkingValidatorMessageInfo,
  type MessageWithParts as ThinkingValidatorMessageWithParts,
  type MessagesTransformInput,
  type MessagesTransformOutput,
  type MessagesTransformHook,
  type ValidationResult
} from './thinking-block-validator/index.js';

export {
  // 非交互环境
  nonInteractiveEnvHook,
  isNonInteractive,
  HOOK_NAME as NON_INTERACTIVE_ENV_HOOK_NAME,
  NON_INTERACTIVE_ENV,
  SHELL_COMMAND_PATTERNS,
  type NonInteractiveEnvConfig,
  type ShellHook
} from './non-interactive-env/index.js';

export {
  // 代理使用提醒
  createAgentUsageReminderHook,
  loadAgentUsageState,
  saveAgentUsageState,
  clearAgentUsageState,
  TARGET_TOOLS,
  AGENT_TOOLS,
  REMINDER_MESSAGE,
  type AgentUsageState
} from './agent-usage-reminder/index.js';

export {
  // Ultrawork 状态（持久模式）
  activateUltrawork,
  deactivateUltrawork,
  readUltraworkState,
  writeUltraworkState,
  incrementReinforcement,
  shouldReinforceUltrawork,
  getUltraworkPersistenceMessage,
  createUltraworkStateHook,
  type UltraworkState
} from './ultrawork/index.js';

export {
  // 持久模式（统一 Stop 处理器）
  checkPersistentModes,
  createHookOutput,
  type PersistentModeResult
} from './persistent-mode/index.js';

export {
  // 插件模式（常用社区模式）
  getFormatter,
  isFormatterAvailable,
  formatFile,
  getLinter,
  lintFile,
  validateCommitMessage,
  runTypeCheck,
  runTests,
  runLint,
  runPreCommitChecks,
  getPreCommitReminderMessage,
  getAutoFormatMessage,
  type FormatConfig,
  type LintConfig,
  type CommitConfig,
  type PreCommitResult
} from './plugin-patterns/index.js';

export {
  // UltraQA 循环（QA 循环工作流）
  readUltraQAState,
  writeUltraQAState,
  clearUltraQAState,
  startUltraQA,
  recordFailure,
  completeUltraQA,
  stopUltraQA,
  cancelUltraQA,
  getGoalCommand,
  formatProgressMessage,
  type UltraQAState,
  type UltraQAGoalType,
  type UltraQAOptions,
  type UltraQAResult
} from './ultraqa/index.js';

export {
  // Notepad（抗压缩记忆）
  initNotepad,
  readNotepad,
  getPriorityContext,
  getWorkingMemory,
  getManualSection,
  setPriorityContext,
  addWorkingMemoryEntry,
  addManualEntry,
  pruneOldEntries,
  getNotepadStats,
  formatNotepadContext,
  formatFullNotepad,
  getNotepadPath,
  DEFAULT_CONFIG as NOTEPAD_DEFAULT_CONFIG,
  NOTEPAD_FILENAME,
  PRIORITY_HEADER,
  WORKING_MEMORY_HEADER,
  MANUAL_HEADER,
  type NotepadConfig,
  type NotepadStats,
  type PriorityContextResult,
  type PruneResult
} from './notepad/index.js';

export {
  // 已学技能（Learner）
  createLearnedSkillsHook,
  processMessageForSkills,
  isLearnerEnabled,
  getAllSkills,
  clearSkillSession,
  findMatchingSkills,
  loadAllSkills,
  loadSkillById,
  findSkillFiles,
  getSkillsDir,
  ensureSkillsDir,
  parseSkillFile,
  generateSkillFrontmatter,
  validateExtractionRequest,
  validateSkillMetadata,
  writeSkill,
  checkDuplicateTriggers,
  detectExtractableMoment,
  shouldPromptExtraction,
  generateExtractionPrompt,
  processResponseForDetection,
  getLastDetection,
  clearDetectionState,
  getDetectionStats,
  getPromotionCandidates,
  promoteLearning,
  listPromotableLearnings,
  loadConfig as loadLearnerConfig,
  saveConfig as saveLearnerConfig,
  getConfigValue as getLearnerConfigValue,
  setConfigValue as setLearnerConfigValue,
  // 常量
  USER_SKILLS_DIR,
  PROJECT_SKILLS_SUBDIR,
  SKILL_EXTENSION,
  FEATURE_FLAG_KEY,
  MAX_SKILL_CONTENT_LENGTH,
  MIN_QUALITY_SCORE,
  MAX_SKILLS_PER_SESSION,
  // 类型
  type SkillMetadata,
  type LearnedSkill,
  type SkillFileCandidate,
  type QualityValidation,
  type SkillExtractionRequest,
  type InjectedSkillsData,
  type HookContext as SkillHookContext,
  type DetectionResult,
  type DetectionConfig,
  type PromotionCandidate,
  type LearnerConfig,
  type WriteSkillResult,
  type SkillParseResult
} from './learner/index.js';

// Autopilot 模式
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
  getExpansionPrompt,
  getDirectPlanningPrompt,
  getExecutionPrompt,
  getQAPrompt,
  getValidationPrompt,
  getPhasePrompt,
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
  cancelAutopilot,
  clearAutopilot,
  canResumeAutopilot,
  resumeAutopilot,
  formatCancelMessage,
  STALE_STATE_MAX_AGE_MS,
  DEFAULT_CONFIG,
  type AutopilotPhase,
  type AutopilotState,
  type AutopilotConfig,
  type AutopilotResult,
  type AutopilotSummary,
  type AutopilotExpansion,
  type AutopilotPlanning,
  type AutopilotExecution,
  type AutopilotQA,
  type AutopilotValidation,
  type ValidationResult as AutopilotValidationResult,
  type ValidationVerdictType,
  type ValidationVerdict,
  type QAStatus,
  type AutopilotSignal,
  type TransitionResult,
  type ValidationCoordinatorResult,
  type CancelResult
} from './autopilot/index.js';

// 模式注册表（集中状态管理）
export {
  MODE_CONFIGS,
  getStateDir,
  ensureStateDir as ensureModeStateDir,
  getStateFilePath as getModeStateFilePath,
  getMarkerFilePath as getModeMarkerFilePath,
  getGlobalStateFilePath,
  clearModeState,
  hasModeState,
  getActiveModes,
  clearAllModeStates,
  // 来自 PR #111 的额外函数
  isModeActive,
  getActiveExclusiveMode,
  canStartMode,
  getAllModeStatuses,
  createModeMarker,
  removeModeMarker,
  readModeMarker,
  type ExecutionMode,
  type ModeConfig,
  type ModeStatus,
  type CanStartResult
} from './mode-registry/index.js';

export {
  // Setup 钩子
  ensureDirectoryStructure,
  validateConfigFiles,
  setEnvironmentVariables,
  processSetupInit,
  pruneOldStateFiles,
  cleanupOrphanedState,
  processSetupMaintenance,
  processSetup,
  type SetupInput,
  type SetupResult,
  type HookOutput as SetupHookOutput
} from './setup/index.js';

export {
  // Beads 上下文
  getBeadsInstructions,
  getBeadsContextConfig,
  registerBeadsContext,
  clearBeadsContext,
  BEADS_INSTRUCTIONS,
  BEADS_RUST_INSTRUCTIONS,
  type TaskTool,
  type BeadsContextConfig
} from './beads-context/index.js';

export {
  // 子代理跟踪钩子
  processSubagentStart,
  processSubagentStop,
  handleSubagentStart,
  handleSubagentStop,
  readTrackingState,
  writeTrackingState,
  getStateFilePath as getSubagentStateFilePath,
  getStaleAgents,
  cleanupStaleAgents,
  getActiveAgentCount,
  getAgentsByType,
  getRunningAgents,
  getTrackingStats,
  clearTrackingState,
  type SubagentInfo,
  type SubagentTrackingState,
  type SubagentStartInput,
  type SubagentStopInput,
  type HookOutput as SubagentHookOutput
} from './subagent-tracker/index.js';

export {
  // PreCompact 钩子
  processPreCompact,
  getCheckpointPath,
  exportWisdomToNotepad,
  saveModeSummary,
  createCompactCheckpoint,
  formatCompactSummary as formatPreCompactSummary,
  isCompactionInProgress,
  getCompactionQueueDepth,
  type PreCompactInput,
  type CompactCheckpoint,
  type HookOutput as PreCompactHookOutput
} from './pre-compact/index.js';

export {
  // 权限处理器钩子
  processPermissionRequest,
  handlePermissionRequest,
  isSafeCommand,
  isActiveModeRunning,
  type PermissionRequestInput,
  type HookOutput as PermissionHookOutput
} from './permission-handler/index.js';

export {
  // 会话结束钩子
  processSessionEnd,
  handleSessionEnd,
  recordSessionMetrics,
  cleanupTransientState,
  exportSessionSummary,
  type SessionEndInput,
  type SessionMetrics,
  type HookOutput as SessionEndHookOutput
} from './session-end/index.js';

export {
  // 项目记忆钩子
  registerProjectMemoryContext,
  clearProjectMemorySession,
  rescanProjectEnvironment,
  loadProjectMemory,
  saveProjectMemory,
  detectProjectEnvironment,
  formatContextSummary,
  formatFullContext,
  learnFromToolOutput,
  addCustomNote,
  processPreCompact as processProjectMemoryPreCompact,
  mapDirectoryStructure,
  updateDirectoryAccess,
  trackAccess,
  getTopHotPaths,
  decayHotPaths,
  detectDirectivesFromMessage,
  addDirective,
  formatDirectivesForContext,
  type ProjectMemory,
  type TechStack,
  type BuildInfo,
  type CodeConventions,
  type ProjectStructure,
  type LanguageDetection,
  type FrameworkDetection,
  type GitBranchPattern,
  type CustomNote,
  type DirectoryInfo,
  type HotPath,
  type UserDirective
} from './project-memory/index.js';

export {
  // Flow Tracer（代理流跟踪记录）
  recordHookFire,
  recordHookResult,
  recordKeywordDetected,
  recordSkillActivated,
  recordSkillInvoked,
  recordModeChange,
} from './subagent-tracker/flow-tracer.js';

export {
  // 代码库地图生成器（issue #804）
  generateCodebaseMap,
  buildTree,
  renderTree,
  shouldSkipEntry,
  extractPackageMetadata,
  type CodebaseMapOptions,
  type CodebaseMapResult,
} from './codebase-map.js';

export {
  // Agents Overlay - 启动上下文注入（issue #804）
  buildAgentsOverlay,
  type AgentsOverlayResult,
} from './agents-overlay.js';

export {
  // 代码简化器 Stop 钩子
  processCodeSimplifier,
  isCodeSimplifierEnabled,
  getModifiedFiles,
  readWiseConfig,
  isAlreadyTriggered,
  writeTriggerMarker,
  clearTriggerMarker,
  buildSimplifierMessage,
  TRIGGER_MARKER_FILENAME,
  type CodeSimplifierConfig,
  type CodeSimplifierHookResult,
} from './code-simplifier/index.js';
