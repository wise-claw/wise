/**
 * Factcheck 守卫 - 主入口
 *
 * 可移植的 factcheck 引擎，根据可配置的策略校验 claims 负载。
 * 移植自 rolldav/portable-wise-guards（issue #1155）。
 *
 * 模式：
 *   - strict:   所有 gate 必须为 true，cwd 不一致为 FAIL
 *   - declared: 若存在源文件，则对 false gate 发出告警
 *   - manual:   同 declared
 *   - quick:    默认跳过 cwd 一致性检查
 */

import type {
  FactcheckMode,
  FactcheckPolicy,
  FactcheckResult,
  Mismatch,
  Severity,
} from './types.js';
import {
  checkMissingFields,
  checkMissingGates,
  getFalseGates,
  sourceFileCount,
  checkPaths,
  checkCommands,
  checkCwdParity,
} from './checks.js';
import { loadGuardsConfig } from './config.js';

export type {
  FactcheckClaims,
  FactcheckMode,
  FactcheckPolicy,
  FactcheckResult,
  Mismatch,
  Severity,
} from './types.js';
export { loadGuardsConfig, shouldUseStrictMode } from './config.js';

// ---------------------------------------------------------------------------
// 严重级别排序
// ---------------------------------------------------------------------------

function severityRank(value: Severity): number {
  if (value === 'FAIL') return 2;
  if (value === 'WARN') return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// 主检查运行器
// ---------------------------------------------------------------------------

/**
 * 对 claims 负载运行可移植的 factcheck 逻辑。
 *
 * @param claims     - 待校验的 claims 负载
 * @param mode       - 校验模式：strict | declared | manual | quick
 * @param policy     - Factcheck 策略（从配置加载或直接提供）
 * @param runtimeCwd - 运行时工作目录（默认为 process.cwd()）
 * @returns 包含判定结果、不匹配项、备注和证据的 Factcheck 结果
 */
export function runChecks(
  claims: Record<string, unknown>,
  mode: FactcheckMode,
  policy: FactcheckPolicy,
  runtimeCwd?: string,
): FactcheckResult {
  const mismatches: Mismatch[] = [];
  const notes: string[] = [];

  // A. 缺失必需字段
  const missingFields = checkMissingFields(claims);
  if (missingFields.length > 0) {
    mismatches.push({
      check: 'A',
      severity: 'FAIL',
      detail: `Missing required fields: ${JSON.stringify(missingFields)}`,
    });
  }

  // A. 缺失必需 gate
  const missingGates = checkMissingGates(claims);
  if (missingGates.length > 0) {
    mismatches.push({
      check: 'A',
      severity: 'FAIL',
      detail: `Missing required gates: ${JSON.stringify(missingGates)}`,
    });
  }

  // B. gate 值检查
  const falseGates = getFalseGates(claims);
  const srcFiles = sourceFileCount(claims);

  if (mode === 'strict' && falseGates.length > 0) {
    mismatches.push({
      check: 'B',
      severity: 'FAIL',
      detail: `Strict mode requires all gates true, got false: ${JSON.stringify(falseGates)}`,
    });
  } else if (
    (mode === 'declared' || mode === 'manual') &&
    falseGates.length > 0 &&
    policy.warn_on_unverified_gates
  ) {
    if (srcFiles > 0 || policy.warn_on_unverified_gates_when_no_source_files) {
      mismatches.push({
        check: 'B',
        severity: 'WARN',
        detail: `Unverified gates in declared/manual mode: ${JSON.stringify(falseGates)}`,
      });
    } else {
      notes.push('No source files declared; unverified gates are ignored by policy');
    }
  }

  // H/C. 路径检查
  mismatches.push(...checkPaths(claims, policy));

  // H. 命令检查
  mismatches.push(...checkCommands(claims, policy));

  // CWD 一致性
  const claimsCwd = String(claims.cwd ?? '').trim();
  const cwdMismatch = checkCwdParity(
    claimsCwd,
    runtimeCwd ?? process.cwd(),
    mode,
    policy,
  );
  if (cwdMismatch) {
    mismatches.push(cwdMismatch);
  }

  // 根据最严重的级别计算判定结果
  const maxRank = mismatches.reduce(
    (max, m) => Math.max(max, severityRank(m.severity)),
    0,
  );
  let verdict: Severity = 'PASS';
  if (maxRank === 2) verdict = 'FAIL';
  else if (maxRank === 1) verdict = 'WARN';

  return {
    verdict,
    mode,
    mismatches,
    notes,
    claims_evidence: {
      source_files: srcFiles,
      commands_count: ((claims.commands_executed as string[]) ?? []).length,
      models_count: ((claims.models_used as string[]) ?? []).length,
    },
  };
}

/**
 * 便捷封装：加载配置并在一次调用中运行检查。
 */
export function runFactcheck(
  claims: Record<string, unknown>,
  options?: {
    mode?: FactcheckMode;
    runtimeCwd?: string;
    workspace?: string;
  },
): FactcheckResult {
  const config = loadGuardsConfig(options?.workspace);
  const mode = options?.mode ?? (config.factcheck.mode as FactcheckMode);
  return runChecks(claims, mode, config.factcheck, options?.runtimeCwd);
}
