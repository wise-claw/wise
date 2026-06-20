/**
 * wise team CLI 子命令
 *
 * `wise team` 的完整团队生命周期：
 *   wise team [N:agent-type] "task"          启动团队（生成 tmux worker 面板）
 *   wise team status <team-name>             监控团队状态
 *   wise team shutdown <team-name> [--force] 关闭团队
 *   wise team api <operation> --input '...'  Worker CLI API
 */

import {
  TEAM_API_OPERATIONS,
  resolveTeamApiOperation,
  executeTeamApiOperation,
  type TeamApiOperation,
} from '../../team/api-interop.js';
import { inferDelegationPlanForTeamTask } from '../../team/delegation-evidence.js';
import type { CliAgentType } from '../../team/model-contract.js';
import type { TeamTaskDelegationPlan } from '../../team/types.js';
import { loadConfig } from '../../config/loader.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmuxExec } from '../tmux-utils.js';
import { getWiseRoot } from '../../lib/worktree-paths.js';

const HELP_TOKENS = new Set(['--help', '-h', 'help']);
const MIN_WORKER_COUNT = 1;
const MAX_WORKER_COUNT = 20;
const VALID_TEAM_CLI_AGENT_TYPES = new Set(['claude', 'codex', 'gemini', 'grok', 'cursor']);
const DEFAULT_TEAM_CLI_AGENT_TYPE: CliAgentType = 'claude';

const TEAM_HELP = `
Usage: wise team [N:agent-type[:role]] [--new-window] [--auto-merge] [--no-decompose] "<task description>"
       wise team status <team-name>
       wise team shutdown <team-name> [--force]
       wise team api <operation> [--input <json>] [--json]
       wise team api --help

Examples:
  wise team 3:claude "fix failing tests"
  wise team 2:codex:architect "design auth system"
  wise team 1:gemini:executor "implement feature"
  wise team 1:codex,1:gemini "compare approaches"
  wise team 1:cursor:executor "apply the implementation"
  wise team 2:codex "review auth flow" --new-window
  wise team status fix-failing-tests
  wise team shutdown fix-failing-tests
  wise team api send-message --input '{"team_name":"my-team","from_worker":"worker-1","to_worker":"leader-fixed","body":"ACK"}' --json

Worktrees (opt-in): set team.ops.worktreeMode or WISE_TEAM_WORKTREE_MODE=detached|branch to launch workers from .wise/team/<team>/worktrees/<worker>. Status includes workspace/worktree metadata.

Auto-merge (v2-only):
  --no-decompose       Treat the launch text as pre-authored/fixed worker scope; do not split by commas/lists.
  --auto-merge          Enable per-commit auto-merge to leader and auto-rebase fanout.
                        Each worker runs in a dedicated git worktree on wise-team/{team}/{worker}.
                        Bursts of rapid worker commits coalesce to a single merge of HEAD.
                        Requires WISE_RUNTIME_V2=1. Leader branch must not be 'main' or 'master'.
                        Equivalent to WISE_TEAMS_AUTO_MERGE=1.

Roles (optional): architect, executor, planner, analyst, critic, debugger, verifier,
  code-reviewer, security-reviewer, test-engineer, designer, writer, scientist
`;

const TEAM_API_HELP = `
Usage: wise team api <operation> [--input <json>] [--json]
       wise team api <operation> --help

Supported operations:
  ${TEAM_API_OPERATIONS.join('\n  ')}

Examples:
  wise team api list-tasks --input '{"team_name":"my-team"}' --json
  wise team api claim-task --input '{"team_name":"my-team","task_id":"1","worker":"worker-1","expected_version":1}' --json
`;

const TEAM_API_OPERATION_REQUIRED_FIELDS: Record<TeamApiOperation, string[]> = {
  'send-message': ['team_name', 'from_worker', 'to_worker', 'body'],
  'broadcast': ['team_name', 'from_worker', 'body'],
  'mailbox-list': ['team_name', 'worker'],
  'mailbox-mark-delivered': ['team_name', 'worker', 'message_id'],
  'mailbox-mark-notified': ['team_name', 'worker', 'message_id'],
  'create-task': ['team_name', 'subject', 'description'],
  'read-task': ['team_name', 'task_id'],
  'list-tasks': ['team_name'],
  'update-task': ['team_name', 'task_id'],
  'claim-task': ['team_name', 'task_id', 'worker'],
  'transition-task-status': ['team_name', 'task_id', 'from', 'to', 'claim_token'],
  'release-task-claim': ['team_name', 'task_id', 'claim_token', 'worker'],
  'read-config': ['team_name'],
  'read-manifest': ['team_name'],
  'read-worker-status': ['team_name', 'worker'],
  'read-worker-heartbeat': ['team_name', 'worker'],
  'update-worker-heartbeat': ['team_name', 'worker', 'pid', 'turn_count', 'alive'],
  'write-worker-inbox': ['team_name', 'worker', 'content'],
  'write-worker-identity': ['team_name', 'worker', 'index', 'role'],
  'append-event': ['team_name', 'type', 'worker'],
  'get-summary': ['team_name'],
  'cleanup': ['team_name'],
  'orphan-cleanup': ['team_name'],
  'write-shutdown-request': ['team_name', 'worker', 'requested_by'],
  'read-shutdown-ack': ['team_name', 'worker'],
  'read-monitor-snapshot': ['team_name'],
  'write-monitor-snapshot': ['team_name', 'snapshot'],
  'read-task-approval': ['team_name', 'task_id'],
  'write-task-approval': ['team_name', 'task_id', 'status', 'reviewer', 'decision_reason'],
};

