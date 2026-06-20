/**
 * 验证类型
 *
 * ralph、ultrawork 和 autopilot 共用的验证协议通用类型
 */

/**
 * 验证证据类型
 */
export type VerificationEvidenceType =
  | 'build_success'
  | 'test_pass'
  | 'lint_clean'
  | 'functionality_verified'
  | 'architect_approval'
  | 'todo_complete'
  | 'error_free';

/**
 * 特定检查的验证证据
 */
export interface VerificationEvidence {
  /** 证据类型 */
  type: VerificationEvidenceType;
  /** 检查是否通过 */
  passed: boolean;
  /** 用于验证的执行命令（如适用） */
  command?: string;
  /** 验证命令的输出 */
  output?: string;
  /** 检查失败时的错误信息 */
  error?: string;
  /** 证据采集时间戳 */
  timestamp: Date;
  /** 额外的元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 单个验证检查需求
 */
export interface VerificationCheck {
  /** 该检查的唯一标识 */
  id: string;
  /** 人类可读的名称 */
  name: string;
  /** 该检查所验证内容的描述 */
  description: string;
  /** 该检查产生的证据类型 */
  evidenceType: VerificationEvidenceType;
  /** 该检查是否为完成所必需 */
  required: boolean;
  /** 用于验证的执行命令（如适用） */
  command?: string;
  /** 该检查是否已完成 */
  completed: boolean;
  /** 为该检查采集的证据 */
  evidence?: VerificationEvidence;
}

/**
 * 完整的验证协议定义
 */
export interface VerificationProtocol {
  /** 协议名称（如 "ralph"、"autopilot"、"ultrawork"） */
  name: string;
  /** 该协议所验证内容的描述 */
  description: string;
  /** 要执行的验证检查列表 */
  checks: VerificationCheck[];
  /** 是否所有必需检查都必须通过 */
  strictMode: boolean;
  /** 可选的自定义校验函数 */
  customValidator?: (checklist: VerificationChecklist) => Promise<ValidationResult>;
}

/**
 * 验证检查的当前状态
 */
export interface VerificationChecklist {
  /** 正在遵循的协议 */
  protocol: VerificationProtocol;
  /** 验证开始的时间戳 */
  startedAt: Date;
  /** 验证完成的时间戳（若已完成） */
  completedAt?: Date;
  /** 所有检查及其当前状态 */
  checks: VerificationCheck[];
  /** 整体完成状态 */
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
  /** 结果摘要 */
  summary?: VerificationSummary;
}

/**
 * 验证结果摘要
 */
export interface VerificationSummary {
  /** 检查总数 */
  total: number;
  /** 通过的检查数 */
  passed: number;
  /** 失败的检查数 */
  failed: number;
  /** 跳过的检查数（非必需） */
  skipped: number;
  /** 是否所有必需检查都通过 */
  allRequiredPassed: boolean;
  /** 失败检查的 ID 列表 */
  failedChecks: string[];
  /** 整体结论 */
  verdict: 'approved' | 'rejected' | 'incomplete';
}

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 校验是否通过 */
  valid: boolean;
  /** 校验信息 */
  message: string;
  /** 发现的问题列表 */
  issues: string[];
  /** 修复问题的建议 */
  recommendations?: string[];
}

/**
 * 运行验证的选项
 */
export interface VerificationOptions {
  /** 是否并行执行检查 */
  parallel?: boolean;
  /** 每个检查的超时时间（毫秒） */
  timeout?: number;
  /** 是否在首次失败时停止 */
  failFast?: boolean;
  /** 是否跳过非必需检查 */
  skipOptional?: boolean;
  /** 自定义工作目录 */
  cwd?: string;
}

/**
 * 报告格式选项
 */
export interface ReportOptions {
  /** 报告中是否包含详细证据 */
  includeEvidence?: boolean;
  /** 报告中是否包含命令输出 */
  includeOutput?: boolean;
  /** 报告格式 */
  format?: 'text' | 'markdown' | 'json';
  /** 是否对输出着色（用于终端） */
  colorize?: boolean;
}
