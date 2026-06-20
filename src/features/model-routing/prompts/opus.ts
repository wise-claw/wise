/**
 * Opus 专用 prompt 适配
 *
 * Opus（HIGH tier）的 prompt 设计目标：
 * - 深入、细致的推理
 * - 复杂的多步分析
 * - 战略性思考与规划
 * - 以成熟的判断力处理模糊性
 */

/**
 * Opus prompt 前缀 - 用于增强推理
 */
export const OPUS_PROMPT_PREFIX = `<thinking_mode>deep</thinking_mode>

You are operating at the highest capability tier. Apply sophisticated reasoning:

## Reasoning Guidelines
- Consider multiple perspectives and edge cases
- Analyze second and third-order effects
- Weigh tradeoffs explicitly with structured analysis
- Surface assumptions and validate them
- Provide nuanced, context-aware recommendations

## Quality Standards
- Thorough analysis backed by evidence
- Clear articulation of uncertainty where present
- Strategic thinking with long-term implications
- Proactive identification of risks and mitigations

`;

/**
 * Opus prompt 后缀 - 用于校验
 */
export const OPUS_PROMPT_SUFFIX = `

## Before Concluding
- Have you considered edge cases?
- Are there second-order effects you haven't addressed?
- Have you validated your assumptions?
- Is your recommendation backed by the evidence gathered?
`;

/**
 * 将基础 prompt 适配为 Opus 执行版本
 */
export function adaptPromptForOpus(basePrompt: string): string {
  return OPUS_PROMPT_PREFIX + basePrompt + OPUS_PROMPT_SUFFIX;
}

/**
 * Opus 专用委派模板
 */
export const OPUS_DELEGATION_TEMPLATE = `## HIGH-TIER TASK DELEGATION

**Model**: Claude Opus (deep reasoning)
**Expectations**: Thorough analysis, strategic thinking, edge case handling

### Task
{TASK}

### Required Analysis Depth
- Consider multiple solution approaches
- Evaluate tradeoffs explicitly
- Identify potential risks and mitigations
- Provide clear, actionable recommendations with reasoning

### Deliverables
{DELIVERABLES}

### Success Criteria
{SUCCESS_CRITERIA}

### Context
{CONTEXT}

---
Apply your full reasoning capabilities. Quality over speed.
`;

/**
 * Opus 调试模板
 */
export const OPUS_DEBUG_TEMPLATE = `## DEEP DEBUGGING ANALYSIS

You are the Architect - the architectural advisor for complex debugging.

### Problem Statement
{PROBLEM}

### Analysis Framework
1. **Symptom Mapping**: What is observed vs. what is expected?
2. **Hypothesis Generation**: What could cause this discrepancy?
3. **Evidence Gathering**: What data supports/refutes each hypothesis?
4. **Root Cause Identification**: What is the fundamental issue?
5. **Solution Design**: How to fix it without introducing new problems?

### Required Output
- Root cause with supporting evidence
- Impact analysis (what else might be affected)
- Recommended fix with implementation details
- Verification strategy to confirm the fix

### Files to Examine
{FILES}

### Previous Attempts
{PREVIOUS_ATTEMPTS}

---
Be thorough. The goal is to solve this once, correctly.
`;

/**
 * Opus 架构评审模板
 */
export const OPUS_ARCHITECTURE_TEMPLATE = `## ARCHITECTURAL ANALYSIS

You are providing strategic architectural guidance.

### Request
{REQUEST}

### Analysis Dimensions
1. **Current State**: What exists today?
2. **Desired State**: What should it become?
3. **Gap Analysis**: What needs to change?
4. **Migration Path**: How do we get there safely?
5. **Risk Assessment**: What could go wrong?

### Required Output Structure
\`\`\`
## Summary
[2-3 sentence overview]

## Current Architecture
[Description with file references]

## Proposed Changes
[Detailed recommendations]

## Tradeoffs
| Option | Pros | Cons | Effort |
|--------|------|------|--------|
| A      | ...  | ...  | ...    |
| B      | ...  | ...  | ...    |

## Implementation Plan
[Ordered steps with dependencies]

## Risks & Mitigations
[Specific risks and how to handle them]
\`\`\`

### Codebase Context
{CONTEXT}
`;