const TEAM_API_OPERATION_OPTIONAL_FIELDS: Partial<Record<TeamApiOperation, string[]>> = {
  'create-task': ['owner', 'blocked_by', 'requires_code_change', 'delegation'],
  'update-task': ['subject', 'description', 'blocked_by', 'requires_code_change', 'delegation'],
  'claim-task': ['expected_version'],
  'read-shutdown-ack': ['min_updated_at'],
  'write-worker-identity': [
    'assigned_tasks', 'pid', 'pane_id', 'working_dir',
    'worktree_repo_root', 'worktree_path', 'worktree_branch', 'worktree_detached', 'worktree_created', 'team_state_root',
  ],
  'append-event': ['task_id', 'message_id', 'reason'],
  'write-task-approval': ['required'],
};

const TEAM_API_OPERATION_NOTES: Partial<Record<TeamApiOperation, string>> = {
  'update-task': 'Only non-lifecycle task metadata can be updated.',
  'release-task-claim': 'Use this only for rollback/requeue to pending (not for completion).',
  'transition-task-status': 'Lifecycle flow is claim-safe and typically transitions in_progress -> completed|failed.',
};

// ---------------------------------------------------------------------------
// 任务分解辅助函数
// ---------------------------------------------------------------------------

export type DecompositionStrategy = 'numbered' | 'bulleted' | 'conjunction' | 'atomic';

export interface DecompositionPlan {
  strategy: DecompositionStrategy;
  subtasks: Array<{ subject: string; description: string }>;
}

const NUMBERED_LINE_RE = /^\s*\d+[.)]\s+(.+)$/;
const BULLETED_LINE_RE = /^\s*[-*•]\s+(.+)$/;
// 连词拆分："fix auth AND fix login AND fix logout" 或 "fix auth, fix login, and fix logout"
const CONJUNCTION_SPLIT_RE = /\s+(?:and|,\s*and|,)\s+/i;

/** 标记任务为原子任务（包含文件引用、代码符号或并行关键字） */
const PARALLELIZATION_KEYWORDS_RE =
  /\b(?:parallel|concurrently|simultaneously|at the same time|independently)\b/i;
