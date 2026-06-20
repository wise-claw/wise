/**
 * PreCompact 钩子——上下文压缩前的状态保留
 *
 * 在压缩前创建检查点以保留关键状态，包括：
 * - 活动模式状态（autopilot、ralph、ultrawork）
 * - TODO 摘要
 * - 来自记事本的 wisdom
 *
 * 确保上下文窗口压缩期间不会丢失关键信息。
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { promises as fsPromises } from "fs";
import { join } from "path";
import { getWiseRoot } from '../../lib/worktree-paths.js';
import { initJobDb, getActiveJobs, getRecentJobs, getJobStats } from '../../lib/job-state-db.js';

// ============================================================================
// 类型
// ============================================================================

export interface PreCompactInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: "PreCompact";
  trigger: "manual" | "auto";
  custom_instructions?: string;
}

export interface CompactCheckpoint {
  created_at: string;
  trigger: "manual" | "auto";
  active_modes: {
    autopilot?: { phase: string; originalIdea: string };
    ralph?: { iteration: number; prompt: string };
    ultrawork?: { original_prompt: string };
    ultraqa?: { cycle: number; prompt: string };
  };
  todo_summary: {
    pending: number;
    in_progress: number;
    completed: number;
  };
  wisdom_exported: boolean;
  background_jobs?: {
    active: Array<{ jobId: string; provider: string; model: string; agentRole: string; spawnedAt: string }>;
    recent: Array<{ jobId: string; provider: string; status: string; agentRole: string; completedAt?: string }>;
    stats: { total: number; active: number; completed: number; failed: number } | null;
  };
}

export interface HookOutput {
  continue: boolean;
  /** 用于上下文注入的系统消息（兼容 Claude Code） */
  systemMessage?: string;
}

// ============================================================================
// 常量
// ============================================================================

const CHECKPOINT_DIR = "checkpoints";

// ============================================================================
// 压缩互斥锁——防止同一目录并发压缩
// ============================================================================

/**
 * 每个目录的进行中压缩 Promise。
 * 当某目录已有压缩在运行时，新的调用方等待已有 Promise，
 * 而非并发运行。避免多个子代理结果同时到达（ultrawork/team）时的竞态。
 */
const inflightCompactions = new Map<string, Promise<HookOutput>>();

/**
 * 每个目录的队列深度计数器，用于诊断。
 * 跟踪有多少调用方正在等待进行中的压缩。
 */
const compactionQueueDepth = new Map<string, number>();

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取检查点目录路径
 */
export function getCheckpointPath(directory: string): string {
  const checkpointDir = join(getWiseRoot(directory), "state", CHECKPOINT_DIR);
  if (!existsSync(checkpointDir)) {
    mkdirSync(checkpointDir, { recursive: true });
  }
  return checkpointDir;
}

/**
 * 将记事本中的 wisdom 导出到检查点
 */
export async function exportWisdomToNotepad(
  directory: string,
): Promise<{ wisdom: string; exported: boolean }> {
  const notepadsDir = join(getWiseRoot(directory), "notepads");

  if (!existsSync(notepadsDir)) {
    return { wisdom: "", exported: false };
  }

  const wisdomParts: string[] = [];
  let hasWisdom = false;

  try {
    // 读取所有 plan 目录
    const planDirs = readdirSync(notepadsDir).filter((name) => {
      const path = join(notepadsDir, name);
      return statSync(path).isDirectory();
    });

    for (const planDir of planDirs) {
      const planPath = join(notepadsDir, planDir);
      const wisdomFiles = [
        "learnings.md",
        "decisions.md",
        "issues.md",
        "problems.md",
      ];

      for (const wisdomFile of wisdomFiles) {
        const wisdomPath = join(planPath, wisdomFile);
        if (existsSync(wisdomPath)) {
          const content = readFileSync(wisdomPath, "utf-8").trim();
          if (content) {
            wisdomParts.push(`### ${planDir}/${wisdomFile}\n${content}`);
            hasWisdom = true;
          }
        }
      }
    }
  } catch (error) {
    console.error("[PreCompact] Error reading wisdom files:", error);
  }

  const wisdom =
    wisdomParts.length > 0
      ? `## Plan Wisdom\n\n${wisdomParts.join("\n\n")}`
      : "";

  return { wisdom, exported: hasWisdom };
}

