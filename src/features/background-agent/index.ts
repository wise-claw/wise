/**
 * Background Agent 功能
 *
 * 为 WISE 多智能体系统管理后台任务。
 * 提供并发控制与任务状态管理。
 *
 * 改编自 oh-my-opencode 的 background-agent 功能。
 */

export * from './types.js';
export { BackgroundManager, getBackgroundManager, resetBackgroundManager } from './manager.js';
export { ConcurrencyManager } from './concurrency.js';
