/**
 * 验证模块
 *
 * 从 ralph、ultrawork 和 autopilot 中抽取的可复用验证协议逻辑。
 * 为验证需求和执行提供单一事实来源。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  VerificationProtocol,
  VerificationCheck,
  VerificationChecklist,
  VerificationEvidence,
  VerificationEvidenceType,
  VerificationSummary,
  ValidationResult,
  VerificationOptions,
  ReportOptions
} from './types.js';

const execAsync = promisify(exec);

/**
 * 跨工作流使用的标准验证检查
 */
export const STANDARD_CHECKS = {
  BUILD: {
    id: 'build',
    name: 'Build Success',
    description: 'Code compiles without errors',
    evidenceType: 'build_success' as VerificationEvidenceType,
    required: true,
    command: undefined,
    completed: false
  },
  TEST: {
    id: 'test',
    name: 'Tests Pass',
    description: 'All tests pass without errors',
    evidenceType: 'test_pass' as VerificationEvidenceType,
    required: true,
    command: undefined,
    completed: false
  },
  LINT: {
    id: 'lint',
    name: 'Lint Clean',
    description: 'No linting errors',
    evidenceType: 'lint_clean' as VerificationEvidenceType,
    required: true,
    command: undefined,
    completed: false
  },
  FUNCTIONALITY: {
    id: 'functionality',
    name: 'Functionality Verified',
    description: 'All requested features work as described',
    evidenceType: 'functionality_verified' as VerificationEvidenceType,
    required: true,
    completed: false
  },
  ARCHITECT: {
    id: 'architect',
    name: 'Architect Approval',
    description: 'Architect has reviewed and approved the implementation',
    evidenceType: 'architect_approval' as VerificationEvidenceType,
    required: true,
    completed: false
  },
  TODO: {
    id: 'todo',
    name: 'TODO Complete',
    description: 'Zero pending or in_progress tasks',
    evidenceType: 'todo_complete' as VerificationEvidenceType,
    required: true,
    completed: false
  },
  ERROR_FREE: {
    id: 'error_free',
    name: 'Error Free',
    description: 'Zero unaddressed errors',
    evidenceType: 'error_free' as VerificationEvidenceType,
    required: true,
    completed: false
  }
};

/**
 * 创建验证协议
 */
export function createProtocol(
  name: string,
  description: string,
  checks: VerificationCheck[],
  strictMode = true
): VerificationProtocol {
  return {
    name,
    description,
    checks,
    strictMode
  };
}

/**
 * 根据协议创建验证清单
 */
export function createChecklist(protocol: VerificationProtocol): VerificationChecklist {
  return {
    protocol,
    startedAt: new Date(),
    checks: protocol.checks.map(check => ({ ...check })),
    status: 'pending'
  };
}

/**
 * 执行单个验证检查
 */
async function runSingleCheck(
  check: VerificationCheck,
  options: VerificationOptions = {}
): Promise<VerificationEvidence> {
  const { cwd, timeout = 60000 } = options;

  // 若检查带有命令，则执行它
  if (check.command) {
    try {
      const { stdout, stderr } = await execAsync(check.command, {
        cwd,
        timeout
      });

      return {
        type: check.evidenceType,
        passed: true,
        command: check.command,
        output: stdout || stderr,
        timestamp: new Date()
      };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string };
      return {
        type: check.evidenceType,
        passed: false,
        command: check.command,
        output: err.stdout || err.stderr,
        error: err.message,
        timestamp: new Date()
      };
    }
  }

  // 人工验证检查（无命令）— 保持为未通过，以便门禁逻辑
  // 不会自动批准。调用方可检查 metadata.status 来区分
  // "真正失败" 与 "等待人工审核"。
  return {
    type: check.evidenceType,
    passed: false,
    timestamp: new Date(),
    metadata: { requiresManualVerification: true, status: 'pending_manual_review' }
  };
}

/**
 * 执行所有验证检查
 */