/**
 * 保存活动模式摘要
 */
export async function saveModeSummary(
  directory: string,
): Promise<Record<string, unknown>> {
  const stateDir = join(getWiseRoot(directory), "state");
  const modes: Record<string, unknown> = {};

  const stateFiles = [
    {
      file: "autopilot-state.json",
      key: "autopilot",
      extract: (s: any) =>
        s.active
          ? { phase: s.phase || "unknown", originalIdea: s.originalIdea || "" }
          : null,
    },
    {
      file: "ralph-state.json",
      key: "ralph",
      extract: (s: any) =>
        s.active
          ? {
              iteration: s.iteration || 0,
              prompt: s.originalPrompt || s.prompt || "",
            }
          : null,
    },
    {
      file: "ultrawork-state.json",
      key: "ultrawork",
      extract: (s: any) =>
        s.active
          ? { original_prompt: s.original_prompt || s.prompt || "" }
          : null,
    },
    {
      file: "ultraqa-state.json",
      key: "ultraqa",
      extract: (s: any) =>
        s.active
          ? { cycle: s.cycle || 0, prompt: s.original_prompt || s.prompt || "" }
          : null,
    },
  ];

  const reads = stateFiles.map(async (config) => {
    const path = join(stateDir, config.file);
    try {
      const content = await fsPromises.readFile(path, "utf-8");
      const state = JSON.parse(content);
      const extracted = config.extract(state);
      return extracted ? { key: config.key, value: extracted } : null;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      console.error(`[PreCompact] Error reading ${config.file}:`, error);
      return null;
    }
  });

  const results = await Promise.all(reads);

  for (const result of results) {
    if (result) {
      modes[result.key] = result.value;
    }
  }

  return modes;
}

/**
 * 从 todos.json 读取 TODO 计数
 */
function readTodoSummary(directory: string): {
  pending: number;
  in_progress: number;
  completed: number;
} {
  const todoPaths = [
    join(directory, ".claude", "todos.json"),
    join(getWiseRoot(directory), "state", "todos.json"),
  ];

  for (const todoPath of todoPaths) {
    if (existsSync(todoPath)) {
      try {
        const content = readFileSync(todoPath, "utf-8");
        const todos = JSON.parse(content);

        if (Array.isArray(todos)) {
          return {
            pending: todos.filter((t: any) => t.status === "pending").length,
            in_progress: todos.filter((t: any) => t.status === "in_progress")
              .length,
            completed: todos.filter((t: any) => t.status === "completed")
              .length,
          };
        }
      } catch {
        // 继续检查下一个路径
      }
    }
  }

  return { pending: 0, in_progress: 0, completed: 0 };
}

/**
 * 从 SQLite DB 获取活动与近期后台任务摘要
 * 查询 .wise/state/jobs.db 获取 Codex/Gemini 任务状态
 */
async function getActiveJobsSummary(directory: string): Promise<{
  activeJobs: Array<{ jobId: string; provider: string; model: string; agentRole: string; spawnedAt: string }>;
  recentJobs: Array<{ jobId: string; provider: string; status: string; agentRole: string; completedAt?: string }>;
  stats: { total: number; active: number; completed: number; failed: number } | null;
}> {
  try {
    const dbReady = await initJobDb(directory);
    if (!dbReady) {
      return { activeJobs: [], recentJobs: [], stats: null };
    }

    const active = getActiveJobs(undefined, directory);
    const recent = getRecentJobs(undefined, 5 * 60 * 1000, directory); // 最近 5 分钟

    // 过滤近期任务，仅保留已完成/失败（不含已列出的活动任务）
    const recentCompleted = recent.filter(j => j.status === 'completed' || j.status === 'failed');

    const stats = getJobStats(directory);

    return {
      activeJobs: active.map(j => ({
        jobId: j.jobId,
        provider: j.provider,
        model: j.model,
        agentRole: j.agentRole,
        spawnedAt: j.spawnedAt,
      })),
      recentJobs: recentCompleted.slice(0, 10).map(j => ({
        jobId: j.jobId,
        provider: j.provider,
        status: j.status,
        agentRole: j.agentRole,
        completedAt: j.completedAt,
      })),
      stats,
    };
  } catch (error) {
    console.error('[PreCompact] Error reading job state DB:', error);
    return { activeJobs: [], recentJobs: [], stats: null };
  }
}

