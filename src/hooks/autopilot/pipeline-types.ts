/**
 * 流水线类型
 *
 * 可配置流水线编排器的类型定义。
 * 该流水线将 autopilot/ultrawork/ultrapilot 统一为单个
 * 可配置序列：RALPLAN -> EXECUTION -> RALPH -> QA。
 *
 * @see https://github.com/wise-claw/wise/issues/1130
 */

// ============================================================================
// 阶段标识符
// ============================================================================

/**
 * 按执行顺序排列的流水线阶段标识符。
 * 每个阶段都是可选的，可通过配置跳过。
 */
export type PipelineStageId = "ralplan" | "execution" | "ralph" | "qa";

/** 流水线终态 */
export type PipelineTerminalState = "complete" | "failed" | "cancelled";

/** 所有可能的流水线阶段取值（阶段 + 终态） */
export type PipelinePhase = PipelineStageId | PipelineTerminalState;

/** 单个阶段的状态 */
export type StageStatus =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "skipped";

/** 规范的阶段执行顺序 */
export const STAGE_ORDER: readonly PipelineStageId[] = [
  "ralplan",
  "execution",
  "ralph",
  "qa",
] as const;

// ============================================================================
// 流水线配置
// ============================================================================

/** execution 阶段的执行后端 */
export type ExecutionBackend = "team" | "solo";

/** 校验引擎配置 */
export interface VerificationConfig {
  /** 用于校验的引擎（目前仅 'ralph'） */
  engine: "ralph";
  /** 放弃前的最大校验迭代次数 */
  maxIterations: number;
}

/**
 * 面向用户的流水线配置。
 * 存储于 `.wise-config.json` 的 `autopilot` 键下。
 *
 * 示例：
 * ```json
 * {
 *   "autopilot": {
 *     "planning": "ralplan",
 *     "execution": "team",
 *     "verification": { "engine": "ralph", "maxIterations": 100 },
 *     "qa": true
 *   }
 * }
 * ```
 */
export interface PipelineConfig {
  /** 规划阶段：'ralplan' 表示共识规划，'direct' 表示简单规划，false 表示跳过 */
  planning: "ralplan" | "direct" | false;
  /** 执行后端：'team' 表示多 worker，'solo' 表示单会话 */
  execution: ExecutionBackend;
  /** 校验配置，或 false 表示跳过 */
  verification: VerificationConfig | false;
  /** 是否运行 QA 阶段（构建/lint/测试循环） */
  qa: boolean;
}

/** 默认流水线配置（与当前 autopilot 行为一致） */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  planning: "ralplan",
  execution: "solo",
  verification: {
    engine: "ralph",
    maxIterations: 100,
  },
  qa: true,
};

// ============================================================================
// 阶段适配器
// ============================================================================

/**
 * 传递给阶段适配器的上下文，用于生成 prompt 和管理状态。
 */
export interface PipelineContext {
  /** 原始用户想法/任务描述 */
  idea: string;
  /** 工作目录 */
  directory: string;
  /** 用于状态隔离的会话 ID */
  sessionId?: string;
  /** 生成的规格说明文档路径 */
  specPath?: string;
  /** 生成的实施计划路径 */
  planPath?: string;
  /** 共享的开放问题文件路径 */
  openQuestionsPath?: string;
  /** 完整的流水线配置 */
  config: PipelineConfig;
}

/**
 * 每个阶段适配器必须实现的接口。
 * 适配器将现有模块（ralplan、team、ralph、ultraqa）
 * 封装为流水线编排器使用的统一接口。
 */
export interface PipelineStageAdapter {
  /** 阶段标识符 */
  readonly id: PipelineStageId;
  /** 供展示的人类可读阶段名称 */
  readonly name: string;
  /** Claude 发出的、用于表示阶段完成的信号字符串 */
  readonly completionSignal: string;
  /** 根据流水线配置判断该阶段是否应被跳过 */
  shouldSkip(config: PipelineConfig): boolean;
  /** 生成要注入该阶段的 prompt */
  getPrompt(context: PipelineContext): string;
  /** 可选：进入该阶段时执行初始化动作（例如启动 ralph 状态） */
  onEnter?(context: PipelineContext): void;
  /** 可选：离开该阶段时执行清理动作 */
  onExit?(context: PipelineContext): void;
}

// ============================================================================
// 流水线状态
// ============================================================================

/** 单个流水线阶段的跟踪状态 */
export interface PipelineStageState {
  /** 阶段标识符 */
  id: PipelineStageId;
  /** 当前状态 */
  status: StageStatus;
  /** 阶段开始时的 ISO 时间戳 */
  startedAt?: string;
  /** 阶段完成时的 ISO 时间戳 */
  completedAt?: string;
  /** 该阶段内的迭代次数 */
  iterations: number;
  /** 阶段失败时的错误消息 */
  error?: string;
}

/**
 * 扩展 autopilot 状态的流水线专属状态。
 * 与现有 autopilot 状态字段一同存储。
 */
export interface PipelineTracking {
  /** 本次运行使用的流水线配置 */
  pipelineConfig: PipelineConfig;
  /** 有序的阶段列表及其当前状态 */
  stages: PipelineStageState[];
  /** stages 数组中当前活跃阶段的索引 */
  currentStageIndex: number;
}

// ============================================================================
// 弃用别名
// ============================================================================

/**
 * 将弃用的模式名映射到等价的流水线配置。
 * 用于把 ultrawork/ultrapilot 调用转换为 autopilot + 配置。
 */
export const DEPRECATED_MODE_ALIASES: Record<
  string,
  { config: Partial<PipelineConfig>; message: string }
> = {
  ultrawork: {
    config: { execution: "team" },
    message:
      'ultrawork is deprecated. Use /autopilot with execution: "team" instead.',
  },
  ultrapilot: {
    config: { execution: "team" },
    message:
      'ultrapilot is deprecated. Use /autopilot with execution: "team" instead.',
  },
};
