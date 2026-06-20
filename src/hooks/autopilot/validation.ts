/**
 * Autopilot 校验与摘要
 *
 * 协调 Phase 4 的并行校验架构师。
 * 汇总裁决并判断 autopilot 是否可以完成。
 * 同时在 autopilot 完成时生成人类可读的摘要。
 */

import {
  readAutopilotState,
  writeAutopilotState,
} from './state.js';
import type {
  AutopilotState,
  AutopilotPhase,
  AutopilotSummary,
  ValidationResult,
  ValidationVerdictType,
  ValidationVerdict
} from './types.js';

/** 达成校验共识所需的架构师数量 */
export const REQUIRED_ARCHITECTS = 3;

export interface ValidationCoordinatorResult {
  success: boolean;
  allApproved: boolean;
  verdicts: ValidationResult[];
  round: number;
  issues: string[];
}

/**
 * 记录来自某位架构师的校验裁决
 */
export function recordValidationVerdict(
  directory: string,
  type: ValidationVerdictType,
  verdict: ValidationVerdict,
  issues?: string[],
  sessionId?: string
): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state || state.phase !== 'validation') {
    return false;
  }

  const result: ValidationResult = {
    type,
    verdict,
    issues
  };

  // 移除当前轮次中该类型的已有裁决
  const existingIndex = state.validation.verdicts.findIndex(
    v => v.type === type
  );

  if (existingIndex >= 0) {
    state.validation.verdicts[existingIndex] = result;
  } else {
    state.validation.verdicts.push(result);
    state.validation.architects_spawned++;
  }

  // 检查是否所有裁决都已提交
  if (state.validation.verdicts.length >= REQUIRED_ARCHITECTS) {
    state.validation.all_approved = state.validation.verdicts.every(
      v => v.verdict === 'APPROVED'
    );
  }

  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 获取校验状态
 */
export function getValidationStatus(directory: string, sessionId?: string): ValidationCoordinatorResult | null {
  const state = readAutopilotState(directory, sessionId);
  if (!state) {
    return null;
  }

  const allIssues: string[] = [];
  for (const verdict of state.validation.verdicts) {
    if (verdict.issues) {
      allIssues.push(...verdict.issues);
    }
  }

  return {
    success: state.validation.verdicts.length >= REQUIRED_ARCHITECTS,
    allApproved: state.validation.all_approved,
    verdicts: state.validation.verdicts,
    round: state.validation.validation_rounds,
    issues: allIssues
  };
}

/**
 * 开启新一轮校验
 */
export function startValidationRound(directory: string, sessionId?: string): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state || state.phase !== 'validation') {
    return false;
  }

  state.validation.validation_rounds++;
  state.validation.verdicts = [];
  state.validation.all_approved = false;
  state.validation.architects_spawned = 0;

  return writeAutopilotState(directory, state, sessionId);
}

/**
 * 检查校验是否应重试
 */
export function shouldRetryValidation(directory: string, maxRounds: number = 3, sessionId?: string): boolean {
  const state = readAutopilotState(directory, sessionId);
  if (!state) {
    return false;
  }

  const hasRejection = state.validation.verdicts.some(
    v => v.verdict === 'REJECTED'
  );

  const canRetry = state.validation.validation_rounds < maxRounds;

  return hasRejection && canRetry;
}

/**
 * 获取重试前需要修复的问题
 */
export function getIssuesToFix(directory: string, sessionId?: string): string[] {
  const state = readAutopilotState(directory, sessionId);
  if (!state) {
    return [];
  }

  const issues: string[] = [];

  for (const verdict of state.validation.verdicts) {
    if (verdict.verdict === 'REJECTED' && verdict.issues) {
      issues.push(`[${verdict.type.toUpperCase()}] ${verdict.issues.join(', ')}`);
    }
  }

  return issues;
}

/**
 * 生成校验派发 prompt
 */
