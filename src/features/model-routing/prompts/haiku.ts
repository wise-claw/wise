/**
 * Haiku 专用 prompt 适配
 *
 * Haiku（LOW tier）的 prompt 设计目标：
 * - 最大化速度与效率
 * - 简洁、直接的指令
 * - 简单、聚焦的任务
 * - 最小的认知负担
 */

/**
 * Haiku prompt 前缀 - 最小开销
 */
export const HAIKU_PROMPT_PREFIX = `TASK: `;

/**
 * Haiku prompt 后缀 - 直接执行
 */
export const HAIKU_PROMPT_SUFFIX = `

Return results directly. No preamble.`;

/**
 * 将基础 prompt 适配为 Haiku 执行版本
 */
export function adaptPromptForHaiku(basePrompt: string): string {
  // 对 Haiku，需要去除不必要的冗余措辞
  const condensed = condensePrompt(basePrompt);
  return HAIKU_PROMPT_PREFIX + condensed + HAIKU_PROMPT_SUFFIX;
}

/**
 * 为 Haiku 精简 prompt - 去除不必要的词汇
 */
function condensePrompt(prompt: string): string {
  // 移除常见的填充短语
  const condensed = prompt
    .replace(/please\s+/gi, '')
    .replace(/could you\s+/gi, '')
    .replace(/i would like you to\s+/gi, '')
    .replace(/i need you to\s+/gi, '')
    .replace(/can you\s+/gi, '')
    .replace(/would you\s+/gi, '')
    .replace(/i want you to\s+/gi, '')
    .replace(/make sure to\s+/gi, '')
    .replace(/be sure to\s+/gi, '')
    .replace(/don't forget to\s+/gi, '')
    .trim();

  return condensed;
}

/**
 * Haiku 搜索模板
 */
export const HAIKU_SEARCH_TEMPLATE = `SEARCH: {QUERY}

RETURN:
- File paths (absolute)
- Line numbers
- Brief context

FORMAT:
\`path/file.ts:123\` - [description]
`;

/**
 * Haiku 文件列表模板
 */
export const HAIKU_LIST_TEMPLATE = `LIST: {TARGET}

RETURN: File paths matching criteria.
`;

/**
 * Haiku 文档模板
 */
export const HAIKU_DOC_TEMPLATE = `DOCUMENT: {TARGET}

REQUIREMENTS:
{REQUIREMENTS}

OUTPUT: Markdown documentation.
`;

/**
 * Haiku 简单任务模板
 */
export const HAIKU_SIMPLE_TEMPLATE = `DO: {TASK}

CONTEXT: {CONTEXT}

RETURN: {EXPECTED_OUTPUT}
`;

/**
 * Haiku 委派模板 - 极简
 */
export const HAIKU_DELEGATION_TEMPLATE = `TASK: {TASK}
TARGET: {TARGET}
OUTPUT: {OUTPUT_FORMAT}
`;

/**
 * 从冗长的 prompt 中提取关键动作
 */
export function extractKeyAction(prompt: string): string {
  // 尝试提取主要的动词短语
  const actionPatterns = [
    /(?:find|search|list|show|get|locate)\s+(.+?)(?:\.|$)/i,
    /(?:where|what)\s+(?:is|are)\s+(.+?)(?:\?|$)/i,
  ];

  for (const pattern of actionPatterns) {
    const match = prompt.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  // 若无模式匹配，返回第一句
  const firstSentence = prompt.split(/[.!?]/)[0];
  return firstSentence.trim();
}

/**
 * 创建极简探索 prompt
 */
export function createExplorePrompt(query: string): string {
  return `FIND: ${query}

TOOLS: Glob, Grep, Read

OUTPUT:
<files>
- /path/file.ts — [why relevant]
</files>

<answer>
[Direct answer]
</answer>`;
}

/**
 * 创建极简文档 prompt
 */
export function createDocPrompt(target: string, requirements: string[]): string {
  return `DOCUMENT: ${target}

INCLUDE:
${requirements.map(r => `- ${r}`).join('\n')}

FORMAT: Markdown
VERIFY: Code examples work`;
}
