/**
 * 会话恢复工具
 *
 * 用于恢复先前后台 agent 会话的封装工具。
 * 返回上下文供编排者在下一次 Task 委派中包含。
 *
 * 由于 Claude Code 原生的 Task 工具无法扩展，此工具提供了一种
 * 便捷方式来获取会话上下文并构建续接 prompt。
 */

import { getBackgroundManager } from '../features/background-agent/manager.js';
import type { ResumeContext } from '../features/background-agent/types.js';

/**
 * 恢复会话的输入
 */
export interface ResumeSessionInput {
  /** 要恢复的会话 ID */
  sessionId: string;
}

/**
 * 恢复会话操作的输出
 */
export interface ResumeSessionOutput {
  /** 操作是否成功 */
  success: boolean;
  /** 恢复上下文（成功时） */
  context?: {
    /** 该会话的原始 prompt */
    previousPrompt: string;
    /** 目前已进行的工具调用次数 */
    toolCallCount: number;
    /** 最后使用的工具（若有） */
    lastToolUsed?: string;
    /** 最后输出的摘要（截断到 500 字符） */
    lastOutputSummary?: string;
    /** 格式化后的续接 prompt，供下一次 Task 委派使用 */
    continuationPrompt: string;
  };
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 恢复一个后台 agent 会话
 *
 * 此工具从先前的后台会话中获取上下文，
 * 并准备一个续接 prompt，可在再次委派给 Task 工具时使用。
 *
 * @param input - 要恢复的会话 ID
 * @returns 恢复上下文或错误
 *
 * @example
 * ```typescript
 * const result = resumeSession({ sessionId: 'ses_abc123' });
 * if (result.success && result.context) {
 *   // Use result.context.continuationPrompt in your next Task delegation
 *   Task({
 *     subagent_type: "wise:executor",
 *     model: "sonnet",
 *     prompt: result.context.continuationPrompt
 *   });
 * }
 * ```
 */
export function resumeSession(input: ResumeSessionInput): ResumeSessionOutput {
  try {
    const manager = getBackgroundManager();
    const context = manager.getResumeContext(input.sessionId);

    if (!context) {
      return {
        success: false,
        error: `Session not found: ${input.sessionId}`,
      };
    }

    // 构建续接 prompt
    const continuationPrompt = buildContinuationPrompt(context);

    return {
      success: true,
      context: {
        previousPrompt: context.previousPrompt,
        toolCallCount: context.toolCallCount,
        lastToolUsed: context.lastToolUsed,
        lastOutputSummary: context.lastOutputSummary,
        continuationPrompt,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 从恢复上下文构建格式化的续接 prompt
 *
 * @param context - 来自后台管理器的恢复上下文
 * @returns 用于下一次 Task 委派的格式化 prompt
 */
function buildContinuationPrompt(context: ResumeContext): string {
  const parts: string[] = [];

  // 添加会话上下文标题
  parts.push('# Resuming Background Session');
  parts.push('');
  parts.push(`Session ID: ${context.sessionId}`);
  parts.push(`Started: ${context.startedAt.toISOString()}`);
  parts.push(`Last Activity: ${context.lastActivityAt.toISOString()}`);
  parts.push('');

  // 添加原始任务
  parts.push('## Original Task');
  parts.push('');
  parts.push(context.previousPrompt);
  parts.push('');

  // 添加进度信息
  parts.push('## Progress So Far');
  parts.push('');
  parts.push(`Tool calls executed: ${context.toolCallCount}`);

  if (context.lastToolUsed) {
    parts.push(`Last tool used: ${context.lastToolUsed}`);
  }

  if (context.lastOutputSummary) {
    parts.push('');
    parts.push('Last output:');
    parts.push('```');
    parts.push(context.lastOutputSummary);
    parts.push('```');
  }

  parts.push('');

  // 添加续接指令
  parts.push('## Instructions');
  parts.push('');
  parts.push('Continue working on the task from where you left off.');
  parts.push('Review the progress above and complete any remaining work.');

  return parts.join('\n');
}
