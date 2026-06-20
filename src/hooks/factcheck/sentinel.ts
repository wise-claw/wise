/**
 * Sentinel 健康分析器
 *
 * 解析 sentinel 运行记录的 JSONL 日志文件，并计算就绪度统计。
 * 移植自 sentinel_health.py（issue #1155）。
 */

import { readFileSync, existsSync } from 'fs';
import type {
  SentinelLogEntry,
  SentinelStats,
  SentinelReadinessResult,
  SentinelReadinessPolicy,
} from './types.js';
import { loadGuardsConfig } from './config.js';

// ---------------------------------------------------------------------------
// 统计计算辅助函数
// ---------------------------------------------------------------------------

function computeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function getPassRate(stats: SentinelStats): number {
  return computeRate(stats.pass_count, stats.total_runs);
}

export function getTimeoutRate(stats: SentinelStats): number {
  return computeRate(stats.timeout_count, stats.total_runs);
}

export function getWarnPlusFailRate(stats: SentinelStats): number {
  return computeRate(stats.warn_count + stats.fail_count, stats.total_runs);
}

export function getReasonCoverageRate(stats: SentinelStats): number {
  return computeRate(stats.reason_coverage_count, stats.total_runs);
}

// ---------------------------------------------------------------------------
// 日志条目辅助函数
// ---------------------------------------------------------------------------

/**
 * 将判定字符串归一化为 PASS、WARN 或 FAIL。
 */
function extractVerdict(entry: SentinelLogEntry): 'PASS' | 'WARN' | 'FAIL' {
  const raw = String(entry.verdict ?? '').toUpperCase().trim();
  if (raw === 'PASS') return 'PASS';
  if (raw === 'WARN') return 'WARN';
  return 'FAIL';
}

/**
 * 检查日志条目是否带有 reason/explanation。
 */
function hasReason(entry: SentinelLogEntry): boolean {
  return !!(entry.reason || entry.error || entry.message);
}

/**
 * 检查日志条目是否表明发生了超时。
 */
function isTimeout(entry: SentinelLogEntry): boolean {
  if (entry.runtime?.timed_out === true) return true;
  if (entry.runtime?.global_timeout === true) return true;
  const reason = String(entry.reason ?? '').toLowerCase();
  return reason.includes('timeout');
}

// ---------------------------------------------------------------------------
// 日志分析
// ---------------------------------------------------------------------------

/**
 * 解析 JSONL 日志文件并计算聚合的 sentinel 统计数据。
 *
 * @param logPath - JSONL 日志文件路径
 * @returns 聚合后的 sentinel 统计数据
 */
export function analyzeLog(logPath: string): SentinelStats {
  const stats: SentinelStats = {
    total_runs: 0,
    pass_count: 0,
    warn_count: 0,
    fail_count: 0,
    timeout_count: 0,
    reason_coverage_count: 0,
  };

  if (!existsSync(logPath)) {
    return stats;
  }

  let content: string;
  try {
    content = readFileSync(logPath, 'utf-8');
  } catch {
    return stats;
  }

  const lines = content.split('\n').filter(line => line.trim().length > 0);

  for (const line of lines) {
    let entry: SentinelLogEntry;
    try {
      entry = JSON.parse(line) as SentinelLogEntry;
    } catch {
      // 跳过格式错误的行
      continue;
    }

    stats.total_runs++;

    const verdict = extractVerdict(entry);
    if (verdict === 'PASS') stats.pass_count++;
    else if (verdict === 'WARN') stats.warn_count++;
    else stats.fail_count++;

    if (isTimeout(entry)) stats.timeout_count++;
    if (hasReason(entry)) stats.reason_coverage_count++;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// 就绪度检查
// ---------------------------------------------------------------------------

/**
 * 根据可配置的阈值判定 sentinel 信号是否已就绪可上游使用。
 *
 * @param stats  - 计算得到的 sentinel 统计数据
 * @param policy - 就绪度阈值（来自配置或直接提供）
 * @returns 元组 [ready, blockers] —— 所有阈值均满足时 ready 为 true
 */
export function isUpstreamReady(
  stats: SentinelStats,
  policy: SentinelReadinessPolicy,
): [boolean, string[]] {
  const blockers: string[] = [];

  const passRate = getPassRate(stats);
  if (passRate < policy.min_pass_rate) {
    blockers.push(
      `pass_rate ${passRate.toFixed(3)} < min ${policy.min_pass_rate}`,
    );
  }

  const timeoutRate = getTimeoutRate(stats);
  if (timeoutRate > policy.max_timeout_rate) {
    blockers.push(
      `timeout_rate ${timeoutRate.toFixed(3)} > max ${policy.max_timeout_rate}`,
    );
  }

  const warnFailRate = getWarnPlusFailRate(stats);
  if (warnFailRate > policy.max_warn_plus_fail_rate) {
    blockers.push(
      `warn_plus_fail_rate ${warnFailRate.toFixed(3)} > max ${policy.max_warn_plus_fail_rate}`,
    );
  }

  const reasonRate = getReasonCoverageRate(stats);
  if (reasonRate < policy.min_reason_coverage_rate) {
    blockers.push(
      `reason_coverage_rate ${reasonRate.toFixed(3)} < min ${policy.min_reason_coverage_rate}`,
    );
  }

  return [blockers.length === 0, blockers];
}

/**
 * 便捷封装：分析日志文件并检查就绪度。
 */
export function checkSentinelHealth(
  logPath: string,
  workspace?: string,
): SentinelReadinessResult {
  const config = loadGuardsConfig(workspace);
  const stats = analyzeLog(logPath);
  const [ready, blockers] = isUpstreamReady(stats, config.sentinel.readiness);
  return { ready, blockers, stats };
}