/**
 * 创建压缩检查点
 */
export async function createCompactCheckpoint(
  directory: string,
  trigger: "manual" | "auto",
): Promise<CompactCheckpoint> {
  const activeModes = await saveModeSummary(directory);
  const todoSummary = readTodoSummary(directory);
  const jobsSummary = await getActiveJobsSummary(directory);

  return {
    created_at: new Date().toISOString(),
    trigger,
    active_modes: activeModes as CompactCheckpoint["active_modes"],
    todo_summary: todoSummary,
    wisdom_exported: false,
    background_jobs: {
      active: jobsSummary.activeJobs,
      recent: jobsSummary.recentJobs,
      stats: jobsSummary.stats,
    },
  };
}

/**
 * 格式化检查点摘要用于上下文注入
 */
export function formatCompactSummary(checkpoint: CompactCheckpoint): string {
  const lines: string[] = [
    "# PreCompact Checkpoint",
    "",
    `Created: ${checkpoint.created_at}`,
    `Trigger: ${checkpoint.trigger}`,
    "",
  ];

  // 活动模式
  const modeCount = Object.keys(checkpoint.active_modes).length;
  if (modeCount > 0) {
    lines.push("## Active Modes");
    lines.push("");

    if (checkpoint.active_modes.autopilot) {
      const ap = checkpoint.active_modes.autopilot;
      lines.push(`- **Autopilot** (Phase: ${ap.phase})`);
      lines.push(`  Original Idea: ${ap.originalIdea}`);
    }

    if (checkpoint.active_modes.ralph) {
      const ralph = checkpoint.active_modes.ralph;
      lines.push(`- **Ralph** (Iteration: ${ralph.iteration})`);
      lines.push(`  Prompt: ${ralph.prompt}`);
    }

    if (checkpoint.active_modes.ultrawork) {
      const uw = checkpoint.active_modes.ultrawork;
      lines.push(`- **Ultrawork**`);
      lines.push(`  Prompt: ${uw.original_prompt}`);
    }

    if (checkpoint.active_modes.ultraqa) {
      const qa = checkpoint.active_modes.ultraqa;
      lines.push(`- **UltraQA** (Cycle: ${qa.cycle})`);
      lines.push(`  Prompt: ${qa.prompt}`);
    }

    lines.push("");
  }

  // TODO 摘要
  const total =
    checkpoint.todo_summary.pending +
    checkpoint.todo_summary.in_progress +
    checkpoint.todo_summary.completed;

  if (total > 0) {
    lines.push("## TODO Summary");
    lines.push("");
    lines.push(`- Pending: ${checkpoint.todo_summary.pending}`);
    lines.push(`- In Progress: ${checkpoint.todo_summary.in_progress}`);
    lines.push(`- Completed: ${checkpoint.todo_summary.completed}`);
    lines.push("");
  }

  // 后台任务
  const jobs = checkpoint.background_jobs;
  if (jobs && (jobs.active.length > 0 || jobs.recent.length > 0)) {
    lines.push("## Background Jobs (Codex/Gemini)");
    lines.push("");

    if (jobs.active.length > 0) {
      lines.push("### Currently Running");
      for (const job of jobs.active) {
        const age = Math.round((Date.now() - new Date(job.spawnedAt).getTime()) / 1000);
        lines.push(`- **${job.jobId}** ${job.provider}/${job.model} (${job.agentRole}) - ${age}s ago`);
      }
      lines.push("");
    }

    if (jobs.recent.length > 0) {
      lines.push("### Recently Completed");
      for (const job of jobs.recent) {
        const icon = job.status === 'completed' ? 'OK' : 'FAIL';
        lines.push(`- **${job.jobId}** [${icon}] ${job.provider} (${job.agentRole})`);
      }
      lines.push("");
    }

    if (jobs.stats) {
      lines.push(`**Job Stats:** ${jobs.stats.active} active, ${jobs.stats.completed} completed, ${jobs.stats.failed} failed (${jobs.stats.total} total)`);
      lines.push("");
    }
  }

  // Wisdom 状态
  if (checkpoint.wisdom_exported) {
    lines.push("## Wisdom");
    lines.push("");
    lines.push("Plan wisdom has been preserved in checkpoint.");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "**Note:** This checkpoint preserves critical state before compaction.",
  );
  lines.push("Review active modes to ensure continuity after compaction.");

  return lines.join("\n");
}

