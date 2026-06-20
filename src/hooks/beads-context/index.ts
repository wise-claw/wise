import { contextCollector } from '../../features/context-injector/index.js';
import { getWiseConfig } from '../../features/auto-update.js';
import { BEADS_INSTRUCTIONS, BEADS_RUST_INSTRUCTIONS } from './constants.js';
import type { TaskTool, BeadsContextConfig } from './types.js';

export type { TaskTool, BeadsContextConfig } from './types.js';
export { BEADS_INSTRUCTIONS, BEADS_RUST_INSTRUCTIONS } from './constants.js';

/**
 * 每个 task tool 变体对应的指令映射。
 */
const INSTRUCTIONS_MAP: Record<Exclude<TaskTool, 'builtin'>, string> = {
  'beads': BEADS_INSTRUCTIONS,
  'beads-rust': BEADS_RUST_INSTRUCTIONS,
};

/**
 * 获取指定 tool 变体的 beads 指令。
 */
export function getBeadsInstructions(tool: Exclude<TaskTool, 'builtin'>): string {
  const instructions = INSTRUCTIONS_MAP[tool];
  if (!instructions) {
    throw new Error(`Unknown task tool: ${tool}`);
  }
  return instructions;
}

/**
 * 从 wise-config.json 读取 beads 上下文配置。
 */
export function getBeadsContextConfig(): BeadsContextConfig {
  const config = getWiseConfig();
  return {
    taskTool: config.taskTool ?? 'builtin',
    injectInstructions: config.taskToolConfig?.injectInstructions ?? true,
    useMcp: config.taskToolConfig?.useMcp ?? false,
  };
}

/**
 * 为某会话注册 beads 上下文。
 * 在会话初始化时由 setup 钩子调用。
 */
export function registerBeadsContext(sessionId: string): boolean {
  const config = getBeadsContextConfig();

  if (config.taskTool === 'builtin' || !config.injectInstructions) {
    return false;
  }

  // 校验 taskTool 是否为已知值
  if (!['beads', 'beads-rust'].includes(config.taskTool)) {
    // 未知的 tool 值 - 不注入错误的指令
    return false;
  }

  const instructions = getBeadsInstructions(config.taskTool);

  contextCollector.register(sessionId, {
    id: 'beads-instructions',
    source: 'beads',
    content: instructions,
    priority: 'normal',
  });

  return true;
}

/**
 * 清除某会话的 beads 上下文。
 */
export function clearBeadsContext(sessionId: string): void {
  contextCollector.removeEntry(sessionId, 'beads', 'beads-instructions');
}
