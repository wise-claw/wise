/**
 * RALPH 阶段适配器
 *
 * 将已有的 ralph 校验模块封装到流水线阶段适配器接口中。
 *
 * ralph 阶段对实现进行迭代式校验：
 * - 功能完整性审查
 * - 安全审查
 * - 代码质量审查
 * - 修复发现的问题并重新校验
 */

import type { PipelineStageAdapter, PipelineConfig, PipelineContext } from '../pipeline-types.js';

export const RALPH_COMPLETION_SIGNAL = 'PIPELINE_RALPH_COMPLETE';

export const ralphAdapter: PipelineStageAdapter = {
  id: 'ralph',
  name: 'Verification (RALPH)',
  completionSignal: RALPH_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return config.verification === false;
  },

  getPrompt(context: PipelineContext): string {
    const specPath = context.specPath || '.wise/autopilot/spec.md';
    const maxIterations = context.config.verification !== false
      ? context.config.verification.maxIterations
      : 100;

    return `## PIPELINE STAGE: RALPH (Verification)

Verify the implementation against the specification using the Ralph verification loop.

**Max Iterations:** ${maxIterations}

### Verification Process

Spawn parallel verification reviewers:

Each reviewer must return ONLY a concise review summary under 100 words covering verdict, evidence highlights, files checked, and blockers. Avoid dumping long logs or transcripts into the main session.

\`\`\`
// Functional Completeness Review
Task(
  subagent_type="wise:architect",
  model="opus",
  prompt="FUNCTIONAL COMPLETENESS REVIEW

Read the original spec at: ${specPath}

Verify:
1. All functional requirements are implemented
2. All non-functional requirements are addressed
3. All acceptance criteria from the plan are met
4. No missing features or incomplete implementations

Verdict: APPROVED (all requirements met) or REJECTED (with specific gaps)"
)

// Security Review
Task(
  subagent_type="wise:security-reviewer",
  model="opus",
  prompt="SECURITY REVIEW

Check the implementation for:
1. OWASP Top 10 vulnerabilities
2. Input validation and sanitization
3. Authentication/authorization issues
4. Sensitive data exposure
5. Injection vulnerabilities (SQL, command, XSS)
6. Hardcoded secrets or credentials

Verdict: APPROVED (no vulnerabilities) or REJECTED (with specific issues)"
)

// Code Quality Review
Task(
  subagent_type="wise:code-reviewer",
  model="opus",
  prompt="CODE QUALITY REVIEW

Review the implementation for:
1. Code organization and structure
2. Design patterns and best practices
3. Error handling completeness
4. Test coverage adequacy
5. Maintainability and readability

Verdict: APPROVED (high quality) or REJECTED (with specific issues)"
)
\`\`\`

### Fix and Re-verify Loop

If any reviewer rejects:
1. Collect all rejection reasons
2. Fix each issue identified
3. Re-run verification (up to ${maxIterations} iterations)

### Completion

When all reviewers approve:

Signal: ${RALPH_COMPLETION_SIGNAL}
`;
  },
};