/**
 * 内部压缩逻辑（未序列化）。
 * 调用方必须经由 processPreCompact，由其强制互斥。
 */
async function doProcessPreCompact(
  input: PreCompactInput,
): Promise<HookOutput> {
  const directory = input.cwd;

  // 创建检查点
  const checkpoint = await createCompactCheckpoint(directory, input.trigger);

  // 导出 wisdom
  const { wisdom, exported } = await exportWisdomToNotepad(directory);
  checkpoint.wisdom_exported = exported;

  // 保存检查点
  const checkpointPath = getCheckpointPath(directory);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const checkpointFile = join(checkpointPath, `checkpoint-${timestamp}.json`);

  try {
    writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), "utf-8");
  } catch (error) {
    console.error("[PreCompact] Error saving checkpoint:", error);
  }

  // 若已导出则单独保存 wisdom
  if (exported && wisdom) {
    const wisdomFile = join(checkpointPath, `wisdom-${timestamp}.md`);
    try {
      writeFileSync(wisdomFile, wisdom, "utf-8");
    } catch (error) {
      console.error("[PreCompact] Error saving wisdom:", error);
    }
  }

  // 格式化摘要用于上下文注入
  const summary = formatCompactSummary(checkpoint);

  // 注意：hookSpecificOutput 仅支持 PreToolUse、UserPromptSubmit、PostToolUse
  // 自定义钩子事件（如 PreCompact）使用 systemMessage
  return {
    continue: true,
    systemMessage: summary,
  };
}

/**
 * PreCompact 钩子的主处理器。
 *
 * 使用按目录的互斥锁防止并发压缩。
 * 当多个子代理结果同时到达（ultrawork/team）时，
 * 仅首次调用执行压缩；后续调用等待进行中的结果。修复 issue #453。
 */
export async function processPreCompact(
  input: PreCompactInput,
): Promise<HookOutput> {
  const directory = input.cwd;

  // 若该目录已有压缩进行中，则合并
  const inflight = inflightCompactions.get(directory);
  if (inflight) {
    const depth = (compactionQueueDepth.get(directory) ?? 0) + 1;
    compactionQueueDepth.set(directory, depth);
    try {
      // 等待已有压缩的结果
      return await inflight;
    } finally {
      const current = compactionQueueDepth.get(directory) ?? 1;
      if (current <= 1) {
        compactionQueueDepth.delete(directory);
      } else {
        compactionQueueDepth.set(directory, current - 1);
      }
    }
  }

  // 无进行中的压缩——执行并注册 Promise
  const compactionPromise = doProcessPreCompact(input);
  inflightCompactions.set(directory, compactionPromise);

  try {
    return await compactionPromise;
  } finally {
    inflightCompactions.delete(directory);
  }
}

/**
 * 检查某目录当前是否有压缩进行中。
 * 用于诊断与测试。
 */
export function isCompactionInProgress(directory: string): boolean {
  return inflightCompactions.has(directory);
}

/**
 * 获取排队等待进行中压缩的调用方数量。
 * 无压缩进行中时返回 0。
 */
export function getCompactionQueueDepth(directory: string): number {
  return compactionQueueDepth.get(directory) ?? 0;
}

// ============================================================================
// 导出
// ============================================================================

export default processPreCompact;