export async function runVerification(
  checklist: VerificationChecklist,
  options: VerificationOptions = {}
): Promise<VerificationChecklist> {
  const { parallel = true, failFast = false, skipOptional = false } = options;

  checklist.status = 'in_progress';

  // 根据选项过滤检查
  const checksToRun = skipOptional
    ? checklist.checks.filter(c => c.required)
    : checklist.checks;

  if (parallel && !failFast) {
    // 并行执行所有检查
    const results = await Promise.allSettled(
      checksToRun.map(check => runSingleCheck(check, options))
    );

    // 用结果更新清单
    checksToRun.forEach((check, idx) => {
      const result = results[idx];
      if (result.status === 'fulfilled') {
        check.evidence = result.value;
        check.completed = true;
      } else {
        check.evidence = {
          type: check.evidenceType,
          passed: false,
          error: result.reason?.message || 'Check failed',
          timestamp: new Date()
        };
        check.completed = true;
      }
    });
  } else {
    // 顺序执行检查
    for (const check of checksToRun) {
      try {
        const evidence = await runSingleCheck(check, options);
        check.evidence = evidence;
        check.completed = true;

        // 若启用 failFast，则在首次失败时停止
        if (failFast && !evidence.passed) {
          break;
        }
      } catch (error) {
        check.evidence = {
          type: check.evidenceType,
          passed: false,
          error: (error as Error).message,
          timestamp: new Date()
        };
        check.completed = true;

        if (failFast) {
          break;
        }
      }
    }
  }

  // 生成摘要
  checklist.summary = generateSummary(checklist);
  checklist.completedAt = new Date();
  checklist.status = checklist.summary.allRequiredPassed ? 'complete' : 'failed';

  return checklist;
}

/**
 * 校验特定检查的证据
 */
export function checkEvidence(
  check: VerificationCheck,
  evidence: VerificationEvidence
): ValidationResult {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // 基础校验
  if (!evidence) {
    issues.push(`No evidence provided for check: ${check.name}`);
    recommendations.push('Run the verification check to collect evidence');
    return {
      valid: false,
      message: `Missing evidence for ${check.name}`,
      issues,
      recommendations
    };
  }

  // 检查证据类型是否匹配
  if (evidence.type !== check.evidenceType) {
    issues.push(`Evidence type mismatch: expected ${check.evidenceType}, got ${evidence.type}`);
  }

  // 检查是否通过
  if (!evidence.passed) {
    issues.push(`Check failed: ${check.name}`);
    if (evidence.error) {
      issues.push(`Error: ${evidence.error}`);
    }
    if (check.command) {
      recommendations.push(`Review command output: ${check.command}`);
    }
    recommendations.push('Fix the issue and re-run verification');
  }

  // 检查证据是否过期（超过 5 分钟）
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (evidence.timestamp < fiveMinutesAgo) {
    issues.push('Evidence is stale (older than 5 minutes)');
    recommendations.push('Re-run verification to get fresh evidence');
  }

  return {
    valid: issues.length === 0,
    message: issues.length === 0 ? `${check.name} verified successfully` : `${check.name} verification failed`,
    issues,
    recommendations
  };
}

/**
 * 生成验证结果摘要
 */
function generateSummary(checklist: VerificationChecklist): VerificationSummary {
  const total = checklist.checks.length;
  const passed = checklist.checks.filter(c => c.evidence?.passed).length;
  const failed = checklist.checks.filter(c => c.completed && !c.evidence?.passed).length;
  const skipped = checklist.checks.filter(c => !c.completed).length;

  const requiredChecks = checklist.checks.filter(c => c.required);
  const allRequiredPassed = requiredChecks.every(c => c.evidence?.passed);

  const failedChecks = checklist.checks
    .filter(c => c.completed && !c.evidence?.passed)
    .map(c => c.id);

  let verdict: 'approved' | 'rejected' | 'incomplete';
  if (skipped > 0) {
    verdict = 'incomplete';
  } else if (checklist.protocol.strictMode && failed > 0) {
    verdict = 'rejected';
  } else if (allRequiredPassed) {
    verdict = 'approved';
  } else {
    verdict = 'rejected';
  }

  return {
    total,
    passed,
    failed,
    skipped,
    allRequiredPassed,
    failedChecks,
    verdict
  };
}

/**
 * 格式化验证报告
 */
