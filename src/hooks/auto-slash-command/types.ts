import type { SkillPipelineMetadata } from '../../utils/skill-pipeline.js';

/**
 * 自动斜杠命令类型
 *
 * 斜杠命令检测与执行的类型定义。
 *
 * 改编自 oh-my-opencode 的 auto-slash-command 钩子。
 */

/**
 * 自动斜杠命令钩子的输入
 */
export interface AutoSlashCommandHookInput {
  sessionId?: string;
  messageId?: string;
  agent?: string;
}

/**
 * 自动斜杠命令钩子的输出
 */
export interface AutoSlashCommandHookOutput {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * 从用户输入中解析出的斜杠命令
 */
export interface ParsedSlashCommand {
  /** 不含前导斜杠的命令名 */
  command: string;
  /** 传递给命令的参数 */
  args: string;
  /** 原始匹配文本 */
  raw: string;
}

/**
 * 自动斜杠命令检测结果
 */
export interface AutoSlashCommandResult {
  detected: boolean;
  parsedCommand?: ParsedSlashCommand;
  injectedMessage?: string;
}

/**
 * 命令作用域，指示命令的发现来源
 */
export type CommandScope = 'user' | 'project' | 'skill';

/**
 * 来自 frontmatter 的命令元数据
 */
export interface CommandMetadata {
  name: string;
  description: string;
  argumentHint?: string;
  model?: string;
  agent?: string;
  pipeline?: SkillPipelineMetadata;
  aliases?: string[];
  aliasOf?: string;
  deprecatedAlias?: boolean;
  deprecationMessage?: string;
}

/**
 * 已发现的命令信息
 */
export interface CommandInfo {
  name: string;
  path?: string;
  metadata: CommandMetadata;
  content?: string;
  scope: CommandScope;
}

/**
 * 斜杠命令执行结果
 */
export interface ExecuteResult {
  success: boolean;
  replacementText?: string;
  error?: string;
}
