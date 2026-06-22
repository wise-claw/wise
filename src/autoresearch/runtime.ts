import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, symlink, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { getWiseRoot } from '../lib/worktree-paths.js';
import {
  readModeState,
  writeModeState,
} from '../lib/mode-state-io.js';
import { isModeActiveInAnySession } from '../hooks/mode-registry/index.js';
import type { ExecutionMode } from '../hooks/mode-registry/types.js';
import {
  parseEvaluatorResult,
  type AutoresearchKeepPolicy,
  type AutoresearchMissionContract,
} from './contracts.js';

export type AutoresearchCandidateStatus = 'candidate' | 'noop' | 'abort' | 'interrupted';
export type AutoresearchDecisionStatus = 'baseline' | 'keep' | 'discard' | 'ambiguous' | 'noop' | 'abort' | 'interrupted' | 'error';
export type AutoresearchRunStatus = 'running' | 'stopped' | 'completed' | 'failed';

export interface PreparedAutoresearchRuntime {
  runId: string;
  runTag: string;
  runDir: string;
  instructionsFile: string;
  manifestFile: string;
  ledgerFile: string;
  latestEvaluatorFile: string;
  resultsFile: string;
  stateFile: string;
  candidateFile: string;
  repoRoot: string;
  worktreePath: string;
  taskDescription: string;
}

export interface AutoresearchEvaluationRecord {
  command: string;
  ran_at: string;
  status: 'pass' | 'fail' | 'error';
  pass?: boolean;
  score?: number;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  parse_error?: string;
}

export interface AutoresearchCandidateArtifact {
  status: AutoresearchCandidateStatus;
  candidate_commit: string | null;
  base_commit: string;
  description: string;
  notes: string[];
  created_at: string;
}

export interface AutoresearchLedgerEntry {
  iteration: number;
  kind: 'baseline' | 'iteration';
  decision: AutoresearchDecisionStatus;
  decision_reason: string;
  candidate_status: AutoresearchCandidateStatus | 'baseline';
  base_commit: string;
  candidate_commit: string | null;
  kept_commit: string;
  keep_policy: AutoresearchKeepPolicy;
  evaluator: AutoresearchEvaluationRecord | null;
  created_at: string;
  notes: string[];
  description: string;
}

export interface AutoresearchRunManifest {
  schema_version: 1;
  run_id: string;
  run_tag: string;
  mission_dir: string;
  mission_file: string;
  sandbox_file: string;
  repo_root: string;
  worktree_path: string;
  mission_slug: string;
  branch_name: string;
  baseline_commit: string;
  last_kept_commit: string;
  last_kept_score: number | null;
  latest_candidate_commit: string | null;
  results_file: string;
  instructions_file: string;
  manifest_file: string;
  ledger_file: string;
  latest_evaluator_file: string;
  candidate_file: string;
  evaluator: AutoresearchMissionContract['sandbox']['evaluator'];
  keep_policy: AutoresearchKeepPolicy;
  status: AutoresearchRunStatus;
  stop_reason: string | null;
  iteration: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AutoresearchActiveRunState {
  schema_version: 1;
  active: boolean;
  run_id: string | null;
  mission_slug: string | null;
  repo_root: string;
  worktree_path: string | null;
  status: AutoresearchRunStatus | 'idle';
  updated_at: string;
  completed_at?: string;
}

export interface AutoresearchMissionArtifactLayout {
  missionRoot: string;
  missionSpecFile: string;
  evaluatorReferenceFile: string;
  runsDir: string;
  runDir: string;
  evaluationsDir: string;
  decisionLogFile: string;
}

interface AutoresearchDecision {
  decision: AutoresearchDecisionStatus;
  decisionReason: string;
  keep: boolean;
  evaluator: AutoresearchEvaluationRecord | null;
  notes: string[];
}

interface AutoresearchInstructionLedgerSummary {
  iteration: number;
  decision: AutoresearchDecisionStatus;
  reason: string;
  kept_commit: string;
  candidate_commit: string | null;
  evaluator_status: AutoresearchEvaluationRecord['status'] | null;
  evaluator_score: number | null;
  description: string;
}

const AUTORESEARCH_RESULTS_HEADER = 'iteration\tcommit\tpass\tscore\tstatus\tdescription\n';
const AUTORESEARCH_WORKTREE_EXCLUDES = ['results.tsv', 'run.log', 'node_modules', '.wise/'];

// 不能与 autoresearch 并发运行的互斥模式
const EXCLUSIVE_MODES: ExecutionMode[] = ['ralph', 'ultrawork', 'autopilot', 'autoresearch'];

function nowIso(): string {
  return new Date().toISOString();
}

export function getAutoresearchMissionArtifactLayout(
  projectRoot: string,
  missionSlug: string,
  runId: string,
): AutoresearchMissionArtifactLayout {
  const missionRoot = join(getWiseRoot(projectRoot), 'autoresearch', missionSlug);
  const runDir = join(missionRoot, 'runs', runId);
  return {
    missionRoot,
    missionSpecFile: join(missionRoot, 'mission.md'),
    evaluatorReferenceFile: join(missionRoot, 'evaluator.json'),
    runsDir: join(missionRoot, 'runs'),
    runDir,
    evaluationsDir: join(runDir, 'evaluations'),
    decisionLogFile: join(runDir, 'decision-log.md'),
  };
}

export function buildAutoresearchRunTag(date = new Date()): string {
  const iso = date.toISOString();
  return iso
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', 'T');
}

function buildRunId(missionSlug: string, runTag: string): string {
  return `${missionSlug}-${runTag.toLowerCase()}`;
}

function activeRunStateFile(projectRoot: string): string {
  return join(getWiseRoot(projectRoot), 'state', 'autoresearch-state.json');
}

function trimContent(value: string, max = 4000): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n...`;
}

function readGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    const stderr = typeof err.stderr === 'string'
      ? err.stderr.trim()
      : err.stderr instanceof Buffer
        ? err.stderr.toString('utf-8').trim()
        : '';
    throw new Error(stderr || `git ${args.join(' ')} 失败`);
  }
}

function tryResolveGitCommit(worktreePath: string, ref: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: worktreePath,
    encoding: 'utf-8',
  });
  if (result.status !== 0) return null;
  const resolved = (result.stdout || '').trim();
  return resolved || null;
}

async function writeGitInfoExclude(worktreePath: string, pattern: string): Promise<void> {
  const excludePath = readGit(worktreePath, ['rev-parse', '--git-path', 'info/exclude']);
  const existing = existsSync(excludePath)
    ? await readFile(excludePath, 'utf-8')
    : '';
  const lines = new Set(existing.split(/\r?\n/).filter(Boolean));
  if (lines.has(pattern)) return;
  const next = `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${pattern}\n`;
  await ensureParentDir(excludePath);
  await writeFile(excludePath, next, 'utf-8');
}

async function ensureRuntimeExcludes(worktreePath: string): Promise<void> {
  for (const file of AUTORESEARCH_WORKTREE_EXCLUDES) {
    await writeGitInfoExclude(worktreePath, file);
  }
}

async function appendDecisionLog(
  decisionLogFile: string,
  entry: {
    iteration: number;
    decision: AutoresearchDecisionStatus | 'baseline';
    description: string;
    reason: string;
    evaluator?: AutoresearchEvaluationRecord | null;
    notes?: string[];
  },
): Promise<void> {
  const lines = [
    `## 迭代 ${entry.iteration} — ${entry.decision}`,
    '',
    `- 描述：${entry.description}`,
    `- 原因：${entry.reason}`,
  ];

  if (entry.evaluator) {
    lines.push(
      `- 评估器状态：${entry.evaluator.status}`,
      `- 通过：${String(entry.evaluator.pass ?? '')}`,
      `- 分数：${typeof entry.evaluator.score === 'number' ? String(entry.evaluator.score) : ''}`,
    );
  }

  if (entry.notes && entry.notes.length > 0) {
    lines.push('- 备注：');
    for (const note of entry.notes) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push('', '');
  const existing = existsSync(decisionLogFile)
    ? await readFile(decisionLogFile, 'utf-8')
    : '# Autoresearch 决策日志\n\n';
  await ensureParentDir(decisionLogFile);
  await writeFile(decisionLogFile, `${existing}${lines.join('\n')}`, 'utf-8');
}