const FILE_REF_RE = /\b\S+\.\w{1,6}\b/g;
const CODE_SYMBOL_RE = /`[^`]+`/g;

/**
 * 统计任务字符串中的原子并行信号。
 * 当任务不应被分解时（已是原子或紧耦合）返回 true。
 */
export function hasAtomicParallelizationSignals(task: string, _size: string): boolean {
  const fileRefs = (task.match(FILE_REF_RE) || []).length;
  const codeSymbols = (task.match(CODE_SYMBOL_RE) || []).length;
  const parallelKw = PARALLELIZATION_KEYWORDS_RE.test(task);
  // 当存在大量具体文件/符号引用时视为原子（紧耦合）
  return fileRefs >= 3 || codeSymbols >= 3 || parallelKw;
}

/**
 * 解析分解后任务的有效 worker 数量扇出上限。
 * 当分解产生的子任务更少时，将 worker 数量限制为发现的子任务数。
 */
export function resolveTeamFanoutLimit(
  requestedWorkerCount: number,
  _explicitAgentType: string | undefined,
  explicitWorkerCount: number | undefined,
  plan: DecompositionPlan,
  noDecompose = false,
): number {
  if (explicitWorkerCount !== undefined || noDecompose) return requestedWorkerCount;
  if (plan.strategy === 'atomic') return requestedWorkerCount;
  const subtaskCount = plan.subtasks.length;
  if (subtaskCount > 0 && subtaskCount < requestedWorkerCount) {
    return subtaskCount;
  }
  return requestedWorkerCount;
}

/**
 * 将任务字符串分解为结构化计划。
 *
 * 检测：
 * - 编号列表："1. fix auth\n2. fix login"
 * - 项目符号列表："- fix auth\n- fix login"
 * - 连词："fix auth and fix login and fix logout"
 * - 原子：单个任务，不分解
 */
export function splitTaskString(task: string): DecompositionPlan {
  const lines = task.split('\n').map(l => l.trim()).filter(Boolean);

  // 检查编号列表
  if (lines.length >= 2 && lines.every(l => NUMBERED_LINE_RE.test(l))) {
    return {
      strategy: 'numbered',
      subtasks: lines.map(l => {
        const m = l.match(NUMBERED_LINE_RE)!;
        const subject = m[1].trim();
        return { subject: subject.slice(0, 80), description: subject };
      }),
    };
  }

  // 检查项目符号列表
  if (lines.length >= 2 && lines.every(l => BULLETED_LINE_RE.test(l))) {
    return {
      strategy: 'bulleted',
      subtasks: lines.map(l => {
        const m = l.match(BULLETED_LINE_RE)!;
        const subject = m[1].trim();
        return { subject: subject.slice(0, 80), description: subject };
      }),
    };
  }

  // 检查连词拆分（含 "and" 或逗号的单行）
  if (lines.length === 1) {
    const parts = lines[0].split(CONJUNCTION_SPLIT_RE).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        strategy: 'conjunction',
        subtasks: parts.map(p => ({ subject: p.slice(0, 80), description: p })),
      };
    }
  }

  // 原子：不分解
  return {
    strategy: 'atomic',
    subtasks: [{ subject: task.slice(0, 80), description: task }],
  };
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function slugifyTask(task: string): string {
  const compact = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return compact.slice(0, 30).replace(/^-|-$/g, '') || 'team-task';
}

export function resolveAvailableTeamName(baseName: string, cwd: string): string {
  const sanitizedBase = slugifyTask(baseName);
  const stateRoot = join(getWiseRoot(cwd), 'state', 'team');
  const teamDir = (name: string) => join(stateRoot, name);
  if (!existsSync(teamDir(sanitizedBase))) return sanitizedBase;

  for (let suffix = 2; suffix <= 99; suffix++) {
    const suffixText = `-${suffix}`;
    const candidate = `${sanitizedBase.slice(0, 30 - suffixText.length).replace(/-$/g, '')}${suffixText}`;
    if (!existsSync(teamDir(candidate))) return candidate;
  }

  throw new Error(`Unable to allocate a fresh team name for ${sanitizedBase}; remove stale .wise/state/team entries or choose a more specific launch task.`);
}

export interface ParsedWorkerSpec {
  agentType: string;
  role?: string;
}

export interface ParsedTeamArgs {
  workerCount: number;
  agentTypes: string[];
  workerSpecs: ParsedWorkerSpec[];
  role?: string;
  task: string;
  teamName: string;
  json: boolean;
  newWindow: boolean;
  autoMerge: boolean;
  explicitWorkerSpec: boolean;
  noDecompose: boolean;
}

interface NormalizedWorkerSpecSegment {
  count: number;
  agentType: string;
  role?: string;
}

function isTeamStateLive(config: { tmux_session?: string } | null): boolean {
  const target = typeof config?.tmux_session === 'string' ? config.tmux_session.trim() : '';
  if (!target) return false;
  try {
    tmuxExec(['has-session', '-t', target], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getTeamWorkerIdentityFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const wise = typeof env.WISE_TEAM_WORKER === 'string' ? env.WISE_TEAM_WORKER.trim() : '';
  if (wise) return wise;
  const omx = typeof env.OMX_TEAM_WORKER === 'string' ? env.OMX_TEAM_WORKER.trim() : '';
  return omx || null;
}

export async function assertTeamSpawnAllowed(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const workerIdentity = getTeamWorkerIdentityFromEnv(env);
  const { teamReadConfig, teamReadManifest } = await import('../../team/team-ops.js');
  const { findActiveTeamsV2 } = await import('../../team/runtime-v2.js');
  const { DEFAULT_TEAM_GOVERNANCE, normalizeTeamGovernance } = await import('../../team/governance.js');

  if (workerIdentity) {
    const [parentTeamName] = workerIdentity.split('/');
    const parentManifest = parentTeamName ? await teamReadManifest(parentTeamName, cwd) : null;
    const governance = normalizeTeamGovernance(parentManifest?.governance, parentManifest?.policy);
    if (!governance.nested_teams_allowed) {
      throw new Error(
        `Worker context (${workerIdentity}) cannot start nested teams because nested_teams_allowed is false.`,
      );
    }
    if (!governance.delegation_only) {
      throw new Error(
        `Worker context (${workerIdentity}) cannot start nested teams because delegation_only is false.`,
      );
    }
    return;
  }

  const activeTeams = await findActiveTeamsV2(cwd);
  for (const activeTeam of activeTeams) {
    const config = await teamReadConfig(activeTeam, cwd);
    if (!isTeamStateLive(config)) continue;
    const manifest = await teamReadManifest(activeTeam, cwd);
    const governance = normalizeTeamGovernance(manifest?.governance, manifest?.policy);
    if (governance.one_team_per_leader_session ?? DEFAULT_TEAM_GOVERNANCE.one_team_per_leader_session) {
      throw new Error(
        `Leader session already owns active team "${activeTeam}" and one_team_per_leader_session is enabled.`,
      );
    }
  }
}

/** 单个 worker 规格段的正则：N[:type[:role]] */
const SINGLE_SPEC_RE = /^(\d+)(?::([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?)?$/i;

function normalizeWorkerSpecSegment(match: RegExpMatchArray): NormalizedWorkerSpecSegment {
  const count = Number.parseInt(match[1], 10);
  if (!Number.isFinite(count) || count < MIN_WORKER_COUNT || count > MAX_WORKER_COUNT) {
    throw new Error(`Invalid worker count "${match[1]}". Expected ${MIN_WORKER_COUNT}-${MAX_WORKER_COUNT}.`);
  }

  const token = match[2]?.toLowerCase();
  const explicitRole = match[3]?.toLowerCase();
  if (!token) {
    return { count, agentType: 'claude' };
  }

  if (explicitRole) {
    if (!VALID_TEAM_CLI_AGENT_TYPES.has(token)) {
      throw new Error(
        `Invalid agent type "${token}" in worker spec "${match[0]}". ` +
        `Expected one of: ${[...VALID_TEAM_CLI_AGENT_TYPES].join(', ')}. ` +
        `For a role-only shorthand on the default agent, use "${count}:${explicitRole}".`,
      );
    }
    return { count, agentType: token, role: explicitRole };
  }

  if (VALID_TEAM_CLI_AGENT_TYPES.has(token)) {
    return { count, agentType: token };
  }

  return { count, agentType: 'claude', role: token };
}

/** @internal 导出用于测试 */
export function parseTeamArgs(tokens: string[], defaultAgentType: string = 'claude'): ParsedTeamArgs {
  const args = [...tokens];
  let workerCount = 3;
  let agentTypes: string[] = [];
  let workerSpecs: ParsedWorkerSpec[] = [];
  let json = false;
  let newWindow = false;
  let autoMerge: boolean = process.env.WISE_TEAMS_AUTO_MERGE === '1';
  let noDecompose = false;
  const normalizedDefaultAgentType = VALID_TEAM_CLI_AGENT_TYPES.has(defaultAgentType as CliAgentType)
    ? defaultAgentType
    : DEFAULT_TEAM_CLI_AGENT_TYPE;

  // 在解析位置参数前先提取受支持的标志
  const filteredArgs: string[] = [];
  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--new-window') {
      newWindow = true;
    } else if (arg === '--auto-merge') {
      autoMerge = true;
    } else if (arg === '--no-decompose' || arg === '--fixed-workers' || arg === '--preformed-plan') {
      noDecompose = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  const first = filteredArgs[0] || '';

  // 先尝试逗号分隔的多类型规格（如 "1:codex,1:gemini" 或 "2:claude,1:codex:architect"）
  let role: string | undefined;
  let specMatched = false;
  let explicitWorkerSpec = false;

  if (first.includes(',')) {
    const segments = first.split(',');
    const parsedSegments: NormalizedWorkerSpecSegment[] = [];
    let allValid = true;

    for (const seg of segments) {
      const m = seg.match(SINGLE_SPEC_RE);
      if (!m) { allValid = false; break; }
      parsedSegments.push(normalizeWorkerSpecSegment(m));
    }

    if (allValid && parsedSegments.length > 0) {
      workerCount = 0;
      for (const seg of parsedSegments) {
        workerCount += seg.count;
        for (let i = 0; i < seg.count; i++) {
          agentTypes.push(seg.agentType);
          workerSpecs.push({ agentType: seg.agentType, ...(seg.role ? { role: seg.role } : {}) });
        }
      }
      if (workerCount > MAX_WORKER_COUNT) {
        throw new Error(`Total worker count ${workerCount} exceeds maximum ${MAX_WORKER_COUNT}.`);
      }
      // 若每段都指定了相同角色则采用；否则留 undefined
      const roles = parsedSegments.map(s => s.role);
      const uniqueRoles = [...new Set(roles)];
      if (uniqueRoles.length === 1 && uniqueRoles[0]) role = uniqueRoles[0];
      specMatched = true;
      explicitWorkerSpec = true;
      filteredArgs.shift();
    }
  }

  // 兜底为单个规格（如 "3:codex" 或 "2:codex:architect"）
  if (!specMatched) {
    const match = first.match(SINGLE_SPEC_RE);
    if (match) {
      const normalized = normalizeWorkerSpecSegment(match);
      workerCount = normalized.count;
      role = normalized.role;
      agentTypes = Array.from({ length: workerCount }, () => normalized.agentType);
      workerSpecs = Array.from({ length: workerCount }, () => ({
        agentType: normalized.agentType,
        ...(role ? { role } : {}),
      }));
      explicitWorkerSpec = true;
      filteredArgs.shift();
    }
  }

  // 明显形如 worker 规格（"N:<word>..."）却未能完整解析的 token，必须显式报错，
  // 而不是被静默吞入任务文本，否则会使团队默认使用 claude worker（见 #3224）。
  if (!explicitWorkerSpec && /^\d+:[a-z]/i.test(first)) {
    throw new Error(
      `Invalid worker spec "${first}". Expected "N:agent-type[:role]" ` +
      `(e.g. "3:codex" or "2:codex:architect"), optionally comma-separated ` +
      `(e.g. "1:codex,1:gemini"). Agent type must be one of: ${[...VALID_TEAM_CLI_AGENT_TYPES].join(', ')}.`,
    );
  }

  // 默认：3 个 worker，使用配置的默认 agent 类型（兜底为 claude）
  if (agentTypes.length === 0) {
    agentTypes = Array.from({ length: workerCount }, () => normalizedDefaultAgentType);
    workerSpecs = Array.from({ length: workerCount }, () => ({ agentType: normalizedDefaultAgentType }));
  }

  const task = filteredArgs.join(' ').trim();
  if (!task) {
    throw new Error('Usage: wise team [N:agent-type] "<task description>"');
  }

  const teamName = slugifyTask(task);
  return { workerCount, agentTypes, workerSpecs, role, task, teamName, json, newWindow, autoMerge, explicitWorkerSpec, noDecompose };
}

export function buildStartupTasks(parsed: ParsedTeamArgs): Array<{ subject: string; description: string; owner?: string; delegation?: TeamTaskDelegationPlan }> {
  return Array.from({ length: parsed.workerCount }, (_, index) => {
    const workerSpec = parsed.workerSpecs[index];
    const roleLabel = workerSpec?.role ? ` (${workerSpec.role})` : '';
    const delegation = inferDelegationPlanForTeamTask(parsed.task);
    return {
      subject: parsed.workerCount === 1
        ? parsed.task.slice(0, 80)
        : `Worker ${index + 1}${roleLabel}: ${parsed.task}`.slice(0, 80),
      description: parsed.task,
      ...(workerSpec?.role ? { owner: `worker-${index + 1}` } : {}),
      ...(delegation ? { delegation } : {}),
    };
  });
}

export interface TeamLaunchTask {
  subject: string;
  description: string;
  owner?: string;
  role?: string;
  delegation?: TeamTaskDelegationPlan;
}

export function buildTeamLaunchTasks(
  parsed: ParsedTeamArgs,
  decomposition: DecompositionPlan,
  effectiveWorkerCount: number,
): TeamLaunchTask[] {
  const tasks: TeamLaunchTask[] = [];

  // 编号/项目符号列表是用户亲自键入的显式预编写作用域，
  // 因此必须与显式 worker 数量对齐。`conjunction` 拆分仅是对自由文本中并行性的
  // 启发式猜测（如 "Read X and execute it then commit"），因此绝不能拒绝或重塑
  // 显式 worker 规格 — 每个 worker 都只接收完整的启动文本。(#3267)
  const isPreauthoredScopeList = decomposition.strategy === 'numbered'
    || decomposition.strategy === 'bulleted';

  if (parsed.explicitWorkerSpec
    && !parsed.noDecompose
    && isPreauthoredScopeList
    && decomposition.subtasks.length > 1
    && decomposition.subtasks.length !== effectiveWorkerCount) {
    throw new Error(
      `Pre-authored task scope count (${decomposition.subtasks.length}) must match explicit worker count (${effectiveWorkerCount}); use --no-decompose to give every worker the full launch text.`,
    );
  }

  const canUseDecomposition = !parsed.noDecompose
    && decomposition.strategy !== 'atomic'
    && decomposition.subtasks.length > 1
    && (!parsed.explicitWorkerSpec
      || (isPreauthoredScopeList && decomposition.subtasks.length === effectiveWorkerCount));

  for (let i = 0; i < effectiveWorkerCount; i++) {
    const workerSpec = parsed.workerSpecs[i];
    const roleLabel = workerSpec?.role ? ` (${workerSpec.role})` : '';
    const source = canUseDecomposition
      ? decomposition.subtasks[i]
      : undefined;
    const description = source?.description ?? parsed.task;
    const subject = source?.subject
      ?? (effectiveWorkerCount === 1
        ? parsed.task.slice(0, 80)
        : `Worker ${i + 1}${roleLabel}: ${parsed.task}`.slice(0, 80));
    const delegation = inferDelegationPlanForTeamTask(description);
    tasks.push({
      subject,
      description,
      owner: `worker-${i + 1}`,
      ...(workerSpec?.role ? { role: workerSpec.role } : {}),
      ...(delegation ? { delegation } : {}),
    });
  }

  return tasks;
}


function sampleValueForField(field: string): unknown {
  switch (field) {
    case 'team_name': return 'my-team';
    case 'from_worker': return 'worker-1';
    case 'to_worker': return 'leader-fixed';
    case 'worker': return 'worker-1';
    case 'body': return 'ACK';
    case 'subject': return 'Demo task';
    case 'description': return 'Created through CLI interop';
    case 'task_id': return '1';
    case 'message_id': return 'msg-123';
    case 'from': return 'in_progress';
    case 'to': return 'completed';
    case 'claim_token': return 'claim-token';
    case 'expected_version': return 1;
    case 'pid': return 12345;
    case 'turn_count': return 12;
    case 'alive': return true;
    case 'content': return '# Inbox update\nProceed with task 2.';
    case 'index': return 1;
    case 'role': return 'executor';
    case 'assigned_tasks': return ['1', '2'];
    case 'type': return 'task_completed';
    case 'requested_by': return 'leader-fixed';
    case 'min_updated_at': return '2026-03-04T00:00:00.000Z';
    case 'snapshot':
      return {
        taskStatusById: { '1': 'completed' },
        workerAliveByName: { 'worker-1': true },
        workerStateByName: { 'worker-1': 'idle' },
        workerTurnCountByName: { 'worker-1': 12 },
        workerTaskIdByName: { 'worker-1': '1' },
        mailboxNotifiedByMessageId: {},
        completedEventTaskIds: { '1': true },
      };
    case 'status': return 'approved';
    case 'reviewer': return 'leader-fixed';
    case 'decision_reason': return 'approved in demo';
    case 'required': return true;
    default: return `<${field}>`;
  }
}

function buildOperationHelp(operation: TeamApiOperation): string {
  const requiredFields = TEAM_API_OPERATION_REQUIRED_FIELDS[operation] ?? [];
  const optionalFields = TEAM_API_OPERATION_OPTIONAL_FIELDS[operation] ?? [];
  const sampleInput: Record<string, unknown> = {};

  for (const field of requiredFields) {
    sampleInput[field] = sampleValueForField(field);
  }
  const sampleInputJson = JSON.stringify(sampleInput);
  const required = requiredFields.length > 0
    ? requiredFields.map((field) => `  - ${field}`).join('\n')
    : '  (none)';
  const optional = optionalFields.length > 0
    ? `\nOptional input fields:\n${optionalFields.map((field) => `  - ${field}`).join('\n')}\n`
    : '\n';
  const note = TEAM_API_OPERATION_NOTES[operation]
    ? `\nNote:\n  ${TEAM_API_OPERATION_NOTES[operation]}\n`
    : '';

  return `
