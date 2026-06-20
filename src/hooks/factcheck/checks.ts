/**
 * Factcheck 守卫 - 单项检查函数
 *
 * 每个函数校验 claims 负载的某个特定方面，并返回不匹配项列表。
 * 移植自 factcheck.py。
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import type {
  FactcheckPolicy,
  Mismatch,
  FactcheckMode,
} from './types.js';
import { REQUIRED_FIELDS, REQUIRED_GATES } from './types.js';

// ---------------------------------------------------------------------------
// Schema 校验
// ---------------------------------------------------------------------------

/**
 * 检查缺失的必需顶层字段。
 */
export function checkMissingFields(claims: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in claims)) {
      missing.push(field);
    }
  }
  return missing.sort();
}

/**
 * 检查缺失的必需 gate。
 */
export function checkMissingGates(claims: Record<string, unknown>): string[] {
  const gates = (claims.gates ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  for (const gate of REQUIRED_GATES) {
    if (!(gate in gates)) {
      missing.push(gate);
    }
  }
  return missing.sort();
}

// ---------------------------------------------------------------------------
// Gate 检查
// ---------------------------------------------------------------------------

/**
 * 获取值为 false 的必需 gate。
 */
export function getFalseGates(claims: Record<string, unknown>): string[] {
  const gates = (claims.gates ?? {}) as Record<string, boolean>;
  const falseGates: string[] = [];
  for (const gate of REQUIRED_GATES) {
    if (gate in gates && !gates[gate]) {
      falseGates.push(gate);
    }
  }
  return falseGates.sort();
}

/**
 * 统计源文件数量（modified + created）。
 */
export function sourceFileCount(claims: Record<string, unknown>): number {
  const modified = (claims.files_modified as string[]) ?? [];
  const created = (claims.files_created as string[]) ?? [];
  return modified.length + created.length;
}

// ---------------------------------------------------------------------------
// 路径检查
// ---------------------------------------------------------------------------

/**
 * 检查文件路径是否包含禁止前缀/子串，以及路径是否存在。
 */
export function checkPaths(
  claims: Record<string, unknown>,
  policy: FactcheckPolicy,
): Mismatch[] {
  const out: Mismatch[] = [];

  const allPaths: string[] = [
    ...((claims.files_modified as string[]) ?? []),
    ...((claims.files_created as string[]) ?? []),
    ...((claims.artifacts_expected as string[]) ?? []),
  ];
  const deleted = new Set((claims.files_deleted as string[]) ?? []);

  for (const pathStr of allPaths) {
    if (deleted.has(pathStr)) continue;

    let prefixBlocked = false;
    for (const prefix of policy.forbidden_path_prefixes) {
      if (pathStr.startsWith(prefix)) {
        out.push({ check: 'H', severity: 'FAIL', detail: `Forbidden path prefix: ${pathStr}` });
        prefixBlocked = true;
        break;
      }
    }

    if (!prefixBlocked) {
      for (const fragment of policy.forbidden_path_substrings) {
        if (pathStr.includes(fragment)) {
          out.push({ check: 'H', severity: 'FAIL', detail: `Forbidden path fragment: ${pathStr}` });
          break;
        }
      }
    }

    if (!existsSync(pathStr)) {
      out.push({ check: 'C', severity: 'FAIL', detail: `File not found: ${pathStr}` });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 命令检查
// ---------------------------------------------------------------------------

/**
 * 检查已执行命令中是否存在禁止的变更操作。
 */
export function checkCommands(
  claims: Record<string, unknown>,
  policy: FactcheckPolicy,
): Mismatch[] {
  const out: Mismatch[] = [];
  const commands = ((claims.commands_executed as string[]) ?? []).map(String);

  for (const cmd of commands) {
    const hitPrefix = policy.forbidden_path_prefixes.some(
      forbidden => cmd.includes(forbidden),
    );
    if (!hitPrefix) continue;

    const stripped = cmd.trim().replace(/^\(/, '');
    const isReadOnly = policy.readonly_command_prefixes.some(
      prefix => stripped.startsWith(prefix),
    );
    if (!isReadOnly) {
      out.push({ check: 'H', severity: 'FAIL', detail: `Forbidden mutating command: ${cmd}` });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// CWD 一致性检查
// ---------------------------------------------------------------------------

/**
 * 检查 claims.cwd 是否与运行时工作目录一致。
 */
export function checkCwdParity(
  claimsCwd: string,
  runtimeCwd: string,
  mode: FactcheckMode,
  policy: FactcheckPolicy,
): Mismatch | null {
  const enforceCwd = policy.warn_on_cwd_mismatch && (
    mode !== 'quick' || policy.enforce_cwd_parity_in_quick
  );

  if (!enforceCwd || !claimsCwd) return null;

  const claimsCwdCanonical = resolve(claimsCwd);
  const runtimeCwdCanonical = resolve(runtimeCwd);

  if (claimsCwdCanonical !== runtimeCwdCanonical) {
    const severity = mode === 'strict' ? 'FAIL' : 'WARN';
    return {
      check: 'argv_parity',
      severity,
      detail: `claims.cwd=${claimsCwdCanonical} runtime.cwd=${runtimeCwdCanonical}`,
    };
  }

  return null;
}
