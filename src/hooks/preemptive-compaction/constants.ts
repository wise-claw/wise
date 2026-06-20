/**
 * 预防性压缩常量
 *
 * 用于上下文用量监控的阈值与消息。
 *
 * 改编自 oh-my-opencode 的 preemptive-compaction 钩子。
 */

/**
 * 触发告警的默认阈值比例（85%）
 */
export const DEFAULT_THRESHOLD = 0.85;

/**
 * 临界阈值比例（95%）
 */
export const CRITICAL_THRESHOLD = 0.95;

/**
 * 考虑压缩前的最小 token 数
 */
export const MIN_TOKENS_FOR_COMPACTION = 50_000;

/**
 * 压缩告警之间的冷却期（1 分钟）
 */
export const COMPACTION_COOLDOWN_MS = 60_000;

/**
 * 每个会话停止前的最大告警次数
 */
export const MAX_WARNINGS = 3;

/**
 * Claude 模型的默认上下文上限
 */
export const CLAUDE_DEFAULT_CONTEXT_LIMIT =
  process.env.ANTHROPIC_1M_CONTEXT === 'true' ||
  process.env.VERTEX_ANTHROPIC_1M_CONTEXT === 'true'
    ? 1_000_000
    : 200_000;

/**
 * 每 token 平均字符数估算
 */
export const CHARS_PER_TOKEN = 4;

/**
 * 上下文用量较高时的告警消息
 */
export const CONTEXT_WARNING_MESSAGE = `CONTEXT WINDOW WARNING - APPROACHING LIMIT

Your context usage is getting high. Consider these actions to prevent hitting the limit:

1. USE COMPACT COMMAND
   - Run /compact to summarize the conversation
   - This frees up context space while preserving important information

2. BE MORE CONCISE
   - Show only relevant code portions
   - Use file paths instead of full code blocks
   - Summarize instead of repeating information

3. FOCUS YOUR REQUESTS
   - Work on one task at a time
   - Complete current tasks before starting new ones
   - Avoid unnecessary back-and-forth

Current Status: Context usage is high but recoverable.
Action recommended: Use /compact when convenient.
`;

/**
 * 上下文即将占满时的临界告警消息
 */
export const CONTEXT_CRITICAL_MESSAGE = `CRITICAL: CONTEXT WINDOW ALMOST FULL

Your context usage is critically high. Immediate action required:

1. COMPACT NOW
   - Run /compact immediately to summarize the conversation
   - Without compaction, the next few messages may fail

2. AVOID LARGE OUTPUTS
   - Do not show full files
   - Use summaries instead of detailed outputs
   - Be as concise as possible

3. PREPARE FOR SESSION HANDOFF
   - If compaction doesn't help enough, prepare to continue in a new session
   - Note your current progress and next steps

WARNING: Further messages may fail if context is not reduced.
Action required: Run /compact now.
`;

/**
 * 压缩成功时的消息
 */
export const COMPACTION_SUCCESS_MESSAGE = `Context compacted successfully. Session can continue normally.`;