export function getValidationSpawnPrompt(specPath: string): string {
  return `## SPAWN PARALLEL VALIDATION ARCHITECTS

Spawn all three validation architects in parallel to review the implementation:

\`\`\`
// 1. Functional Completeness Review
Task(
  subagent_type="wise:architect",
  model="opus",
  prompt="FUNCTIONAL COMPLETENESS REVIEW

Read the original spec at: ${specPath}

Verify every requirement has been implemented:
1. Check each functional requirement
2. Check each non-functional requirement
3. Verify acceptance criteria are met
4. Test core user workflows

Output: APPROVED or REJECTED with specific gaps"
)

// 2. Security Review
Task(
  subagent_type="wise:security-reviewer",
  model="opus",
  prompt="SECURITY REVIEW

Review the codebase for security vulnerabilities:
1. Input validation and sanitization
2. Authentication/authorization
3. Injection vulnerabilities (SQL, command, XSS)
4. Sensitive data handling
5. Error message exposure
6. Dependencies with known vulnerabilities

Output: APPROVED or REJECTED with specific issues"
)

// 3. Code Quality Review
Task(
  subagent_type="wise:code-reviewer",
  model="opus",
  prompt="CODE QUALITY REVIEW

Review code quality and maintainability:
1. Code organization and architecture
2. Error handling completeness
3. Test coverage
4. Documentation
5. Best practices adherence
6. Technical debt

Output: APPROVED or REJECTED with specific issues"
)
\`\`\`

Wait for all three architects to complete, then aggregate verdicts.
`;
}

/**
 * 格式化校验结果用于展示
 */
export function formatValidationResults(state: AutopilotState, _sessionId?: string): string {
  const lines: string[] = [
    '## Validation Results',
    `Round: ${state.validation.validation_rounds}`,
    ''
  ];

  for (const verdict of state.validation.verdicts) {
    const icon = verdict.verdict === 'APPROVED' ? '✓' : '✗';
    lines.push(`${icon} **${verdict.type.toUpperCase()}**: ${verdict.verdict}`);

    if (verdict.issues && verdict.issues.length > 0) {
      for (const issue of verdict.issues) {
        lines.push(`  - ${issue}`);
      }
    }
  }

  lines.push('');

  if (state.validation.all_approved) {
    lines.push('**Result: ALL APPROVED** - Ready to complete');
  } else {
    lines.push('**Result: NEEDS FIXES** - Address issues above');
  }

  return lines.join('\n');
}

// ============================================================================
// 摘要生成
// ============================================================================

/**
 * 生成本次 autopilot 运行的摘要
 */
export function generateSummary(directory: string, sessionId?: string): AutopilotSummary | null {
  const state = readAutopilotState(directory, sessionId);
  if (!state) {
    return null;
  }

  const startTime = new Date(state.started_at).getTime();
  const endTime = state.completed_at
    ? new Date(state.completed_at).getTime()
    : Date.now();
  const duration = endTime - startTime;

  const phasesCompleted: AutopilotPhase[] = [];
  if (state.expansion.spec_path) phasesCompleted.push('expansion');
  if (state.planning.approved) phasesCompleted.push('planning');
  if (state.execution.ralph_completed_at) phasesCompleted.push('execution');
  if (state.qa.qa_completed_at) phasesCompleted.push('qa');
  if (state.validation.all_approved) phasesCompleted.push('validation');
  if (state.phase === 'complete') phasesCompleted.push('complete');

  let testsStatus = 'Not run';
  if (state.qa.test_status === 'passing') {
    testsStatus = 'Passing';
  } else if (state.qa.test_status === 'failing') {
    testsStatus = 'Failing';
  } else if (state.qa.test_status === 'skipped') {
    testsStatus = 'Skipped';
  }

  return {
    originalIdea: state.originalIdea,
    filesCreated: state.execution.files_created,
    filesModified: state.execution.files_modified,
    testsStatus,
    duration,
    agentsSpawned: state.total_agents_spawned,
    phasesCompleted
  };
}

/**
 * 以人类可读格式格式化时长
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${seconds}s`;
}

/**
 * 生成格式化的摘要输出
 */