export function formatReport(
  checklist: VerificationChecklist,
  options: ReportOptions = {}
): string {
  const {
    includeEvidence = true,
    includeOutput = false,
    format = 'markdown'
  } = options;

  if (format === 'json') {
    return JSON.stringify(checklist, null, 2);
  }

  const lines: string[] = [];

  // 报告头
  if (format === 'markdown') {
    lines.push(`# Verification Report: ${checklist.protocol.name}`);
    lines.push('');
    lines.push(`**Status:** ${checklist.status}`);
    lines.push(`**Started:** ${checklist.startedAt.toISOString()}`);
    if (checklist.completedAt) {
      lines.push(`**Completed:** ${checklist.completedAt.toISOString()}`);
    }
    lines.push('');
  } else {
    lines.push(`Verification Report: ${checklist.protocol.name}`);
    lines.push(`Status: ${checklist.status}`);
    lines.push(`Started: ${checklist.startedAt.toISOString()}`);
    if (checklist.completedAt) {
      lines.push(`Completed: ${checklist.completedAt.toISOString()}`);
    }
    lines.push('');
  }

  // 摘要
  if (checklist.summary) {
    const { summary } = checklist;
    if (format === 'markdown') {
      lines.push('## Summary');
      lines.push('');
      lines.push(`- **Total Checks:** ${summary.total}`);
      lines.push(`- **Passed:** ${summary.passed}`);
      lines.push(`- **Failed:** ${summary.failed}`);
      lines.push(`- **Skipped:** ${summary.skipped}`);
      lines.push(`- **Verdict:** ${summary.verdict.toUpperCase()}`);
      lines.push('');
    } else {
      lines.push('Summary:');
      lines.push(`  Total Checks: ${summary.total}`);
      lines.push(`  Passed: ${summary.passed}`);
      lines.push(`  Failed: ${summary.failed}`);
      lines.push(`  Skipped: ${summary.skipped}`);
      lines.push(`  Verdict: ${summary.verdict.toUpperCase()}`);
      lines.push('');
    }
  }

  // 检查项
  if (format === 'markdown') {
    lines.push('## Checks');
    lines.push('');
  } else {
    lines.push('Checks:');
  }

  for (const check of checklist.checks) {
    const status = check.evidence?.passed ? '✓' : check.completed ? '✗' : '○';
    const required = check.required ? '(required)' : '(optional)';

    if (format === 'markdown') {
      lines.push(`### ${status} ${check.name} ${required}`);
      lines.push('');
      lines.push(check.description);
      lines.push('');
    } else {
      lines.push(`  ${status} ${check.name} ${required}`);
      lines.push(`     ${check.description}`);
    }

    if (includeEvidence && check.evidence) {
      if (format === 'markdown') {
        lines.push('**Evidence:**');
        lines.push(`- Passed: ${check.evidence.passed}`);
        lines.push(`- Timestamp: ${check.evidence.timestamp.toISOString()}`);
        if (check.evidence.command) {
          lines.push(`- Command: \`${check.evidence.command}\``);
        }
        if (check.evidence.error) {
          lines.push(`- Error: ${check.evidence.error}`);
        }
      } else {
        lines.push(`     Evidence: ${check.evidence.passed ? 'PASSED' : 'FAILED'}`);
        if (check.evidence.error) {
          lines.push(`     Error: ${check.evidence.error}`);
        }
      }

      if (includeOutput && check.evidence.output) {
        if (format === 'markdown') {
          lines.push('');
          lines.push('**Output:**');
          lines.push('```');
          lines.push(check.evidence.output.trim());
          lines.push('```');
        } else {
          lines.push(`     Output: ${check.evidence.output.substring(0, 100)}...`);
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 校验整个清单
 */
export async function validateChecklist(
  checklist: VerificationChecklist
): Promise<ValidationResult> {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // 检查验证是否完成
  if (checklist.status !== 'complete' && checklist.status !== 'failed') {
    issues.push('Verification is not complete');
    recommendations.push('Run verification to completion before validating');
    return {
      valid: false,
      message: 'Incomplete verification',
      issues,
      recommendations
    };
  }

  // 校验每个检查
  for (const check of checklist.checks) {
    if (!check.evidence) {
      if (check.required) {
        issues.push(`Missing evidence for required check: ${check.name}`);
        recommendations.push(`Run verification check: ${check.name}`);
      }
      continue;
    }

    const validation = checkEvidence(check, check.evidence);
    if (!validation.valid && check.required) {
      issues.push(...validation.issues);
      if (validation.recommendations) {
        recommendations.push(...validation.recommendations);
      }
    }
  }

  // 若提供了自定义校验器则运行
  if (checklist.protocol.customValidator) {
    const customResult = await checklist.protocol.customValidator(checklist);
    if (!customResult.valid) {
      issues.push(...customResult.issues);
      if (customResult.recommendations) {
        recommendations.push(...customResult.recommendations);
      }
    }
  }

  return {
    valid: issues.length === 0,
    message: issues.length === 0 ? 'All verifications passed' : 'Some verifications failed',
    issues,
    recommendations
  };
}

// 重新导出类型
export type {
  VerificationProtocol,
  VerificationCheck,
  VerificationChecklist,
  VerificationEvidence,
  VerificationEvidenceType,
  VerificationSummary,
  ValidationResult,
  VerificationOptions,
  ReportOptions
} from './types.js';
