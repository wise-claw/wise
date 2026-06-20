/**
 * 任务分解器类型
 *
 * 用于分析任务并将其分解为可并行组件（含文件所有权管理）的类型定义。
 */

export type TaskType =
  | 'fullstack-app'
  | 'refactoring'
  | 'bug-fix'
  | 'feature'
  | 'testing'
  | 'documentation'
  | 'infrastructure'
  | 'migration'
  | 'optimization'
  | 'unknown';

export type ComponentRole =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'api'
  | 'ui'
  | 'shared'
  | 'testing'
  | 'docs'
  | 'config'
  | 'module';

export interface TaskAnalysis {
  /** 原始任务描述 */
  task: string;

  /** 检测到的任务类型 */
  type: TaskType;

  /** 任务复杂度评分 (0-1) */
  complexity: number;

  /** 任务是否可并行 */
  isParallelizable: boolean;

  /** 预计组件数量 */
  estimatedComponents: number;

  /** 任务中识别出的关键领域 */
  areas: string[];

  /** 提及的技术/框架 */
  technologies: string[];

  /** 提及或推断的文件模式 */
  filePatterns: string[];

  /** 领域之间的依赖关系 */
  dependencies: Array<{ from: string; to: string }>;
}

export interface Component {
  /** 组件唯一 ID */
  id: string;

  /** 组件名称 */
  name: string;

  /** 组件角色/类型 */
  role: ComponentRole;

  /** 该组件功能的描述 */
  description: string;

  /** 该组件是否可并行运行 */
  canParallelize: boolean;

  /** 该组件依赖的组件（必须先完成） */
  dependencies: string[];

  /** 预计工作量/复杂度 (0-1) */
  effort: number;

  /** 该组件使用的技术 */
  technologies: string[];
}

export interface FileOwnership {
  /** 拥有这些文件的组件 ID */
  componentId: string;

  /** 该组件独占文件的 glob 模式 */
  patterns: string[];

  /** 该组件拥有的具体文件（非 glob） */
  files: string[];

  /** 可能与其他组件重叠的文件 */
  potentialConflicts: string[];
}

export interface Subtask {
  /** 子任务唯一 ID */
  id: string;

  /** 子任务名称 */
  name: string;

  /** 该子任务实现的组件 */
  component: Component;

  /** 给工作代理的详细 prompt */
  prompt: string;

  /** 该子任务的文件所有权 */
  ownership: FileOwnership;

  /** 必须先完成的子任务 */
  blockedBy: string[];

  /** 推荐的代理类型 */
  agentType: string;

  /** 推荐的模型档位 */
  modelTier: 'low' | 'medium' | 'high';

  /** 验收标准 */
  acceptanceCriteria: string[];

  /** 验证步骤 */
  verification: string[];
}

export interface SharedFile {
  /** 文件路径或 glob 模式 */
  pattern: string;

  /** 该文件被共享的原因 */
  reason: string;

  /** 需要访问该文件的组件 */
  sharedBy: string[];

  /** 该文件是否需要协调 */
  requiresOrchestration: boolean;
}

export interface DecompositionResult {
  /** 原始任务分析 */
  analysis: TaskAnalysis;

  /** 识别出的组件 */
  components: Component[];

  /** 生成的带所有权的子任务 */
  subtasks: Subtask[];

  /** 需要协调的共享文件 */
  sharedFiles: SharedFile[];

  /** 推荐的执行顺序（按子任务 ID） */
  executionOrder: string[][];

  /** 整体策略描述 */
  strategy: string;

  /** 检测到的警告或问题 */
  warnings: string[];
}

export interface ProjectContext {
  /** 项目根目录 */
  rootDir: string;

  /** 项目类型（检测到的） */
  projectType?: string;

  /** 使用中的技术 */
  technologies?: string[];

  /** 目录结构 */
  structure?: Record<string, string[]>;

  /** 可能受影响的现有文件 */
  existingFiles?: string[];

  /** 框架约定 */
  conventions?: Record<string, any>;
}

export interface DecompositionStrategy {
  /** 策略名称 */
  name: string;

  /** 该策略适用的任务类型 */
  applicableTypes: TaskType[];

  /** 分解任务的函数 */
  decompose: (
    analysis: TaskAnalysis,
    context: ProjectContext
  ) => {
    components: Component[];
    sharedFiles: SharedFile[];
  };
}