Usage: wise team api ${operation} --input <json> [--json]

Required input fields:
${required}${optional}${note}Example:
  wise team api ${operation} --input '${sampleInputJson}' --json
`.trim();
}

function parseTeamApiArgs(args: string[]): {
  operation: TeamApiOperation;
  input: Record<string, unknown>;
  json: boolean;
} {
  const operation = resolveTeamApiOperation(args[0] || '');
  if (!operation) {
    throw new Error(`Usage: wise team api <operation> [--input <json>] [--json]\nSupported operations: ${TEAM_API_OPERATIONS.join(', ')}`);
  }
  let input: Record<string, unknown> = {};
  let json = false;
  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--input') {
      const next = args[i + 1];
      if (!next) throw new Error('Missing value after --input');
      try {
        const parsed = JSON.parse(next) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('input must be a JSON object');
        }
        input = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(`Invalid --input JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      i += 1;
      continue;
    }
    if (token.startsWith('--input=')) {
      const raw = token.slice('--input='.length);
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('input must be a JSON object');
        }
        input = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(`Invalid --input JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    throw new Error(`Unknown argument for "wise team api": ${token}`);
  }
  return { operation, input, json };
}

// ---------------------------------------------------------------------------
// 团队启动（生成 tmux worker）
// ---------------------------------------------------------------------------

async function handleTeamStart(parsed: ParsedTeamArgs, cwd: string): Promise<void> {
  await assertTeamSpawnAllowed(cwd);

  // 尽可能将任务字符串分解为子任务
  const decomposition = splitTaskString(parsed.task);
  const effectiveWorkerCount = resolveTeamFanoutLimit(
    parsed.workerCount,
    parsed.agentTypes[0],
    parsed.explicitWorkerSpec ? parsed.workerCount : undefined,
    decomposition,
    parsed.noDecompose,
  );

  const tasks = buildTeamLaunchTasks(parsed, decomposition, effectiveWorkerCount);
  const launchTeamName = resolveAvailableTeamName(parsed.teamName, cwd);

  // 若指定了角色则加载角色 prompt（如 3:codex:architect）
  let rolePrompt: string | undefined;
  if (parsed.role) {
    const { loadAgentPrompt } = await import('../../agents/utils.js');
    rolePrompt = loadAgentPrompt(parsed.role);
  }

  // 默认使用 v2 运行时（可通过 WISE_RUNTIME_V2 关闭），否则兜底到 v1
  const { isRuntimeV2Enabled } = await import('../../team/runtime-v2.js');
  if (isRuntimeV2Enabled()) {
    const { startTeamV2, monitorTeamV2 } = await import('../../team/runtime-v2.js');
    const runtime = await startTeamV2({
      teamName: launchTeamName,
      workerCount: effectiveWorkerCount,
      agentTypes: parsed.agentTypes.slice(0, effectiveWorkerCount),
      tasks,
      cwd,
      newWindow: parsed.newWindow,
      workerRoles: parsed.workerSpecs.map((spec) => spec.role ?? spec.agentType),
      ...(rolePrompt ? { roleName: parsed.role, rolePrompt } : {}),
      ...(parsed.autoMerge ? { autoMerge: true } : {}),
    });

    const uniqueTypes = [...new Set(parsed.agentTypes)].join(',');

    if (parsed.json) {
      const snapshot = await monitorTeamV2(runtime.teamName, cwd);
      console.log(JSON.stringify({
        teamName: runtime.teamName,
        sessionName: runtime.sessionName,
        workerCount: runtime.config.worker_count,
        agentType: uniqueTypes,
        tasks: snapshot ? snapshot.tasks : null,
      }));
      return;
    }

    console.log(`Team started: ${runtime.teamName}`);
    console.log(`tmux session: ${runtime.sessionName}`);
    console.log(`workers: ${runtime.config.worker_count}`);
    console.log(`agent_type: ${uniqueTypes}`);

    const snapshot = await monitorTeamV2(runtime.teamName, cwd);
    if (snapshot) {
      console.log(`tasks: total=${snapshot.tasks.total} pending=${snapshot.tasks.pending} in_progress=${snapshot.tasks.in_progress} completed=${snapshot.tasks.completed} failed=${snapshot.tasks.failed}`);
    }
    return;
  }

  // v1 兜底
  const { startTeam, monitorTeam } = await import('../../team/runtime.js');
  const runtime = await startTeam({
    teamName: launchTeamName,
    workerCount: effectiveWorkerCount,
    agentTypes: parsed.agentTypes.slice(0, effectiveWorkerCount) as CliAgentType[],
    tasks,
    cwd,
    newWindow: parsed.newWindow,
  });

  const uniqueTypesV1 = [...new Set(parsed.agentTypes)].join(',');

  if (parsed.json) {
    const snapshot = await monitorTeam(runtime.teamName, cwd, runtime.workerPaneIds);
    console.log(JSON.stringify({
      teamName: runtime.teamName,
      sessionName: runtime.sessionName,
      workerCount: runtime.workerNames.length,
      agentType: uniqueTypesV1,
      tasks: snapshot ? {
        total: snapshot.taskCounts.pending + snapshot.taskCounts.inProgress + snapshot.taskCounts.completed + snapshot.taskCounts.failed,
        pending: snapshot.taskCounts.pending,
        in_progress: snapshot.taskCounts.inProgress,
        completed: snapshot.taskCounts.completed,
        failed: snapshot.taskCounts.failed,
      } : null,
    }));
    return;
  }

  console.log(`Team started: ${runtime.teamName}`);
  console.log(`tmux session: ${runtime.sessionName}`);
  console.log(`workers: ${runtime.workerNames.length}`);
  console.log(`agent_type: ${uniqueTypesV1}`);

  const snapshot = await monitorTeam(runtime.teamName, cwd, runtime.workerPaneIds);
  if (snapshot) {
    console.log(`tasks: total=${snapshot.taskCounts.pending + snapshot.taskCounts.inProgress + snapshot.taskCounts.completed + snapshot.taskCounts.failed} pending=${snapshot.taskCounts.pending} in_progress=${snapshot.taskCounts.inProgress} completed=${snapshot.taskCounts.completed} failed=${snapshot.taskCounts.failed}`);
  }
}

// ---------------------------------------------------------------------------
// 团队状态
// ---------------------------------------------------------------------------

async function handleTeamStatus(teamName: string, cwd: string): Promise<void> {
  const { isRuntimeV2Enabled } = await import('../../team/runtime-v2.js');
  if (isRuntimeV2Enabled()) {
    const { monitorTeamV2 } = await import('../../team/runtime-v2.js');
    const { deriveTeamLeaderGuidance } = await import('../../team/leader-nudge-guidance.js');
    const { readTeamEventsByType } = await import('../../team/events.js');
    const snapshot = await monitorTeamV2(teamName, cwd);
    if (!snapshot) {
      console.log(`No team state found for ${teamName}`);
      return;
    }
    const leaderGuidance = deriveTeamLeaderGuidance({
      tasks: {
        pending: snapshot.tasks.pending,
        blocked: snapshot.tasks.blocked,
        inProgress: snapshot.tasks.in_progress,
        completed: snapshot.tasks.completed,
        failed: snapshot.tasks.failed,
      },
      workers: {
        total: snapshot.workers.length,
        alive: snapshot.workers.filter((worker) => worker.alive).length,
        idle: snapshot.workers.filter((worker) => worker.alive && (worker.status.state === 'idle' || worker.status.state === 'done')).length,
        nonReporting: snapshot.nonReportingWorkers.length,
      },
    });
    const latestLeaderNudge = (await readTeamEventsByType(teamName, 'team_leader_nudge', cwd)).at(-1);
    const { readTeamConfig } = await import('../../team/monitor.js');
    const config = await readTeamConfig(teamName, cwd);
    console.log(`team=${snapshot.teamName} phase=${snapshot.phase}`);
    console.log(`workspace_mode=${config?.workspace_mode ?? 'single'} worktree_mode=${config?.worktree_mode ?? 'disabled'} team_state_root=${config?.team_state_root ?? 'n/a'}`);
    console.log(`workers: total=${snapshot.workers.length}`);
    for (const worker of config?.workers ?? []) {
      console.log(`worker=${worker.name} working_dir=${worker.working_dir ?? 'n/a'} worktree_repo_root=${worker.worktree_repo_root ?? 'n/a'} worktree_path=${worker.worktree_path ?? 'n/a'} worktree_branch=${worker.worktree_branch ?? 'n/a'} worktree_detached=${String(worker.worktree_detached ?? false)} worktree_created=${String(worker.worktree_created ?? false)}`);
    }
    console.log(`tasks: total=${snapshot.tasks.total} pending=${snapshot.tasks.pending} blocked=${snapshot.tasks.blocked} in_progress=${snapshot.tasks.in_progress} completed=${snapshot.tasks.completed} failed=${snapshot.tasks.failed}`);
    console.log(`leader_next_action=${leaderGuidance.nextAction}`);
    console.log(`leader_guidance=${leaderGuidance.message}`);
    if (latestLeaderNudge) {
      console.log(
        `latest_leader_nudge action=${latestLeaderNudge.next_action ?? 'unknown'} at=${latestLeaderNudge.created_at} reason=${latestLeaderNudge.reason ?? 'n/a'}`,
      );
    }
    return;
  }

  // v1 兜底
  const { monitorTeam } = await import('../../team/runtime.js');
  const snapshot = await monitorTeam(teamName, cwd, []);
  if (!snapshot) {
    console.log(`No team state found for ${teamName}`);
    return;
  }
  console.log(`team=${snapshot.teamName} phase=${snapshot.phase}`);
  console.log(`tasks: pending=${snapshot.taskCounts.pending} in_progress=${snapshot.taskCounts.inProgress} completed=${snapshot.taskCounts.completed} failed=${snapshot.taskCounts.failed}`);
}

// ---------------------------------------------------------------------------
// 团队关闭
// ---------------------------------------------------------------------------

async function handleTeamShutdown(teamName: string, cwd: string, force: boolean): Promise<void> {
  const { isRuntimeV2Enabled } = await import('../../team/runtime-v2.js');
  if (isRuntimeV2Enabled()) {
    const { shutdownTeamV2 } = await import('../../team/runtime-v2.js');
    await shutdownTeamV2(teamName, cwd, { force });
    console.log(`Team shutdown complete: ${teamName}`);
    return;
  }

  // v1 兜底
  const { shutdownTeam } = await import('../../team/runtime.js');
  await shutdownTeam(teamName, `wise-team-${teamName}`, cwd);
  console.log(`Team shutdown complete: ${teamName}`);
}

// ---------------------------------------------------------------------------
// API 子命令处理器
// ---------------------------------------------------------------------------

async function handleTeamApi(args: string[], cwd: string): Promise<void> {
  const apiSubcommand = (args[0] || '').toLowerCase();

  // wise team api --help
  if (HELP_TOKENS.has(apiSubcommand)) {
    const operationFromHelpAlias = resolveTeamApiOperation((args[1] || '').toLowerCase());
    if (operationFromHelpAlias) {
      console.log(buildOperationHelp(operationFromHelpAlias));
      return;
    }
    console.log(TEAM_API_HELP.trim());
    return;
  }

  // wise team api <operation> --help
  const operation = resolveTeamApiOperation(apiSubcommand);
  if (operation) {
    const trailing = args.slice(1).map((token) => token.toLowerCase());
    if (trailing.some((token) => HELP_TOKENS.has(token))) {
      console.log(buildOperationHelp(operation));
      return;
    }
  }

  const wantsJson = args.includes('--json');
  const jsonBase = {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
  };

  let parsedApi: ReturnType<typeof parseTeamApiArgs>;
  try {
    parsedApi = parseTeamApiArgs(args);
  } catch (error) {
    if (wantsJson) {
      console.log(JSON.stringify({
        ...jsonBase,
        ok: false,
        command: 'wise team api',
        operation: 'unknown',
        error: {
          code: 'invalid_input',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const envelope = await executeTeamApiOperation(parsedApi.operation, parsedApi.input, cwd);
  if (parsedApi.json) {
    console.log(JSON.stringify({
      ...jsonBase,
      command: `wise team api ${parsedApi.operation}`,
      ...envelope,
    }));
    if (!envelope.ok) process.exitCode = 1;
    return;
  }
  if (envelope.ok) {
    console.log(`ok operation=${envelope.operation}`);
    console.log(JSON.stringify(envelope.data, null, 2));
    return;
  }
  console.error(`error operation=${envelope.operation} code=${envelope.error.code}: ${envelope.error.message}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 主 team 子命令处理器。
 * 路由：
 *   wise team [N:agent-type] "task"          -> 启动团队
 *   wise team status <team-name>             -> 监控
 *   wise team shutdown <team-name> [--force] -> 关闭
 *   wise team api <operation> [--input] ...  -> Worker CLI API
 */
export async function teamCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [subcommandRaw] = args;
  const subcommand = (subcommandRaw || '').toLowerCase();

  if (HELP_TOKENS.has(subcommand) || !subcommand) {
    console.log(TEAM_HELP.trim());
    return;
  }

  // wise team api <operation> ...
  if (subcommand === 'api') {
    await handleTeamApi(args.slice(1), cwd);
    return;
  }

  // wise team status <team-name>
  if (subcommand === 'status') {
    const name = args[1];
    if (!name) throw new Error('Usage: wise team status <team-name>');
    await handleTeamStatus(name, cwd);
    return;
  }

  // wise team shutdown <team-name> [--force]
  if (subcommand === 'shutdown') {
    const nameOrFlag = args.filter(a => !a.startsWith('--'));
    const name = nameOrFlag[1]; // 跳过 'shutdown' 本身
    if (!name) throw new Error('Usage: wise team shutdown <team-name> [--force]');
    const force = args.includes('--force');
    await handleTeamShutdown(name, cwd, force);
    return;
  }

  // 默认：wise team [N:agent-type] "task" -> 启动团队
  try {
    // 当用户未提供 N:agent-type 时，遵循 team.ops.defaultAgentType。
    const cfg = loadConfig();
    const defaultAgentType = cfg.team?.ops?.defaultAgentType ?? DEFAULT_TEAM_CLI_AGENT_TYPE;
    const parsed = parseTeamArgs(args, defaultAgentType);
    await handleTeamStart(parsed, cwd);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(TEAM_HELP.trim());
    process.exitCode = 1;
  }
}
