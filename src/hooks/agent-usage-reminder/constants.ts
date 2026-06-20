/**
 * Agent Usage Reminder 常量
 *
 * 用于跟踪工具使用并鼓励委派给代理的常量。
 *
 * 移植自 oh-my-opencode 的 agent-usage-reminder 钩子。
 */

import { join } from 'path';
import { homedir } from 'os';

/** agent 使用提醒状态的存储目录 */
export const WISE_STORAGE_DIR = join(homedir(), '.wise');
export const AGENT_USAGE_REMINDER_STORAGE = join(
  WISE_STORAGE_DIR,
  'agent-usage-reminder',
);

/** 所有工具名归一化为小写，以支持大小写不敏感匹配 */
export const TARGET_TOOLS = new Set([
  'grep',
  'safe_grep',
  'glob',
  'safe_glob',
  'webfetch',
  'context7_resolve-library-id',
  'context7_query-docs',
  'websearch_web_search_exa',
  'context7_get-library-docs',
]);

/** 表示已使用代理的代理工具 */
export const AGENT_TOOLS = new Set([
  'task',
  'call_omo_agent',
  'wise_task',
]);

/** 展示给用户的提醒消息 */
export const REMINDER_MESSAGE = `
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use Task tool with explore/document-specialist agents for better results:

\`\`\`
// Parallel exploration - fire multiple agents simultaneously
Task(agent="explore", prompt="Find all files matching pattern X")
Task(agent="explore", prompt="Search for implementation of Y")
Task(agent="document-specialist", prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
\`\`\`

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel Task calls > Direct tool calls
`;
