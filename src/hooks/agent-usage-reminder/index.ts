/**
 * Agent Usage Reminder 钩子
 *
 * 当用户直接调用工具进行搜索或获取内容而非委派给代理时，
 * 提醒用户使用专用代理。
 *
 * 此钩子跟踪工具使用情况，并在用户未有效使用代理时，
 * 将提醒消息追加到工具输出中。
 *
 * 移植自 oh-my-opencode 的 agent-usage-reminder 钩子。
 * 适配 Claude Code 基于 shell 的钩子系统。
 */

import {
  loadAgentUsageState,
  saveAgentUsageState,
  clearAgentUsageState,
} from './storage.js';
import { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE } from './constants.js';
import type { AgentUsageState } from './types.js';

// 重新导出类型与工具函数
export { loadAgentUsageState, saveAgentUsageState, clearAgentUsageState } from './storage.js';
export { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE } from './constants.js';
export type { AgentUsageState } from './types.js';

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createAgentUsageReminderHook() {
  const sessionStates = new Map<string, AgentUsageState>();

  function getOrCreateState(sessionID: string): AgentUsageState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadAgentUsageState(sessionID);
      const state: AgentUsageState = persisted ?? {
        sessionID,
        agentUsed: false,
        reminderCount: 0,
        updatedAt: Date.now(),
      };
      sessionStates.set(sessionID, state);
    }
    return sessionStates.get(sessionID)!;
  }

  function markAgentUsed(sessionID: string): void {
    const state = getOrCreateState(sessionID);
    state.agentUsed = true;
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID);
    clearAgentUsageState(sessionID);
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const { tool, sessionID } = input;
    const toolLower = tool.toLowerCase();

    // 若调用了代理工具，则标记代理已使用
    if (AGENT_TOOLS.has(toolLower)) {
      markAgentUsed(sessionID);
      return;
    }

    // 仅跟踪目标工具（搜索/获取类工具）
    if (!TARGET_TOOLS.has(toolLower)) {
      return;
    }

    const state = getOrCreateState(sessionID);

    // 若已使用代理，则不再提醒
    if (state.agentUsed) {
      return;
    }

    // 将提醒消息追加到输出
    output.output += REMINDER_MESSAGE;
    state.reminderCount++;
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    // 会话被删除时清理状态
    if (event.type === 'session.deleted') {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        resetState(sessionInfo.id);
      }
    }

    // 会话被压缩时清理状态
    if (event.type === 'session.compacted') {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        resetState(sessionID);
      }
    }
  };

  return {
    'tool.execute.after': toolExecuteAfter,
    event: eventHandler,
  };
}