async function ensureAutoresearchWorktreeDependencies(repoRoot: string, worktreePath: string): Promise<void> {
  const sourceNodeModules = join(repoRoot, 'node_modules');
  const targetNodeModules = join(worktreePath, 'node_modules');
  if (!existsSync(sourceNodeModules) || existsSync(targetNodeModules)) {
    return;
  }
  await symlink(sourceNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
}

function readGitShortHead(worktreePath: string): string {
  return readGit(worktreePath, ['rev-parse', '--short=7', 'HEAD']);
}

function readGitFullHead(worktreePath: string): string {
  return readGit(worktreePath, ['rev-parse', 'HEAD']);
}

function requireGitSuccess(worktreePath: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: worktreePath,
    encoding: 'utf-8',
  });
  if (result.status === 0) return;
  throw new Error((result.stderr || '').trim() || `git ${args.join(' ')} 失败`);
}

function gitStatusLines(worktreePath: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: worktreePath,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || `git status 对 ${worktreePath} 失败`);
  }
  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function normalizeGitStatusPath(path: string): string {
  return path.startsWith('\"') && path.endsWith('\"')
    ? path.slice(1, -1).replace(/\\\"/g, '\"')
    : path;
}

function isAllowedRuntimeDirtyPath(path: string): boolean {
  return AUTORESEARCH_WORKTREE_EXCLUDES.some((exclude) => exclude.endsWith('/')
    ? path.startsWith(exclude) || path === exclude.slice(0, -1)
    : path === exclude);
}

function allowedBootstrapDirtyPaths(
  worktreePath: string,
  allowedDirtyPaths: readonly string[] = [],
): Set<string> {
  const normalizedWorktreePath = resolve(worktreePath);
  return new Set(
    allowedDirtyPaths
      .map((path) => {
        const normalizedPath = resolve(path);
        return normalizedPath.startsWith(`${normalizedWorktreePath}/`)
          ? normalizedPath.slice(normalizedWorktreePath.length + 1)
          : null;
      })
      .filter((path): path is string => Boolean(path)),
  );
}

function isAllowedRuntimeDirtyLine(
  line: string,
  allowedBootstrapPaths: ReadonlySet<string>,
): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4) return false;
  const path = normalizeGitStatusPath(trimmed.slice(3).trim());
  if (!trimmed.startsWith('?? ')) return false;
  return isAllowedRuntimeDirtyPath(path) || allowedBootstrapPaths.has(path);
}

export function assertResetSafeWorktree(worktreePath: string, allowedDirtyPaths: readonly string[] = []): void {
  const lines = gitStatusLines(worktreePath);
  const allowedBootstrapPaths = allowedBootstrapDirtyPaths(worktreePath, allowedDirtyPaths);
  const blocking = lines.filter((line) => !isAllowedRuntimeDirtyLine(line, allowedBootstrapPaths));
  if (blocking.length === 0) return;
  throw new Error(`autoresearch_reset_requires_clean_worktree:${worktreePath}:${blocking.join(' | ')}`);
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf-8')) as T;
}

async function readActiveRunState(projectRoot: string): Promise<AutoresearchActiveRunState | null> {
  const file = activeRunStateFile(projectRoot);
  if (!existsSync(file)) return null;
  return readJsonFile<AutoresearchActiveRunState>(file);
}

async function writeActiveRunState(projectRoot: string, value: AutoresearchActiveRunState): Promise<void> {
  await writeJsonFile(activeRunStateFile(projectRoot), value);
}

async function assertAutoresearchLockAvailable(projectRoot: string): Promise<void> {
  const state = await readActiveRunState(projectRoot);
  if (state?.active && state.run_id) {
    throw new Error(`autoresearch_active_run_exists:${state.run_id}`);
  }
}

/**
 * 断言没有其他互斥模式（ralph、ultrawork、autopilot）已处于活跃状态。
 * 借助 WISE 的 mode-state-io 复刻 OMX 的 assertModeStartAllowed 语义。
 */
export async function assertModeStartAllowed(mode: ExecutionMode, projectRoot: string): Promise<void> {
  for (const other of EXCLUSIVE_MODES) {
    if (other === mode) continue;
    if (isModeActiveInAnySession(other, projectRoot)) {
      throw new Error(`无法启动 ${mode}：${other} 已处于活跃状态`);
    }
  }
}

async function activateAutoresearchRun(manifest: AutoresearchRunManifest): Promise<void> {
  await writeActiveRunState(manifest.repo_root, {
    schema_version: 1,
    active: true,
    run_id: manifest.run_id,
    mission_slug: manifest.mission_slug,
    repo_root: manifest.repo_root,
    worktree_path: manifest.worktree_path,
    status: manifest.status,
    updated_at: nowIso(),
  });
}

async function deactivateAutoresearchRun(manifest: AutoresearchRunManifest): Promise<void> {
  const previous = await readActiveRunState(manifest.repo_root);
  await writeActiveRunState(manifest.repo_root, {
    schema_version: 1,
    active: false,
    run_id: previous?.run_id ?? manifest.run_id,
    mission_slug: previous?.mission_slug ?? manifest.mission_slug,
    repo_root: manifest.repo_root,
    worktree_path: previous?.worktree_path ?? manifest.worktree_path,
    status: manifest.status,
    updated_at: nowIso(),
    completed_at: nowIso(),
  });
}

/**
 * 使用 WISE 的 writeModeState 启动 autoresearch 模式状态。
 */
