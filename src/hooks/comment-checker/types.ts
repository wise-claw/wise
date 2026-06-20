/**
 * 注释检查器类型
 *
 * 代码变更中注释检测的类型定义。
 *
 * 改编自 oh-my-opencode 的 comment-checker 钩子。
 */

/**
 * 检测到的注释类型
 */
export type CommentType = 'line' | 'block' | 'docstring';

/**
 * 检测到的注释信息
 */
export interface CommentInfo {
  /** 注释文本内容 */
  text: string;
  /** 注释所在行号 */
  lineNumber: number;
  /** 包含该注释的文件路径 */
  filePath: string;
  /** 注释类型 */
  commentType: CommentType;
  /** 是否为文档字符串 */
  isDocstring: boolean;
  /** 附加元数据 */
  metadata?: Record<string, string>;
}

/**
 * 注释检查的待处理工具调用
 */
export interface PendingCall {
  /** 正在修改的文件路径 */
  filePath: string;
  /** 新文件内容（用于 Write 工具） */
  content?: string;
  /** 被替换的旧字符串（用于 Edit 工具） */
  oldString?: string;
  /** 替换的新字符串（用于 Edit 工具） */
  newString?: string;
  /** 多个编辑（用于 MultiEdit 工具） */
  edits?: Array<{ old_string: string; new_string: string }>;
  /** 触发此次检查的工具 */
  tool: 'write' | 'edit' | 'multiedit';
  /** 会话 ID */
  sessionId: string;
  /** 调用时间戳 */
  timestamp: number;
}

/**
 * 文件中找到的注释
 */
export interface FileComments {
  /** 文件路径 */
  filePath: string;
  /** 找到的注释列表 */
  comments: CommentInfo[];
}

/**
 * 注释过滤器结果
 */
export interface FilterResult {
  /** 是否跳过该注释 */
  shouldSkip: boolean;
  /** 跳过原因 */
  reason?: string;
}

/**
 * 注释过滤器的函数类型
 */
export type CommentFilter = (comment: CommentInfo) => FilterResult;

/**
 * 注释检查结果
 */
export interface CommentCheckResult {
  /** 是否检测到注释 */
  hasComments: boolean;
  /** 找到的注释数量 */
  count: number;
  /** 检测到注释时注入的消息 */
  message?: string;
  /** 详细的注释信息 */
  comments: CommentInfo[];
}
