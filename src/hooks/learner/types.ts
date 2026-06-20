/**
 * 已学习技能类型
 *
 * 技能文件与元数据的类型定义。
 * 遵循 rules-injector/types.ts 中的模式
 */

/**
 * 来自 YAML frontmatter 的技能元数据。
 */
export interface SkillMetadata {
  /** 技能的唯一标识符 */
  id: string;
  /** 人类可读的名称 */
  name: string;
  /** 描述此技能的作用 */
  description: string;
  /** 触发技能注入的关键词 */
  triggers: string[];
  /** 技能创建时间 */
  createdAt: string;
  /** 来源：'extracted' | 'promoted' | 'manual' */
  source: 'extracted' | 'promoted' | 'manual';
  /** 若为抽取所得，则为原始会话 ID */
  sessionId?: string;
  /** 质量评分（0-100） */
  quality?: number;
  /** 成功应用的次数 */
  usageCount?: number;
  /** 用于分类的标签 */
  tags?: string[];
  /** 技能注入的触发匹配策略 */
  matching?: 'exact' | 'fuzzy';
  /** 技能执行的首选 model 提示 */
  model?: string;
  /** 技能执行的首选 agent 提示 */
  agent?: string;
}

/**
 * 解析后的技能文件及其内容。
 */
export interface LearnedSkill {
  /** 技能文件的绝对路径 */
  path: string;
  /** 相对于 skills 目录的路径 */
  relativePath: string;
  /** 是否来自用户目录（~/.wise/skills 或 ~/.claude/skills/wise-learned）或项目目录（.wise/skills） */
  scope: 'user' | 'project';
  /** 已解析的 frontmatter 元数据 */
  metadata: SkillMetadata;
  /** 技能内容（实际指令） */
  content: string;
  /** 用于去重的 SHA-256 哈希 */
  contentHash: string;
  /** 优先级：project > user */
  priority: number;
}

/**
 * 发现阶段中的技能文件候选项。
 */
export interface SkillFileCandidate {
  /** 技能文件路径 */
  path: string;
  /** 解析符号链接后的真实路径 */
  realPath: string;
  /** 作用域：user 或 project */
  scope: 'user' | 'project';
  /** 发现该技能所在的根目录（用于精确计算相对路径） */
  sourceDir: string;
}

/**
 * 质量门校验结果。
 */
export interface QualityValidation {
  /** 技能是否通过质量门 */
  valid: boolean;
  /** 缺失的必填字段 */
  missingFields: string[];
  /** 警告（非阻断） */
  warnings: string[];
  /** 质量评分（0-100） */
  score: number;
}

/**
 * 技能抽取请求。
 */
export interface SkillExtractionRequest {
  /** 待解决的问题 */
  problem: string;
  /** 解决方案/方法 */
  solution: string;
  /** 触发关键词 */
  triggers: string[];
  /** 可选标签 */
  tags?: string[];
  /** 目标作用域：user 或 project */
  targetScope: 'user' | 'project';
}

/**
 * 用于跟踪已注入技能的会话存储。
 */
export interface InjectedSkillsData {
  /** 会话 ID */
  sessionId: string;
  /** 已注入技能的内容哈希 */
  injectedHashes: string[];
  /** 最近一次更新的时间戳 */
  updatedAt: number;
}

/**
 * 传递给技能处理的钩子上下文。
 */
export interface HookContext {
  sessionId: string;
  directory: string;
  prompt?: string;
}