function startAutoresearchMode(taskDescription: string, projectRoot: string): void {
  writeModeState('autoresearch', {
    active: true,
    mode: 'autoresearch',
    iteration: 0,
    current_phase: 'starting',
    task_description: taskDescription,
    started_at: nowIso(),
    updated_at: nowIso(),
  }, projectRoot);
}

/**
 * 更新 autoresearch 模式状态（合并语义）。
 */
function updateAutoresearchMode(updates: Record<string, unknown>, projectRoot: string): void {
  const current = readModeState<Record<string, unknown>>('autoresearch', projectRoot);
  if (!current) return;
  writeModeState('autoresearch', { ...current, ...updates, updated_at: nowIso() }, projectRoot);
}

/**
 * 取消 autoresearch 模式状态。
 */
function cancelAutoresearchMode(projectRoot: string): void {
  const state = readModeState<Record<string, unknown>>('autoresearch', projectRoot);
  if (state && state.active) {
    writeModeState('autoresearch', {
      ...state,
      active: false,
      current_phase: 'cancelled',
      completed_at: nowIso(),
      updated_at: nowIso(),
    }, projectRoot);
  }
}

function resultPassValue(value: boolean | undefined): string {
  return value === undefined ? '' : String(value);
}

function resultScoreValue(value: number | undefined | null): string {
  return typeof value === 'number' ? String(value) : '';
}

async function initializeAutoresearchResultsFile(resultsFile: string): Promise<void> {
  if (existsSync(resultsFile)) return;
  await ensureParentDir(resultsFile);
  await writeFile(resultsFile, AUTORESEARCH_RESULTS_HEADER, 'utf-8');
}

async function appendAutoresearchResultsRow(
  resultsFile: string,
  row: {
    iteration: number;
    commit: string;
    pass?: boolean;
    score?: number | null;
    status: AutoresearchDecisionStatus;
    description: string;
  },
): Promise<void> {
  const existing = existsSync(resultsFile)
    ? await readFile(resultsFile, 'utf-8')
    : AUTORESEARCH_RESULTS_HEADER;
  await writeFile(
    resultsFile,
    `${existing}${row.iteration}\t${row.commit}\t${resultPassValue(row.pass)}\t${resultScoreValue(row.score)}\t${row.status}\t${row.description}\n`,
    'utf-8',
  );
}

async function appendAutoresearchLedgerEntry(ledgerFile: string, entry: AutoresearchLedgerEntry): Promise<void> {
  const parsed = existsSync(ledgerFile)
    ? await readJsonFile<{
      schema_version?: number;
      run_id?: string;
      created_at?: string;
      updated_at?: string;
      entries?: AutoresearchLedgerEntry[];
    }>(ledgerFile)
    : { schema_version: 1, entries: [] };
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  entries.push(entry);
  await writeJsonFile(ledgerFile, {
    schema_version: typeof parsed.schema_version === 'number' ? parsed.schema_version : 1,
    run_id: parsed.run_id,
    created_at: parsed.created_at || nowIso(),
    updated_at: nowIso(),
    entries,
  });
}

async function readAutoresearchLedgerEntries(ledgerFile: string): Promise<AutoresearchLedgerEntry[]> {
  if (!existsSync(ledgerFile)) return [];
  const parsed = await readJsonFile<{ entries?: AutoresearchLedgerEntry[] }>(ledgerFile);
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

export async function countTrailingAutoresearchNoops(ledgerFile: string): Promise<number> {
  const entries = await readAutoresearchLedgerEntries(ledgerFile);
  let count = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.kind !== 'iteration' || entry.decision !== 'noop') break;
    count += 1;
  }
  return count;
}

function formatAutoresearchInstructionSummary(
  entries: AutoresearchLedgerEntry[],
  maxEntries = 3,
): AutoresearchInstructionLedgerSummary[] {
  return entries
    .slice(-maxEntries)
    .map((entry) => ({
      iteration: entry.iteration,
      decision: entry.decision,
      reason: trimContent(entry.decision_reason, 160),
      kept_commit: entry.kept_commit,
      candidate_commit: entry.candidate_commit,
      evaluator_status: entry.evaluator?.status ?? null,
      evaluator_score: typeof entry.evaluator?.score === 'number' ? entry.evaluator.score : null,
      description: trimContent(entry.description, 120),
    }));
}

async function buildAutoresearchInstructionContext(manifest: AutoresearchRunManifest): Promise<{
  previousIterationOutcome: string | null;
  recentLedgerSummary: AutoresearchInstructionLedgerSummary[];
}> {
  const entries = await readAutoresearchLedgerEntries(manifest.ledger_file);
  const previous = entries.at(-1);
  return {
    previousIterationOutcome: previous
      ? `${previous.decision}:${trimContent(previous.decision_reason, 160)}`
      : null,
    recentLedgerSummary: formatAutoresearchInstructionSummary(entries),
  };
}

