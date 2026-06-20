/**
 * 委派路由类型
 *
 * 为方便使用而从共享类型重新导出，并附带委派相关的常量与辅助函数。
 */

import type { DelegationRoutingConfig } from '../../shared/types.js';

export type {
  DelegationProvider,
  DelegationTool,
  DelegationRoute,
  DelegationRoutingConfig,
  DelegationDecision,
  ResolveDelegationOptions,
} from '../../shared/types.js';

/**
 * 默认委派路由配置
 */
export const DEFAULT_DELEGATION_CONFIG: DelegationRoutingConfig = {
  enabled: false,
  defaultProvider: 'claude',
  roles: {},
};

/**
 * 角色类别到默认 Claude 子代理的映射
 */
export const ROLE_CATEGORY_DEFAULTS: Record<string, string> = {
  // 探索类角色
  explore: 'explore',
  'document-specialist': 'document-specialist',
  researcher: 'document-specialist',
  'tdd-guide': 'test-engineer',

  // 顾问类角色（高复杂度）
  architect: 'architect',
  planner: 'planner',
  critic: 'critic',
  analyst: 'analyst',

  // 实现类角色
  executor: 'executor',

  // 审查类角色
  'code-reviewer': 'code-reviewer',
  'security-reviewer': 'security-reviewer',

  // 专用角色
  designer: 'designer',
  writer: 'writer',
  'qa-tester': 'qa-tester',
  debugger: 'debugger',
  scientist: 'scientist',
  'git-master': 'executor',
  'code-simplifier': 'executor',
};

/**
 * 已弃用的角色别名到规范角色名的映射。
 */
export const DEPRECATED_ROLE_ALIASES: Readonly<Record<string, string>> = {
  researcher: 'document-specialist',
  'tdd-guide': 'test-engineer',
  'api-reviewer': 'code-reviewer',
  'performance-reviewer': 'code-reviewer',
  'dependency-expert': 'document-specialist',
  'quality-strategist': 'code-reviewer',
  vision: 'document-specialist',
  // 合并后的 agent 别名（agent 合并 PR）
  'quality-reviewer': 'code-reviewer',
  'deep-executor': 'executor',
  'build-fixer': 'debugger',
  'harsh-critic': 'critic',
  // 面向用户的 /team 角色路由短别名（计划 AC-4）
  reviewer: 'code-reviewer',
};

/**
 * 将旧版角色别名规范化为规范角色名。
 */
export function normalizeDelegationRole(role: string): string {
  return DEPRECATED_ROLE_ALIASES[role] ?? role;
}

/**
 * 检查委派路由是否已启用
 */
export function isDelegationEnabled(
  config: DelegationRoutingConfig | undefined
): boolean {
  return config?.enabled === true;
}
