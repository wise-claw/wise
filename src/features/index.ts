/**
 * Features 模块导出
 */

export {
  createMagicKeywordProcessor,
  detectMagicKeywords,
  builtInMagicKeywords
} from './magic-keywords.js';

export {
  createContinuationHook,
  continuationSystemPromptAddition,
  detectCompletionSignals,
  generateVerificationPrompt
} from './continuation-enforcement.js';

export {
  // 类型
  type VersionMetadata,
  type ReleaseInfo,
  type UpdateCheckResult,
  type UpdateResult,
  type SilentUpdateConfig,
  // 常量
  REPO_OWNER,
  REPO_NAME,
  GITHUB_API_URL,
  GITHUB_RAW_URL,
  CLAUDE_CONFIG_DIR,
  VERSION_FILE,
  // 函数
  getInstalledVersion,
  saveVersionMetadata,
  updateLastCheckTime,
  fetchLatestRelease,
  compareVersions,
  checkForUpdates,
  performUpdate,
  formatUpdateNotification,
  shouldCheckForUpdates,
  backgroundUpdateCheck,
  interactiveUpdate,
  // 静默自动更新
  silentAutoUpdate,
  hasPendingUpdateRestart,
  clearPendingUpdateRestart,
  getPendingUpdateVersion,
  initSilentAutoUpdate,
  // 自动升级提示
  isAutoUpgradePromptEnabled
} from './auto-update.js';

// Boulder State - 会话/计划追踪
export {
  // 类型
  type BoulderState,
  type PlanProgress,
  type PlanSummary,
  // 常量
  BOULDER_DIR,
  BOULDER_FILE,
  BOULDER_STATE_PATH,
  NOTEPAD_DIR,
  NOTEPAD_BASE_PATH,
  PLANNER_PLANS_DIR,
  PLAN_EXTENSION,
  // 函数
  getBoulderFilePath,
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  clearBoulderState,
  findPlannerPlans,
  getPlanProgress,
  getPlanName,
  createBoulderState,
  getPlanSummaries,
  hasBoulder,
  getActivePlanPath
} from './boulder-state/index.js';

// Context Injector - 多源上下文收集与注入
export {
  // 类
  ContextCollector,
  contextCollector,
  // 函数
  injectPendingContext,
  injectContextIntoText,
  createContextInjectorHook,
  // 类型
  type ContextSourceType,
  type ContextPriority,
  type ContextEntry,
  type RegisterContextOptions,
  type PendingContext,
  type MessageContext,
  type OutputPart,
  type InjectionStrategy,
  type InjectionResult
} from './context-injector/index.js';

// Background Agent - 后台任务管理
export {
  // 类
  BackgroundManager,
  ConcurrencyManager,
  // 函数
  getBackgroundManager,
  resetBackgroundManager,
  // 类型
  type BackgroundTask,
  type BackgroundTaskStatus,
  type BackgroundTaskConfig,
  type LaunchInput,
  type ResumeInput,
  type TaskProgress
} from './background-agent/index.js';

// Builtin Skills - 内置 skill 定义
export {
  // 函数
  createBuiltinSkills,
  getBuiltinSkill,
  listBuiltinSkillNames,
  // 类型
  type BuiltinSkill,
  type SkillMcpConfig,
  type SkillRegistry
} from './builtin-skills/index.js';

