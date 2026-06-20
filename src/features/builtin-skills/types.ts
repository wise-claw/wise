/**
 * 内建技能类型定义
 *
 * 内建技能系统的类型定义。
 *
 * 改编自 oh-my-opencode 的 builtin-skills 特性。
 */

import type { SkillPipelineMetadata } from '../../utils/skill-pipeline.js';

/**
 * 技能与 MCP server 集成的配置
 */
export interface SkillMcpConfig {
  [serverName: string]: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

/**
 * 内建技能定义
 */
export interface BuiltinSkill {
  /** 技能的唯一名称 */
  name: string;
  /** 规范技能条目可用的别名 */
  aliases?: string[];
  /** 当本条目为别名时，对应的规范技能名称 */
  aliasOf?: string;
  /** 本条目是否为已弃用的兼容别名 */
  deprecatedAlias?: boolean;
  /** 人类可读的弃用说明 */
  deprecationMessage?: string;
  /** 技能的简短描述 */
  description: string;
  /** 技能的完整模板内容 */
  template: string;
  /** 许可证信息（可选） */
  license?: string;
  /** 兼容性说明（可选） */
  compatibility?: string;
  /** 额外元数据（可选） */
  metadata?: Record<string, unknown>;
  /** 本技能允许使用的工具（可选） */
  allowedTools?: string[];
  /** 配合本技能使用的 agent（可选） */
  agent?: string;
  /** 配合本技能使用的 model（可选） */
  model?: string;
  /** 是否为子任务技能（可选） */
  subtask?: boolean;
  /** 参数提示（可选） */
  argumentHint?: string;
  /** 可选的技能到技能流水线元数据 */
  pipeline?: SkillPipelineMetadata;
  /** MCP server 配置（可选） */
  mcpConfig?: SkillMcpConfig;
}

/**
 * 用于运行时访问的技能注册表
 */
export interface SkillRegistry {
  /** 获取所有已注册技能 */
  getAll(): BuiltinSkill[];
  /** 按名称获取技能 */
  get(name: string): BuiltinSkill | undefined;
  /** 注册新技能 */
  register(skill: BuiltinSkill): void;
  /** 检查技能是否存在 */
  has(name: string): boolean;
}
