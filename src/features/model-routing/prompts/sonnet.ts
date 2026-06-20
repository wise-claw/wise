/**
 * Sonnet 专用 prompt 适配
 *
 * Sonnet（MEDIUM tier）的 prompt 设计目标：
 * - 兼顾推理与良好速度的平衡
 * - 聚焦的任务执行
 * - 结构化输出的清晰交付物
 * - 高效的多步工作流
 */

/**
 * Sonnet prompt 前缀 - 用于聚焦执行
 */
export const SONNET_PROMPT_PREFIX = `## Task Execution Mode

Execute this task efficiently with clear deliverables:

`;

/**
 * Sonnet prompt 后缀 - 用于校验
 */
export const SONNET_PROMPT_SUFFIX = `

---
Focus on delivering the requested outcome. Be thorough but efficient.
`;

/**
 * 将基础 prompt 适配为 Sonnet 执行版本
 */
export function adaptPromptForSonnet(basePrompt: string): string {
  return SONNET_PROMPT_PREFIX + basePrompt + SONNET_PROMPT_SUFFIX;
}

/**
 * Sonnet 委派模板
 */
export const SONNET_DELEGATION_TEMPLATE = `## TASK DELEGATION

**Tier**: MEDIUM (balanced)

### Task
{TASK}

### Expected Outcome
{DELIVERABLES}

### Success Criteria
{SUCCESS_CRITERIA}

### Context
{CONTEXT}

### Required Tools
{TOOLS}

### Constraints
- MUST DO: {MUST_DO}
- MUST NOT DO: {MUST_NOT}

---
Execute efficiently. Report completion status.
`;

/**
 * Sonnet 实现模板
 */
export const SONNET_IMPLEMENTATION_TEMPLATE = `## IMPLEMENTATION TASK

### What to Build
{TASK}

### Acceptance Criteria
{CRITERIA}

### Approach
1. Read relevant files to understand patterns
2. Plan changes before making them
3. Implement following existing conventions
4. Verify changes work correctly

### Files to Modify
{FILES}

### Existing Patterns to Follow
{PATTERNS}

---
Match existing code style. Test your changes.
`;

/**
 * Sonnet 研究模板
 */
export const SONNET_RESEARCH_TEMPLATE = `## RESEARCH TASK

### Query
{QUERY}

### Required Information
{REQUIREMENTS}

### Sources to Search
{SOURCES}

### Output Format
\`\`\`
## Query: [restated query]

## Findings
### [Source 1]
[Key information]
**Reference**: [URL/file path]

### [Source 2]
[Key information]
**Reference**: [URL/file path]

## Summary
[Synthesized answer]

## Recommendations
[Actionable next steps]
\`\`\`

---
Cite sources. Provide actionable information.
`;

/**
 * Sonnet 前端模板
 */
export const SONNET_FRONTEND_TEMPLATE = `## FRONTEND TASK

### Change Required
{TASK}

### Visual Expectations
{VISUAL_REQUIREMENTS}

### Technical Constraints
- Framework: {FRAMEWORK}
- Styling: {STYLING_APPROACH}
- Components: {COMPONENT_PATTERNS}

### Existing Patterns
{PATTERNS}

### Files to Modify
{FILES}

---
Match the existing aesthetic. Test in browser if applicable.
`;