// Model Routing - 智能模型分层路由
export {
  // 主要函数
  routeTask,
  routeWithEscalation,
  routeAndAdaptTask,
  escalateModel,
  canEscalate,
  explainRouting,
  quickTierForAgent,
  // 信号提取
  extractLexicalSignals,
  extractStructuralSignals,
  extractContextSignals,
  extractAllSignals,
  // 评分
  calculateComplexityScore,
  calculateComplexityTier,
  scoreToTier,
  getScoreBreakdown,
  calculateConfidence,
  // 规则
  evaluateRules,
  getMatchingRules,
  createRule,
  mergeRules,
  DEFAULT_ROUTING_RULES,
  // prompt 适配
  adaptPromptForTier,
  getPromptStrategy,
  getPromptPrefix,
  getPromptSuffix,
  createDelegationPrompt,
  getTaskInstructions,
  // 常量
  TIER_MODELS,
  TIER_TO_MODEL_TYPE,
  DEFAULT_ROUTING_CONFIG,
  AGENT_CATEGORY_TIERS,
  COMPLEXITY_KEYWORDS,
  TIER_PROMPT_STRATEGIES,
  TIER_TASK_INSTRUCTIONS,
  // 类型
  type ComplexityTier,
  type ComplexitySignals,
  type LexicalSignals,
  type StructuralSignals,
  type ContextSignals,
  type RoutingDecision,
  type RoutingContext,
  type RoutingConfig,
  type RoutingRule,
  type PromptAdaptationStrategy,
} from './model-routing/index.js';

// Notepad Wisdom - 计划级经验积累
export {
  // 函数
  initPlanNotepad,
  readPlanWisdom,
  addLearning,
  addDecision,
  addIssue,
  addProblem,
  getWisdomSummary,
  // 类型
  type WisdomEntry,
  type WisdomCategory,
  type PlanWisdom
} from './notepad-wisdom/index.js';

// Delegation Categories - 语义化任务路由
export {
  // 函数
  resolveCategory,
  isValidCategory,
  getAllCategories,
  getCategoryDescription,
  getCategoryTier,
  getCategoryTemperature,
  getCategoryThinkingBudget,
  getCategoryThinkingBudgetTokens,
  getCategoryForTask,
  detectCategoryFromPrompt,
  enhancePromptWithCategory,
  // 常量
  CATEGORY_CONFIGS,
  THINKING_BUDGET_TOKENS,
  // 类型
  type DelegationCategory,
  type CategoryConfig,
  type ResolvedCategory,
  type CategoryContext,
  type ThinkingBudget
} from './delegation-categories/index.js';

// State Manager - 统一状态文件管理
export {
  // 类
  StateManager,
  createStateManager,
  // 函数
  getStatePath,
  getLegacyPaths,
  ensureStateDir,
  readState,
  writeState,
  clearState,
  migrateState,
  listStates,
  cleanupOrphanedStates,
  // 枚举/常量
  StateLocation,
  isStateLocation,
  DEFAULT_STATE_CONFIG,
  // 类型
  type StateConfig,
  type StateReadResult,
  type StateWriteResult,
  type StateClearResult,
  type StateMigrationResult,
  type StateFileInfo,
  type ListStatesOptions,
  type CleanupOptions,
  type CleanupResult,
  type StateData
} from './state-manager/index.js';


// Verification - ralph、ultrawork、autopilot 的校验协议
export {
  // 函数
  createProtocol,
  createChecklist,
  runVerification,
  checkEvidence,
  formatReport,
  validateChecklist,
  // 常量
  STANDARD_CHECKS,
  // 类型
  type VerificationProtocol,
  type VerificationCheck,
  type VerificationChecklist,
  type VerificationEvidence,
  type VerificationEvidenceType,
  type VerificationSummary,
  type ValidationResult,
  type VerificationOptions,
  type ReportOptions
} from './verification/index.js';

// Task Decomposer - 任务分解与文件归属
export {
  // 函数
  decomposeTask,
  analyzeTask,
  identifyComponents,
  generateSubtasks,
  assignFileOwnership,
  identifySharedFiles,
  // 类型
  type TaskAnalysis,
  type Component,
  type Subtask,
  type SharedFile,
  type DecompositionResult,
  type ProjectContext,
  type TaskType,
  type ComponentRole,
  type FileOwnership,
  type DecompositionStrategy
} from './task-decomposer/index.js';


// Session History Search - 本地 transcript/session 产物搜索
export {
  searchSessionHistory,
  parseSinceSpec,
  type SessionHistoryMatch,
  type SessionHistorySearchOptions,
  type SessionHistorySearchReport,
} from './session-history-search/index.js';

