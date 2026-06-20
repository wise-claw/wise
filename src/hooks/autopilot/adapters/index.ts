/**
 * 流水线阶段适配器
 *
 * 所有阶段适配器的桶导出。每个适配器将一个已有模块
 * （ralplan、team、ralph、ultraqa）封装为 PipelineStageAdapter 接口。
 */

export { ralplanAdapter, RALPLAN_COMPLETION_SIGNAL } from './ralplan-adapter.js';
export { executionAdapter, EXECUTION_COMPLETION_SIGNAL } from './execution-adapter.js';
export { ralphAdapter, RALPH_COMPLETION_SIGNAL } from './ralph-adapter.js';
export { qaAdapter, QA_COMPLETION_SIGNAL } from './qa-adapter.js';

import type { PipelineStageAdapter } from '../pipeline-types.js';
import { ralplanAdapter } from './ralplan-adapter.js';
import { executionAdapter } from './execution-adapter.js';
import { ralphAdapter } from './ralph-adapter.js';
import { qaAdapter } from './qa-adapter.js';

/**
 * 按规范执行顺序排列的全部阶段适配器。
 * 流水线编排器按顺序遍历这些适配器，
 * 跳过任何被配置禁用的适配器。
 */
export const ALL_ADAPTERS: readonly PipelineStageAdapter[] = [
  ralplanAdapter,
  executionAdapter,
  ralphAdapter,
  qaAdapter,
] as const;

/**
 * 按阶段 ID 查找适配器。
 */
export function getAdapterById(id: string): PipelineStageAdapter | undefined {
  return ALL_ADAPTERS.find(a => a.id === id);
}