export async function runAutoresearchEvaluator(
  contract: AutoresearchMissionContract,
  worktreePath: string,
  ledgerFile?: string,
  latestEvaluatorFile?: string,
): Promise<AutoresearchEvaluationRecord> {
  const ran_at = nowIso();
  const result = spawnSync(contract.sandbox.evaluator.command, {
    cwd: worktreePath,
    encoding: 'utf-8',
    shell: true,
    maxBuffer: 1024 * 1024,
  });
  const stdout = result.stdout?.trim() || '';
  const stderr = result.stderr?.trim() || '';

  let record: AutoresearchEvaluationRecord;
  if (result.error || result.status !== 0) {
    record = {
      command: contract.sandbox.evaluator.command,
      ran_at,
      status: 'error',
      exit_code: result.status,
      stdout,
      stderr: result.error ? [stderr, result.error.message].filter(Boolean).join('\n') : stderr,
    };
  } else {
    try {
      const parsed = parseEvaluatorResult(stdout);
      record = {
        command: contract.sandbox.evaluator.command,
        ran_at,
        status: parsed.pass ? 'pass' : 'fail',
        pass: parsed.pass,
        ...(parsed.score !== undefined ? { score: parsed.score } : {}),
        exit_code: result.status,
        stdout,
        stderr,
      };
    } catch (error) {
      record = {
        command: contract.sandbox.evaluator.command,
        ran_at,
        status: 'error',
        exit_code: result.status,
        stdout,
        stderr,
        parse_error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (latestEvaluatorFile) {
    await writeJsonFile(latestEvaluatorFile, record);
  }
  if (ledgerFile) {
    await appendAutoresearchLedgerEntry(ledgerFile, {
      iteration: -1,
      kind: 'iteration',
      decision: record.status === 'error' ? 'error' : record.status === 'pass' ? 'keep' : 'discard',
      decision_reason: '原始评估器记录',
      candidate_status: 'candidate',
      base_commit: readGitShortHead(worktreePath),
      candidate_commit: null,
      kept_commit: readGitShortHead(worktreePath),
      keep_policy: contract.sandbox.evaluator.keep_policy ?? 'score_improvement',
      evaluator: record,
      created_at: nowIso(),
      notes: ['原始评估器调用'],
      description: '原始评估器记录',
    });
  }
  return record;
}

function comparableScore(previousScore: number | null, nextScore: number | undefined): boolean {
  return typeof previousScore === 'number' && typeof nextScore === 'number';
}

export function decideAutoresearchOutcome(
  manifest: Pick<AutoresearchRunManifest, 'keep_policy' | 'last_kept_score'>,
  candidate: AutoresearchCandidateArtifact,
  evaluation: AutoresearchEvaluationRecord | null,
): AutoresearchDecision {
  if (candidate.status === 'abort') {
    return {
      decision: 'abort',
      decisionReason: '候选请求中止',
      keep: false,
      evaluator: null,
      notes: ['运行因候选产物而停止'],
    };
  }
  if (candidate.status === 'noop') {
    return {
      decision: 'noop',
      decisionReason: '候选报告 noop',
      keep: false,
      evaluator: null,
      notes: ['未提出任何代码变更'],
    };
  }
  if (candidate.status === 'interrupted') {
    return {
      decision: 'interrupted',
      decisionReason: '候选会话被中断',
      keep: false,
      evaluator: null,
      notes: ['监督者应在继续前检查工作树是否干净'],
    };
  }
  if (!evaluation || evaluation.status === 'error') {
    return {
      decision: 'discard',
      decisionReason: '评估器错误',
      keep: false,
      evaluator: evaluation,
      notes: ['因评估器出错或崩溃而丢弃候选'],
    };
  }
  if (!evaluation.pass) {
    return {
      decision: 'discard',
      decisionReason: '评估器报告失败',
      keep: false,
      evaluator: evaluation,
      notes: ['因评估器 pass=false 而丢弃候选'],
    };
  }
  if (manifest.keep_policy === 'pass_only') {
    return {
      decision: 'keep',
      decisionReason: 'pass_only 保留策略接受评估器 pass=true',
      keep: true,
      evaluator: evaluation,
      notes: ['因沙箱选择 pass_only 策略而保留候选'],
    };
  }
  if (!comparableScore(manifest.last_kept_score, evaluation.score)) {
    // Bootstrap 场景：尚无可用于比较的前序分数（运行中的首次 pass，或经过
    // 一段只有 fail 的区间后 last_kept_score 变为 null 后的首次 pass）。
    // 当前候选的 pass 就是新的比较锚点。若将其丢弃，会丢掉循环到目前为止
    // 产出的唯一已校验信号，并使 score_improvement 永远卡在 null。
    if (typeof evaluation.score === 'number') {
      return {
        decision: 'keep',
        decisionReason: '[bootstrap] score_improvement 运行中首个可比较分数',
        keep: true,
        evaluator: evaluation,
        notes: ['因无前序可比较分数而保留候选；此分数成为新基线'],
      };
    }
    return {
      decision: 'ambiguous',
      decisionReason: '评估器通过但无数值分数',
      keep: false,
      evaluator: evaluation,
      notes: ['因 score_improvement 策略要求数值分数而丢弃候选'],
    };
  }
  if ((evaluation.score as number) > (manifest.last_kept_score as number)) {
    return {
      decision: 'keep',
      decisionReason: '分数相较上一次保留分数有所提升',
      keep: true,
      evaluator: evaluation,
      notes: ['因评估器分数提升而保留候选'],
    };
  }
  return {
    decision: 'discard',
    decisionReason: '分数未提升',
    keep: false,
    evaluator: evaluation,
    notes: ['因评估器分数未优于已保留基线而丢弃候选'],
  };
}

export function buildAutoresearchInstructions(
  contract: AutoresearchMissionContract,
  context: {
    runId: string;
    iteration: number;
    baselineCommit: string;
    lastKeptCommit: string;
    lastKeptScore?: number | null;
    resultsFile: string;
    candidateFile: string;
    keepPolicy: AutoresearchKeepPolicy;
    previousIterationOutcome?: string | null;
    recentLedgerSummary?: AutoresearchInstructionLedgerSummary[];
  },
): string {
  return [
    '# WISE Autoresearch 监督者指令',
    '',
    `运行 ID：${context.runId}`,
    `Mission 目录：${contract.missionDir}`,
    `Mission 文件：${contract.missionFile}`,
    `沙箱文件：${contract.sandboxFile}`,
    `Mission slug：${contract.missionSlug}`,
    `迭代：${context.iteration}`,
    `基线提交：${context.baselineCommit}`,
    `上一次保留提交：${context.lastKeptCommit}`,
    `上一次保留分数：${typeof context.lastKeptScore === 'number' ? context.lastKeptScore : 'n/a'}`,
    `结果文件：${context.resultsFile}`,
    `候选产物：${context.candidateFile}`,
    `保留策略：${context.keepPolicy}`,
    '',
    '迭代状态快照：',
    '```json',
    JSON.stringify({
      iteration: context.iteration,
      baseline_commit: context.baselineCommit,
      last_kept_commit: context.lastKeptCommit,
      last_kept_score: context.lastKeptScore ?? null,
      previous_iteration_outcome: context.previousIterationOutcome ?? '暂无',
      recent_ledger_summary: context.recentLedgerSummary ?? [],
      keep_policy: context.keepPolicy,
    }, null, 2),
    '```',
    '',
    '作为一个轻量的 autoresearch 实验工作线程，精确运行一个实验周期。',
    '不要在此会话内无限循环。最多创建一个候选提交，然后写入候选产物 JSON 并退出。',
    '',
    '候选产物契约：',
    '- 将 JSON 写入上方确切的候选产物路径。',
    '- status：candidate | noop | abort | interrupted',
    '- candidate_commit：string | null',
    '- base_commit：你编辑前的当前基线提交',
    '- 当 status=candidate 时，candidate_commit 必须能在 git 中解析，且在你退出时与工作树 HEAD 提交一致',
    '- base_commit 必须仍与上方提供的上一次保留提交一致',
    '- description：简短的一行摘要',
    '- notes：短字符串数组',
    '- created_at：ISO 时间戳',
    '',
    '你退出后的监督者语义：',
    '- status=candidate => 运行评估器，随后监督者保留或丢弃候选，并可能重置工作树',
    '- status=noop => 监督者记录一次 noop 迭代并重新启动',
    '- status=abort => 监督者停止运行',
    '- status=interrupted => 监督者在决定如何继续前检查工作树安全性',
    '',
    '评估器契约：',
    `- command：${contract.sandbox.evaluator.command}`,
    '- format：json',
    '- 必填输出字段：pass（布尔值）',
    '- 可选输出字段：score（数值）',
    '',
    'Mission 内容：',
    '```md',
    trimContent(contract.missionContent),
    '```',
    '',
    '沙箱策略：',
    '```md',
    trimContent(contract.sandbox.body || contract.sandboxContent),
    '```',
  ].join('\n');
}

export async function materializeAutoresearchMissionToWorktree(
  contract: AutoresearchMissionContract,
  worktreePath: string,
): Promise<AutoresearchMissionContract> {
  const missionDir = join(worktreePath, contract.missionRelativeDir);
  const missionFile = join(missionDir, 'mission.md');
  const sandboxFile = join(missionDir, 'sandbox.md');

  await mkdir(missionDir, { recursive: true });
  await writeFile(missionFile, contract.missionContent, 'utf-8');
  await writeFile(sandboxFile, contract.sandboxContent, 'utf-8');

  return {
    ...contract,
    missionDir,
    missionFile,
    sandboxFile,
  };
}

export async function loadAutoresearchRunManifest(projectRoot: string, runId: string): Promise<AutoresearchRunManifest> {
  const manifestFile = join(getWiseRoot(projectRoot), 'logs', 'autoresearch', runId, 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new Error(`autoresearch_resume_manifest_missing:${runId}`);
  }
  return readJsonFile<AutoresearchRunManifest>(manifestFile);
}

async function writeRunManifest(manifest: AutoresearchRunManifest): Promise<void> {
  manifest.updated_at = nowIso();
  await writeJsonFile(manifest.manifest_file, manifest);
}

async function writeInstructionsFile(contract: AutoresearchMissionContract, manifest: AutoresearchRunManifest): Promise<void> {
  const instructionContext = await buildAutoresearchInstructionContext(manifest);
  await writeFile(
    manifest.instructions_file,
    `${buildAutoresearchInstructions(contract, {
      runId: manifest.run_id,
      iteration: manifest.iteration + 1,
      baselineCommit: manifest.baseline_commit,
      lastKeptCommit: manifest.last_kept_commit,
      lastKeptScore: manifest.last_kept_score,
      resultsFile: manifest.results_file,
      candidateFile: manifest.candidate_file,
      keepPolicy: manifest.keep_policy,
      previousIterationOutcome: instructionContext.previousIterationOutcome,
      recentLedgerSummary: instructionContext.recentLedgerSummary,
    })}\n`,
    'utf-8',
  );
}

async function seedBaseline(
  contract: AutoresearchMissionContract,
  manifest: AutoresearchRunManifest,
): Promise<AutoresearchEvaluationRecord> {
  const evaluation = await runAutoresearchEvaluator(contract, manifest.worktree_path);
  await writeJsonFile(manifest.latest_evaluator_file, evaluation);
  const artifactLayout = getAutoresearchMissionArtifactLayout(manifest.repo_root, manifest.mission_slug, manifest.run_id);
  await writeJsonFile(join(artifactLayout.evaluationsDir, 'iteration-0000.json'), evaluation);
  await appendAutoresearchResultsRow(manifest.results_file, {
    iteration: 0,
    commit: readGitShortHead(manifest.worktree_path),
    pass: evaluation.pass,
    score: evaluation.score,
    status: evaluation.status === 'error' ? 'error' : 'baseline',
    description: '初始基线评估',
  });
  await appendAutoresearchLedgerEntry(manifest.ledger_file, {
    iteration: 0,
    kind: 'baseline',
    decision: evaluation.status === 'error' ? 'error' : 'baseline',
    decision_reason: evaluation.status === 'error' ? '基线评估器错误' : '基线已建立',
    candidate_status: 'baseline',
    base_commit: manifest.baseline_commit,
    candidate_commit: null,
    kept_commit: manifest.last_kept_commit,
    keep_policy: manifest.keep_policy,
    evaluator: evaluation,
    created_at: nowIso(),
    notes: ['基线行始终被记录'],
    description: '初始基线评估',
  });
  await appendDecisionLog(artifactLayout.decisionLogFile, {
    iteration: 0,
    decision: 'baseline',
    description: '初始基线评估',
    reason: '基线已建立',
    evaluator: evaluation,
    notes: ['基线已建立'],
  });
  manifest.last_kept_score = evaluation.pass && typeof evaluation.score === 'number' ? evaluation.score : null;
  await writeRunManifest(manifest);
  await writeInstructionsFile(contract, manifest);
  return evaluation;
}

export async function prepareAutoresearchRuntime(
  contract: AutoresearchMissionContract,
  projectRoot: string,
  worktreePath: string,
  options: { runTag?: string; maxRuntimeMs?: number } = {},
): Promise<PreparedAutoresearchRuntime> {
  await assertAutoresearchLockAvailable(projectRoot);
  await ensureRuntimeExcludes(worktreePath);
  await ensureAutoresearchWorktreeDependencies(projectRoot, worktreePath);
  assertResetSafeWorktree(worktreePath, [contract.missionFile, contract.sandboxFile]);

  const runTag = options.runTag || buildAutoresearchRunTag();
  const runId = buildRunId(contract.missionSlug, runTag);
  const baselineCommit = readGitShortHead(worktreePath);
  const branchName = readGit(worktreePath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const runDir = join(getWiseRoot(projectRoot), 'logs', 'autoresearch', runId);
  const stateFile = activeRunStateFile(projectRoot);
  const instructionsFile = join(runDir, 'bootstrap-instructions.md');
  const manifestFile = join(runDir, 'manifest.json');
  const ledgerFile = join(runDir, 'iteration-ledger.json');
  const latestEvaluatorFile = join(runDir, 'latest-evaluator-result.json');
  const candidateFile = join(runDir, 'candidate.json');
  const resultsFile = join(worktreePath, 'results.tsv');
  const taskDescription = `autoresearch ${contract.missionRelativeDir}（${runId}）`;
  const keepPolicy = contract.sandbox.evaluator.keep_policy ?? 'score_improvement';
  const artifactLayout = getAutoresearchMissionArtifactLayout(projectRoot, contract.missionSlug, runId);
  const deadlineAt = typeof options.maxRuntimeMs === 'number'
    ? new Date(Date.now() + options.maxRuntimeMs).toISOString()
    : undefined;

  await mkdir(runDir, { recursive: true });
  await mkdir(artifactLayout.evaluationsDir, { recursive: true });
  await initializeAutoresearchResultsFile(resultsFile);
  await ensureParentDir(artifactLayout.missionSpecFile);
  await writeFile(artifactLayout.missionSpecFile, contract.missionContent, 'utf-8');
  await ensureParentDir(artifactLayout.evaluatorReferenceFile);
  await writeJsonFile(artifactLayout.evaluatorReferenceFile, {
    command: contract.sandbox.evaluator.command,
    format: contract.sandbox.evaluator.format,
    ...(contract.sandbox.evaluator.keep_policy ? { keep_policy: contract.sandbox.evaluator.keep_policy } : {}),
  });
  await writeJsonFile(candidateFile, {
    status: 'noop',
    candidate_commit: null,
    base_commit: baselineCommit,
    description: '尚未写入',
    notes: ['候选产物将被启动的会话覆盖'],
    created_at: nowIso(),
  } satisfies AutoresearchCandidateArtifact);

  const manifest: AutoresearchRunManifest = {
    schema_version: 1,
    run_id: runId,
    run_tag: runTag,
    mission_dir: contract.missionDir,
    mission_file: contract.missionFile,
    sandbox_file: contract.sandboxFile,
    repo_root: projectRoot,
    worktree_path: worktreePath,
    mission_slug: contract.missionSlug,
    branch_name: branchName,
    baseline_commit: baselineCommit,
    last_kept_commit: readGitFullHead(worktreePath),
    last_kept_score: null,
    latest_candidate_commit: null,
    results_file: resultsFile,
    instructions_file: instructionsFile,
    manifest_file: manifestFile,
    ledger_file: ledgerFile,
    latest_evaluator_file: latestEvaluatorFile,
    candidate_file: candidateFile,
    evaluator: contract.sandbox.evaluator,
    keep_policy: keepPolicy,
    status: 'running',
    stop_reason: null,
    iteration: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: null,
  };

  await writeInstructionsFile(contract, manifest);
  await writeRunManifest(manifest);
  await writeJsonFile(ledgerFile, {
    schema_version: 1,
    run_id: runId,
    created_at: nowIso(),
    updated_at: nowIso(),
    entries: [],
  });
  await writeJsonFile(latestEvaluatorFile, {
    run_id: runId,
    status: '尚未运行',
    updated_at: nowIso(),
  });

  const existingModeState = readModeState<Record<string, unknown>>('autoresearch', projectRoot);
  if (existingModeState?.active) {
    throw new Error(`autoresearch_active_mode_exists:${String(existingModeState.run_id || 'unknown')}`);
  }
  startAutoresearchMode(taskDescription, projectRoot);
  await activateAutoresearchRun(manifest);
  updateAutoresearchMode({
    current_phase: 'evaluating-baseline',
    run_id: runId,
    run_tag: runTag,
    mission_dir: contract.missionDir,
    mission_file: contract.missionFile,
    sandbox_file: contract.sandboxFile,
    mission_slug: contract.missionSlug,
    repo_root: projectRoot,
    worktree_path: worktreePath,
    baseline_commit: baselineCommit,
    last_kept_commit: manifest.last_kept_commit,
    results_file: resultsFile,
    manifest_path: manifestFile,
    iteration_ledger_path: ledgerFile,
    latest_evaluator_result_path: latestEvaluatorFile,
    bootstrap_instructions_path: instructionsFile,
    candidate_path: candidateFile,
    keep_policy: keepPolicy,
    state_file: stateFile,
    mission_artifact_root: artifactLayout.missionRoot,
    mission_spec_file: artifactLayout.missionSpecFile,
    evaluator_reference_file: artifactLayout.evaluatorReferenceFile,
    decision_log_file: artifactLayout.decisionLogFile,
    max_runtime_ms: options.maxRuntimeMs,
    deadline_at: deadlineAt,
  }, projectRoot);

  const evaluation = await seedBaseline(contract, manifest);
  updateAutoresearchMode({
    current_phase: 'running',
    latest_evaluator_status: evaluation.status,
    latest_evaluator_pass: evaluation.pass,
    latest_evaluator_score: evaluation.score,
    latest_evaluator_ran_at: evaluation.ran_at,
    last_kept_commit: manifest.last_kept_commit,
    last_kept_score: manifest.last_kept_score,
  }, projectRoot);

  return {
    runId,
    runTag,
    runDir,
    instructionsFile,
    manifestFile,
    ledgerFile,
    latestEvaluatorFile,
    resultsFile,
    stateFile,
    candidateFile,
    repoRoot: projectRoot,
    worktreePath,
    taskDescription,
  };
}

export async function resumeAutoresearchRuntime(projectRoot: string, runId: string): Promise<PreparedAutoresearchRuntime> {
  await assertAutoresearchLockAvailable(projectRoot);
  const manifest = await loadAutoresearchRunManifest(projectRoot, runId);
  if (manifest.status !== 'running') {
    throw new Error(`autoresearch_resume_terminal_run:${runId}`);
  }
  if (!existsSync(manifest.worktree_path)) {
    throw new Error(`autoresearch_resume_missing_worktree:${manifest.worktree_path}`);
  }
  await ensureRuntimeExcludes(manifest.worktree_path);
  await ensureAutoresearchWorktreeDependencies(projectRoot, manifest.worktree_path);
  assertResetSafeWorktree(manifest.worktree_path, [manifest.mission_file, manifest.sandbox_file]);
  startAutoresearchMode(`autoresearch 恢复 ${runId}`, projectRoot);
  await activateAutoresearchRun(manifest);
  updateAutoresearchMode({
    current_phase: 'running',
    run_id: manifest.run_id,
    run_tag: manifest.run_tag,
    mission_dir: manifest.mission_dir,
    mission_file: manifest.mission_file,
    sandbox_file: manifest.sandbox_file,
    mission_slug: manifest.mission_slug,
    repo_root: manifest.repo_root,
    worktree_path: manifest.worktree_path,
    baseline_commit: manifest.baseline_commit,
    last_kept_commit: manifest.last_kept_commit,
    last_kept_score: manifest.last_kept_score,
    results_file: manifest.results_file,
    manifest_path: manifest.manifest_file,
    iteration_ledger_path: manifest.ledger_file,
    latest_evaluator_result_path: manifest.latest_evaluator_file,
    bootstrap_instructions_path: manifest.instructions_file,
    candidate_path: manifest.candidate_file,
    keep_policy: manifest.keep_policy,
    state_file: activeRunStateFile(projectRoot),
  }, projectRoot);
  return {
    runId: manifest.run_id,
    runTag: manifest.run_tag,
    runDir: dirname(manifest.manifest_file),
    instructionsFile: manifest.instructions_file,
    manifestFile: manifest.manifest_file,
    ledgerFile: manifest.ledger_file,
    latestEvaluatorFile: manifest.latest_evaluator_file,
    resultsFile: manifest.results_file,
    stateFile: activeRunStateFile(projectRoot),
    candidateFile: manifest.candidate_file,
    repoRoot: manifest.repo_root,
    worktreePath: manifest.worktree_path,
    taskDescription: `autoresearch 恢复 ${runId}`,
  };
}

export function parseAutoresearchCandidateArtifact(raw: string): AutoresearchCandidateArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('autoresearch 候选产物必须是合法的 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('autoresearch 候选产物必须是 JSON 对象');
  }
  const record = parsed as Record<string, unknown>;
  const status = record.status;
  if (status !== 'candidate' && status !== 'noop' && status !== 'abort' && status !== 'interrupted') {
    throw new Error('autoresearch 候选产物的 status 必须是 candidate|noop|abort|interrupted');
  }
  if (record.candidate_commit !== null && typeof record.candidate_commit !== 'string') {
    throw new Error('autoresearch 候选产物的 candidate_commit 必须是 string|null');
  }
  if (typeof record.base_commit !== 'string' || !record.base_commit.trim()) {
    throw new Error('autoresearch 候选产物的 base_commit 为必填项');
  }
  if (typeof record.description !== 'string') {
    throw new Error('autoresearch 候选产物的 description 为必填项');
  }
  if (!Array.isArray(record.notes) || record.notes.some((note) => typeof note !== 'string')) {
    throw new Error('autoresearch 候选产物的 notes 必须是字符串数组');
  }
  if (typeof record.created_at !== 'string' || !record.created_at.trim()) {
    throw new Error('autoresearch 候选产物的 created_at 为必填项');
  }
  return {
    status,
    candidate_commit: record.candidate_commit,
    base_commit: record.base_commit,
    description: record.description,
    notes: record.notes,
    created_at: record.created_at,
  };
}

async function readCandidateArtifact(candidateFile: string): Promise<AutoresearchCandidateArtifact> {
  if (!existsSync(candidateFile)) {
    throw new Error(`autoresearch_candidate_missing:${candidateFile}`);
  }
  return parseAutoresearchCandidateArtifact(await readFile(candidateFile, 'utf-8'));
}

async function finalizeRun(
  manifest: AutoresearchRunManifest,
  projectRoot: string,
  updates: { status: AutoresearchRunStatus; stopReason: string },
): Promise<void> {
  manifest.status = updates.status;
  manifest.stop_reason = updates.stopReason;
  manifest.completed_at = nowIso();
  await writeRunManifest(manifest);
  updateAutoresearchMode({
    active: false,
    current_phase: updates.status,
    completed_at: manifest.completed_at,
    stop_reason: updates.stopReason,
  }, projectRoot);
  await deactivateAutoresearchRun(manifest);
}

function resetToLastKeptCommit(manifest: AutoresearchRunManifest): void {
  assertResetSafeWorktree(manifest.worktree_path, [manifest.mission_file, manifest.sandbox_file]);
  requireGitSuccess(manifest.worktree_path, ['reset', '--hard', manifest.last_kept_commit]);
}

function validateAutoresearchCandidate(
  manifest: Pick<AutoresearchRunManifest, 'last_kept_commit' | 'worktree_path'>,
  candidate: AutoresearchCandidateArtifact,
): { candidate: AutoresearchCandidateArtifact } | { reason: string } {
  const resolvedBaseCommit = tryResolveGitCommit(manifest.worktree_path, candidate.base_commit);
  if (!resolvedBaseCommit) {
    return {
      reason: `候选 base_commit 无法在 git 中解析：${candidate.base_commit}`,
    };
  }
  if (resolvedBaseCommit !== manifest.last_kept_commit) {
    return {
      reason: `候选 base_commit ${resolvedBaseCommit} 与上一次保留提交 ${manifest.last_kept_commit} 不一致`,
    };
  }

  if (candidate.status !== 'candidate') {
    return {
      candidate: {
        ...candidate,
        base_commit: resolvedBaseCommit,
      },
    };
  }

  if (!candidate.candidate_commit) {
    return {
      reason: 'candidate 状态要求非空的 candidate_commit',
    };
  }
  const resolvedCandidateCommit = tryResolveGitCommit(manifest.worktree_path, candidate.candidate_commit);
  if (!resolvedCandidateCommit) {
    return {
      reason: `candidate_commit 无法在 git 中解析：${candidate.candidate_commit}`,
    };
  }
  const headCommit = readGitFullHead(manifest.worktree_path);
  if (resolvedCandidateCommit !== headCommit) {
    return {
      reason: `candidate_commit ${resolvedCandidateCommit} 与工作树 HEAD ${headCommit} 不一致`,
    };
  }

  return {
    candidate: {
      ...candidate,
      base_commit: resolvedBaseCommit,
      candidate_commit: resolvedCandidateCommit,
    },
  };
}

async function failAutoresearchIteration(
  manifest: AutoresearchRunManifest,
  projectRoot: string,
  reason: string,
  candidate?: AutoresearchCandidateArtifact,
): Promise<'error'> {
  const artifactLayout = getAutoresearchMissionArtifactLayout(projectRoot, manifest.mission_slug, manifest.run_id);
  const headCommit = (() => {
    try {
      return readGitShortHead(manifest.worktree_path);
    } catch {
      return manifest.baseline_commit;
    }
  })();

  await appendAutoresearchResultsRow(manifest.results_file, {
    iteration: manifest.iteration,
    commit: headCommit,
    status: 'error',
    description: candidate?.description || '候选校验失败',
  });
  await appendAutoresearchLedgerEntry(manifest.ledger_file, {
    iteration: manifest.iteration,
    kind: 'iteration',
    decision: 'error',
    decision_reason: reason,
    candidate_status: candidate?.status ?? 'candidate',
    base_commit: candidate?.base_commit ?? manifest.last_kept_commit,
    candidate_commit: candidate?.candidate_commit ?? null,
    kept_commit: manifest.last_kept_commit,
    keep_policy: manifest.keep_policy,
    evaluator: null,
    created_at: nowIso(),
    notes: [...(candidate?.notes ?? []), `validation_error:${reason}`],
    description: candidate?.description || '候选校验失败',
  });
  await appendDecisionLog(artifactLayout.decisionLogFile, {
    iteration: manifest.iteration,
    decision: 'error',
    description: candidate?.description || '候选校验失败',
    reason,
    notes: [...(candidate?.notes ?? []), `validation_error:${reason}`],
  });
  await finalizeRun(manifest, projectRoot, { status: 'failed', stopReason: reason });
  return 'error';
}

export async function processAutoresearchCandidate(
  contract: AutoresearchMissionContract,
  manifest: AutoresearchRunManifest,
  projectRoot: string,
): Promise<AutoresearchDecisionStatus> {
  manifest.iteration += 1;
  const artifactLayout = getAutoresearchMissionArtifactLayout(projectRoot, manifest.mission_slug, manifest.run_id);
  let candidate: AutoresearchCandidateArtifact;
  try {
    candidate = await readCandidateArtifact(manifest.candidate_file);
  } catch (error) {
    return failAutoresearchIteration(
      manifest,
      projectRoot,
      error instanceof Error ? error.message : String(error),
    );
  }

  const validation = validateAutoresearchCandidate(manifest, candidate);
  if ('reason' in validation) {
    return failAutoresearchIteration(manifest, projectRoot, validation.reason, candidate);
  }
  candidate = validation.candidate;
  manifest.latest_candidate_commit = candidate.candidate_commit;

  if (candidate.status === 'abort') {
    await appendAutoresearchResultsRow(manifest.results_file, {
      iteration: manifest.iteration,
      commit: readGitShortHead(manifest.worktree_path),
      status: 'abort',
      description: candidate.description,
    });
    await appendAutoresearchLedgerEntry(manifest.ledger_file, {
      iteration: manifest.iteration,
      kind: 'iteration',
      decision: 'abort',
      decision_reason: '候选请求中止',
      candidate_status: candidate.status,
      base_commit: candidate.base_commit,
      candidate_commit: candidate.candidate_commit,
      kept_commit: manifest.last_kept_commit,
      keep_policy: manifest.keep_policy,
      evaluator: null,
      created_at: nowIso(),
      notes: candidate.notes,
      description: candidate.description,
    });
    await appendDecisionLog(artifactLayout.decisionLogFile, {
      iteration: manifest.iteration,
      decision: 'abort',
      description: candidate.description,
      reason: '候选请求中止',
      notes: candidate.notes,
    });
    await finalizeRun(manifest, projectRoot, { status: 'stopped', stopReason: '候选中止' });
    return 'abort';
  }

  if (candidate.status === 'interrupted') {
    try {
      assertResetSafeWorktree(manifest.worktree_path, [manifest.mission_file, manifest.sandbox_file]);
    } catch {
      await finalizeRun(manifest, projectRoot, { status: 'failed', stopReason: '中断：脏工作树需要操作者介入' });
      return 'error';
    }
    await appendAutoresearchResultsRow(manifest.results_file, {
      iteration: manifest.iteration,
      commit: readGitShortHead(manifest.worktree_path),
      status: 'interrupted',
      description: candidate.description,
    });
    await appendAutoresearchLedgerEntry(manifest.ledger_file, {
      iteration: manifest.iteration,
      kind: 'iteration',
      decision: 'interrupted',
      decision_reason: '候选会话干净地中断',
      candidate_status: candidate.status,
      base_commit: candidate.base_commit,
      candidate_commit: candidate.candidate_commit,
      kept_commit: manifest.last_kept_commit,
      keep_policy: manifest.keep_policy,
      evaluator: null,
      created_at: nowIso(),
      notes: candidate.notes,
      description: candidate.description,
    });
    await appendDecisionLog(artifactLayout.decisionLogFile, {
      iteration: manifest.iteration,
      decision: 'interrupted',
      description: candidate.description,
      reason: '候选会话干净地中断',
      notes: candidate.notes,
    });
    await writeRunManifest(manifest);
    await writeInstructionsFile(contract, manifest);
    return 'interrupted';
  }

  if (candidate.status === 'noop') {
    await appendAutoresearchResultsRow(manifest.results_file, {
      iteration: manifest.iteration,
      commit: readGitShortHead(manifest.worktree_path),
      status: 'noop',
      description: candidate.description,
    });
    await appendAutoresearchLedgerEntry(manifest.ledger_file, {
      iteration: manifest.iteration,
      kind: 'iteration',
      decision: 'noop',
      decision_reason: '候选报告 noop',
      candidate_status: candidate.status,
      base_commit: candidate.base_commit,
      candidate_commit: candidate.candidate_commit,
      kept_commit: manifest.last_kept_commit,
      keep_policy: manifest.keep_policy,
      evaluator: null,
      created_at: nowIso(),
      notes: candidate.notes,
      description: candidate.description,
    });
    await appendDecisionLog(artifactLayout.decisionLogFile, {
      iteration: manifest.iteration,
      decision: 'noop',
      description: candidate.description,
      reason: '候选报告 noop',
      notes: candidate.notes,
    });
    await writeRunManifest(manifest);
    await writeInstructionsFile(contract, manifest);
    return 'noop';
  }

  const evaluation = await runAutoresearchEvaluator(contract, manifest.worktree_path);
  await writeJsonFile(manifest.latest_evaluator_file, evaluation);
  await writeJsonFile(
    join(artifactLayout.evaluationsDir, `iteration-${String(manifest.iteration).padStart(4, '0')}.json`),
    evaluation,
  );
  const decision = decideAutoresearchOutcome(manifest, candidate, evaluation);
  if (decision.keep) {
    manifest.last_kept_commit = readGitFullHead(manifest.worktree_path);
    manifest.last_kept_score = typeof evaluation.score === 'number' ? evaluation.score : manifest.last_kept_score;
  } else {
    resetToLastKeptCommit(manifest);
  }

  await appendAutoresearchResultsRow(manifest.results_file, {
    iteration: manifest.iteration,
    commit: readGitShortHead(manifest.worktree_path),
    pass: evaluation.pass,
    score: evaluation.score,
    status: decision.decision,
    description: candidate.description,
  });
  await appendAutoresearchLedgerEntry(manifest.ledger_file, {
    iteration: manifest.iteration,
    kind: 'iteration',
    decision: decision.decision,
    decision_reason: decision.decisionReason,
    candidate_status: candidate.status,
    base_commit: candidate.base_commit,
    candidate_commit: candidate.candidate_commit,
    kept_commit: manifest.last_kept_commit,
    keep_policy: manifest.keep_policy,
    evaluator: evaluation,
    created_at: nowIso(),
    notes: [...candidate.notes, ...decision.notes],
    description: candidate.description,
  });
  await appendDecisionLog(artifactLayout.decisionLogFile, {
    iteration: manifest.iteration,
    decision: decision.decision,
    description: candidate.description,
    reason: decision.decisionReason,
    evaluator: evaluation,
    notes: [...candidate.notes, ...decision.notes],
  });
  await writeRunManifest(manifest);
  await writeInstructionsFile(contract, manifest);
  updateAutoresearchMode({
    current_phase: 'running',
    iteration: manifest.iteration,
    last_kept_commit: manifest.last_kept_commit,
    last_kept_score: manifest.last_kept_score,
    latest_evaluator_status: evaluation.status,
    latest_evaluator_pass: evaluation.pass,
    latest_evaluator_score: evaluation.score,
    latest_evaluator_ran_at: evaluation.ran_at,
    decision_log_file: artifactLayout.decisionLogFile,
  }, projectRoot);
  return decision.decision;
}

export async function finalizeAutoresearchRunState(
  projectRoot: string,
  runId: string,
  updates: { status: AutoresearchRunStatus; stopReason: string },
): Promise<void> {
  const manifest = await loadAutoresearchRunManifest(projectRoot, runId);
  if (manifest.status !== 'running') {
    return;
  }
  await finalizeRun(manifest, projectRoot, updates);
}

export async function stopAutoresearchRuntime(projectRoot: string): Promise<void> {
  const state = readModeState<Record<string, unknown>>('autoresearch', projectRoot);
  if (!state?.active) {
    return;
  }

  const runId = typeof state.run_id === 'string' ? state.run_id : null;
  if (runId) {
    await finalizeAutoresearchRunState(projectRoot, runId, {
      status: 'stopped',
      stopReason: '操作者停止',
    });
    return;
  }

  cancelAutoresearchMode(projectRoot);
}
