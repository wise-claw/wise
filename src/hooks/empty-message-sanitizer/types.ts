/**
 * 空消息清理器类型
 *
 * 空消息清理器钩子的类型定义。
 * 此钩子通过确保所有消息包含有效内容来防止 API 错误。
 *
 * 改编自 oh-my-opencode 的 empty-message-sanitizer 钩子。
 */

/**
 * Claude Code 消息格式中的一个消息 part
 */
export interface MessagePart {
  /** 此 part 的唯一标识符 */
  id?: string;
  /** 此 part 所属的消息 ID */
  messageID?: string;
  /** 此 part 所属的会话 ID */
  sessionID?: string;
  /** Part 类型（text、tool、tool_use、tool_result 等） */
  type: string;
  /** 文本内容（用于文本 parts） */
  text?: string;
  /** 是否为合成注入的内容 */
  synthetic?: boolean;
  /** 附加属性 */
  [key: string]: unknown;
}

/**
 * 消息信息元数据
 */
export interface MessageInfo {
  /** 消息标识符 */
  id: string;
  /** 消息角色（user、assistant） */
  role: 'user' | 'assistant';
  /** 会话 ID */
  sessionID?: string;
  /** 附加属性 */
  [key: string]: unknown;
}

/**
 * 带 parts 的消息
 */
export interface MessageWithParts {
  /** 消息元数据 */
  info: MessageInfo;
  /** 消息内容 parts */
  parts: MessagePart[];
}

/**
 * 空消息清理器钩子的输入
 */
export interface EmptyMessageSanitizerInput {
  /** 待清理的消息列表 */
  messages: MessageWithParts[];
  /** 会话标识符 */
  sessionId?: string;
}

/**
 * 空消息清理器钩子的输出
 */
export interface EmptyMessageSanitizerOutput {
  /** 已清理的消息 */
  messages: MessageWithParts[];
  /** 已清理的消息数量 */
  sanitizedCount: number;
  /** 是否发生了任何清理 */
  modified: boolean;
}

/**
 * 钩子配置
 */
export interface EmptyMessageSanitizerConfig {
  /** 自定义占位文本（默认："[user interrupted]"） */
  placeholderText?: string;
  /** 启用调试日志 */
  debug?: boolean;
}
