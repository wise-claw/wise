/**
 * Agent Usage Reminder 类型
 *
 * 跟踪代理使用情况，以鼓励委派给专用代理。
 *
 * 移植自 oh-my-opencode 的 agent-usage-reminder 钩子。
 */

export interface AgentUsageState {
  sessionID: string;
  agentUsed: boolean;
  reminderCount: number;
  updatedAt: number;
}
