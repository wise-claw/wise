/**
 * 共享工具定义类型
 *
 * 用于 state-tools、notepad-tools、memory-tools 和 lsp-tools 中
 * MCP 工具定义的通用接口。
 */

import { z } from 'zod';
import type { ToolCategory } from '../constants/index.js';

/**
 * MCP 工具的工具定义接口。
 *
 * 每个工具定义：
 * - name：工具标识符（用作 mcp__t__{name}）
 * - description：供工具发现使用的人类可读描述
 * - schema：定义输入参数的 Zod schema
 * - handler：处理工具调用的异步函数
 * - category：用于过滤的工具类别（lsp、ast、state 等）
 */
/**
 * MCP 规范中的 MCP 工具注解。
 * 客户端（例如 Claude Code）用以优先加载工具，
 * 避免延迟关键工具。
 */
export interface ToolAnnotations {
  /** 为 true 时，该工具不修改任何状态。 */
  readOnlyHint?: boolean;
  /** 为 true 时，该工具可能执行破坏性操作（仅在 readOnlyHint 为 false 时有意义）。 */
  destructiveHint?: boolean;
  /** 为 true 时，该工具可安全重试且无副作用（仅在 readOnlyHint 为 false 时有意义）。 */
  idempotentHint?: boolean;
  /** 为 true 时，该工具可能与计算环境之外的“真实世界”交互。 */
  openWorldHint?: boolean;
}

export interface ToolDefinition<T extends z.ZodRawShape> {
  name: string;
  description: string;
  category?: ToolCategory;
  annotations?: ToolAnnotations;
  schema: T;
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}
