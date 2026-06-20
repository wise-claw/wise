/**
 * Autopilot 类型定义
 *
 * /autopilot 命令的类型定义——从想法到可运行代码的自主执行。
 *
 * autopilot 特性编排完整的开发生命周期：
 * 1. 扩展：Analyst + Architect 将想法展开为详细需求
 * 2. 规划：Architect 创建全面的执行计划
 * 3. 执行：Ralph + Ultrawork 实现该计划
 * 4. QA：UltraQA 确保 build/lint/tests 通过
 * 5. 校验：多个专业化 architect 校验实现
 */

/**
 * 表示 autopilot 执行的当前阶段
 */
export type AutopilotPhase =
  | 'expansion'    // 需求收集与规格说明创建
  | 'planning'     // 创建详细执行计划
  | 'execution'    // 实现计划
  | 'qa'          // 质量保障测试
  | 'validation'  // 由 architect 进行最终校验
  | 'complete'    // 成功完成
  | 'failed';     // 未能完成

/**
 * build、lint 和 test 阶段的 QA 测试状态
 */
export type QAStatus = 'pending' | 'passing' | 'failing';

/**
 * 专业化 architect 执行的校验类型
 */
export type ValidationVerdictType = 'functional' | 'security' | 'quality';

/**
 * 校验检查的裁定结果
 */
export type ValidationVerdict = 'APPROVED' | 'REJECTED' | 'NEEDS_FIX';

/**
 * 单次校验检查的结果
 */
export interface ValidationResult {
  /** 执行的校验类型 */
  type: ValidationVerdictType;
  /** 校验的裁定结果 */
  verdict: ValidationVerdict;
  /** 发现的问题列表（若有） */
  issues?: string[];
}

/**
 * 扩展阶段的状态跟踪
 */
export interface AutopilotExpansion {
  /** analyst 是否已完成需求收集 */
  analyst_complete: boolean;
  /** architect 是否已完成技术设计 */
  architect_complete: boolean;
  /** 生成的规格说明文档路径 */
  spec_path: string | null;
  /** 已收集需求的摘要 */
  requirements_summary: string;
  /** 为项目确定的技术栈 */
  tech_stack: string[];
}

/**
 * 规划阶段的状态跟踪
 */
export interface AutopilotPlanning {
  /** 生成的执行计划路径 */
  plan_path: string | null;
  /** 规划期间 architect 的迭代次数 */
  architect_iterations: number;
  /** 计划是否已被批准 */
  approved: boolean;
}

/**
 * 执行阶段的状态跟踪
 */
export interface AutopilotExecution {
  /** ralph 持久化迭代的次数 */
  ralph_iterations: number;
  /** ultrawork 并行执行是否激活 */
  ultrawork_active: boolean;
  /** 计划中已完成的任务数 */
  tasks_completed: number;
  /** 计划中的总任务数 */
  tasks_total: number;
  /** 执行期间创建的文件列表 */
  files_created: string[];
  /** 执行期间修改的文件列表 */
  files_modified: string[];
  /** ralph 标记执行完成时的时间戳 */
  ralph_completed_at?: string;
}

/**
 * QA 阶段的状态跟踪
 */
export interface AutopilotQA {
  /** 已执行的 UltraQA 测试-修复循环次数 */
  ultraqa_cycles: number;
  /** 当前 build 状态 */
  build_status: QAStatus;
  /** 当前 lint 状态 */
  lint_status: QAStatus;
  /** 当前测试状态（若无测试则跳过） */
  test_status: QAStatus | 'skipped';
  /** QA 阶段完成时的时间戳 */
  qa_completed_at?: string;
}

/**
 * 校验阶段的状态跟踪
 */
export interface AutopilotValidation {
  /** 为校验派生的 architect 代理数量 */
  architects_spawned: number;
  /** 收到的校验裁定列表 */
  verdicts: ValidationResult[];
  /** 是否所有校验检查均通过 */
  all_approved: boolean;
  /** 已执行的校验轮次数 */
  validation_rounds: number;
}

/**
 * 完整的 autopilot 状态
 */
export interface AutopilotState {
  /** autopilot 当前是否激活 */
  active: boolean;
  /** 当前执行阶段 */
  phase: AutopilotPhase;
  /** 通用模式状态工具使用的向后兼容别名 */
  current_phase?: AutopilotPhase;
  /** 当前迭代序号 */
  iteration: number;
  /** 放弃前的最大迭代次数 */
  max_iterations: number;

  /** 启动 autopilot 的原始用户输入 */
  originalIdea: string;