export function formatSummary(summary: AutopilotSummary): string {
  const lines: string[] = [
    '',
    '╭──────────────────────────────────────────────────────╮',
    '│                  AUTOPILOT COMPLETE                   │',
    '├──────────────────────────────────────────────────────┤'
  ];

  // 原始想法（过长则截断）
  const ideaDisplay = summary.originalIdea.length > 50
    ? summary.originalIdea.substring(0, 47) + '...'
    : summary.originalIdea;
  lines.push(`│  Original Idea: ${ideaDisplay.padEnd(36)} │`);
  lines.push('│                                                      │');

  // 交付内容区
  lines.push('│  Delivered:                                          │');
  lines.push(`│  • ${summary.filesCreated.length} files created${' '.repeat(36 - String(summary.filesCreated.length).length)}│`);
  lines.push(`│  • ${summary.filesModified.length} files modified${' '.repeat(35 - String(summary.filesModified.length).length)}│`);
  lines.push(`│  • Tests: ${summary.testsStatus}${' '.repeat(36 - summary.testsStatus.length)}│`);
  lines.push('│                                                      │');

  // 指标
  lines.push('│  Metrics:                                            │');
  const durationStr = formatDuration(summary.duration);
  lines.push(`│  • Duration: ${durationStr}${' '.repeat(35 - durationStr.length)}│`);
  lines.push(`│  • Agents spawned: ${summary.agentsSpawned}${' '.repeat(30 - String(summary.agentsSpawned).length)}│`);
  lines.push(`│  • Phases completed: ${summary.phasesCompleted.length}/5${' '.repeat(27)}│`);

  lines.push('╰──────────────────────────────────────────────────────╯');
  lines.push('');

  return lines.join('\n');
}

/**
 * 生成用于 HUD 展示的精简摘要
 */
export function formatCompactSummary(state: AutopilotState): string {
  const phase = state.phase.toUpperCase();
  const files = state.execution.files_created.length + state.execution.files_modified.length;
  const agents = state.total_agents_spawned;

  if (state.phase === 'complete') {
    return `[AUTOPILOT ✓] Complete | ${files} files | ${agents} agents`;
  }

  if (state.phase === 'failed') {
    return `[AUTOPILOT ✗] Failed at ${state.phase}`;
  }

  const phaseIndex = ['expansion', 'planning', 'execution', 'qa', 'validation'].indexOf(state.phase);
  return `[AUTOPILOT] Phase ${phaseIndex + 1}/5: ${phase} | ${files} files`;
}

/**
 * 生成失败摘要
 */
export function formatFailureSummary(state: AutopilotState, error?: string): string {
  const lines: string[] = [
    '',
    '╭──────────────────────────────────────────────────────╮',
    '│                  AUTOPILOT FAILED                     │',
    '├──────────────────────────────────────────────────────┤',
    `│  Failed at phase: ${state.phase.toUpperCase().padEnd(33)} │`
  ];

  if (error) {
    const errorLines = error.match(/.{1,48}/g) || [error];
    lines.push('│                                                      │');
    lines.push('│  Error:                                              │');
    for (const line of errorLines.slice(0, 3)) {
      lines.push(`│  ${line.padEnd(50)} │`);
    }
  }

  lines.push('│                                                      │');
  lines.push('│  Progress preserved. Run /autopilot to resume.       │');
  lines.push('╰──────────────────────────────────────────────────────╯');
  lines.push('');

  return lines.join('\n');
}

/**
 * 列出文件用于详细摘要
 */
export function formatFileList(files: string[], title: string, maxFiles: number = 10): string {
  if (files.length === 0) {
    return '';
  }

  const lines: string[] = [`\n### ${title} (${files.length})`];

  const displayFiles = files.slice(0, maxFiles);
  for (const file of displayFiles) {
    lines.push(`- ${file}`);
  }

  if (files.length > maxFiles) {
    lines.push(`- ... and ${files.length - maxFiles} more`);
  }

  return lines.join('\n');
}
