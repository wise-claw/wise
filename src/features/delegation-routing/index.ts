/**
 * 委派路由
 *
 * 统一的委派路由器，根据配置决定对给定 agent 角色使用哪个提供方/工具。
 */

// 主解析器
export {
  resolveDelegation,
  parseFallbackChain,
  isDeprecatedMcpProvider,
  DEPRECATED_MCP_PROVIDER_WARNING,
} from './resolver.js';

// 类型与常量
export {
  DEFAULT_DELEGATION_CONFIG,
  ROLE_CATEGORY_DEFAULTS,
  isDelegationEnabled,
} from './types.js';

// 为方便使用而重新导出共享类型
export type {
  DelegationProvider,
  DelegationTool,
  DelegationRoute,
  DelegationRoutingConfig,
  DelegationDecision,
  ResolveDelegationOptions,
} from '../../shared/types.js';