  /** 各阶段的状态 */
  expansion: AutopilotExpansion;
  planning: AutopilotPlanning;
  execution: AutopilotExecution;
  qa: AutopilotQA;
  validation: AutopilotValidation;

  /** 指标与时间戳 */
  started_at: string;
  completed_at: string | null;
  phase_durations: Record<string, number>;
  total_agents_spawned: number;
  wisdom_entries: number;

  /** 会话绑定 */
  session_id?: string;
  /** 用于隔离的项目路径 */
  project_path?: string;
}

/**
 * autopilot 行为的配置选项
 */
export interface AutopilotConfig {
  /** 跨所有阶段的最大总迭代次数 */
  maxIterations?: number;
  /** 扩展阶段的最大迭代次数 */
  maxExpansionIterations?: number;
  /** 规划阶段的最大迭代次数 */
  maxArchitectIterations?: number;
  /** QA 测试-修复循环的最大次数 */
  maxQaCycles?: number;
  /** 放弃前的最大校验轮次数 */
  maxValidationRounds?: number;
  /** 使用的并行执行器数量 */
  parallelExecutors?: number;
  /** 扩展阶段后暂停等待用户确认 */
  pauseAfterExpansion?: boolean;
  /** 规划阶段后暂停等待用户确认 */
  pauseAfterPlanning?: boolean;
  /** 完全跳过 QA 阶段 */
  skipQa?: boolean;
  /** 完全跳过校验阶段 */
  skipValidation?: boolean;
  /** 完成时自动提交变更 */
  autoCommit?: boolean;
  /** 要执行的校验类型 */
  validationArchitects?: ValidationVerdictType[];

  /**
   * 统一编排器的流水线配置。
   * 设置后，autopilot 将使用流水线编排器，而非遗留的
   * 硬编码阶段序列。这是统一
   * autopilot/ultrawork/ultrapilot 的前进方向。
   *
   * @see https://github.com/wise-claw/wise/issues/1130
   */
  pipeline?: {
    /** 规划阶段：'ralplan' 用于共识、'direct' 用于简单场景、false 表示跳过 */
    planning?: 'ralplan' | 'direct' | false;
    /** 执行后端：'team' 多 worker、'solo' 单会话 */
    execution?: 'team' | 'solo';
    /** 校验配置，或 false 表示跳过 */
    verification?: { engine: 'ralph'; maxIterations: number } | false;
    /** 是否运行 QA 阶段 */
    qa?: boolean;
  };
}

/**
 * autopilot 完成或失败时返回的结果
 */
export interface AutopilotResult {
  /** autopilot 是否成功完成 */
  success: boolean;
  /** 到达的最终阶段 */
  phase: AutopilotPhase;
  /** 已完成工作的摘要 */
  summary: AutopilotSummary;
  /** 失败时的错误消息 */
  error?: string;
}

/**
 * autopilot 执行摘要
 */
export interface AutopilotSummary {
  /** 用户提供的原始想法 */
  originalIdea: string;
  /** 执行期间创建的文件 */
  filesCreated: string[];
  /** 执行期间修改的文件 */
  filesModified: string[];
  /** 测试的最终状态 */
  testsStatus: string;
  /** 总时长（毫秒） */
  duration: number;
  /** 派生的代理总数 */
  agentsSpawned: number;
  /** 已完成的阶段 */
  phasesCompleted: AutopilotPhase[];
}

/**
 * 阶段转换与完成的信号类型
 */
export type AutopilotSignal =
  | 'EXPANSION_COMPLETE'      // 扩展阶段结束
  | 'PLANNING_COMPLETE'       // 规划阶段结束
  | 'EXECUTION_COMPLETE'      // 执行阶段结束
  | 'QA_COMPLETE'            // QA 阶段结束
  | 'VALIDATION_COMPLETE'    // 校验阶段结束
  | 'AUTOPILOT_COMPLETE'     // 所有阶段完成
  | 'TRANSITION_TO_QA'       // 准备开始 QA
  | 'TRANSITION_TO_VALIDATION'; // 准备开始校验

/**
 * autopilot 的默认配置
 */
export const DEFAULT_CONFIG: AutopilotConfig = {
  maxIterations: 10,
  maxExpansionIterations: 2,
  maxArchitectIterations: 5,
  maxQaCycles: 5,
  maxValidationRounds: 3,
  parallelExecutors: 5,
  pauseAfterExpansion: false,
  pauseAfterPlanning: false,
  skipQa: false,
  skipValidation: false,
  autoCommit: false,
  validationArchitects: ['functional', 'security', 'quality']
};
