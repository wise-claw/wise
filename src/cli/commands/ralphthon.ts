/**
 * wise ralphthon CLI 子命令
 *
 * 自主 hackathon 生命周期：
 *   wise ralphthon "task"                  启动新的 ralphthon 会话
 *   wise ralphthon --resume                恢复已有会话
 *   wise ralphthon --skip-interview "task" 跳过 deep-interview，直接使用任务
 *   wise ralphthon --max-waves 5           设置最大硬化轮数
 *   wise ralphthon --poll-interval 60      设置轮询间隔（秒）
 */

import chalk from "chalk";
import { tmuxShell } from "../../cli/tmux-utils.js";
import { existsSync } from "fs";
import {
  readRalphthonPrd,
  readRalphthonState,
  writeRalphthonState,
  clearRalphthonState,
  initOrchestrator,
  startOrchestratorLoop,
  formatRalphthonStatus,
  getRalphthonPrdPath,
  initRalphthonPrd,
  sendKeysToPane,
} from "../../ralphthon/index.js";
import type {
  RalphthonCliOptions,
  OrchestratorEvent,
  RalphthonConfig,
  RalphthonPlanningContext,
  RalphthonStory,
} from "../../ralphthon/types.js";
import { RALPHTHON_DEFAULTS } from "../../ralphthon/types.js";

// ============================================================================
// 帮助文本
// ============================================================================

const RALPHTHON_HELP = `
Usage: wise ralphthon [options] [task]

Autonomous hackathon lifecycle mode.
Generates PRD via deep-interview, executes all tasks with ralph loop,
then auto-hardens until clean.

Options:
  --resume              Resume an existing ralphthon session
  --skip-interview      Skip deep-interview, start execution directly
  --max-waves <n>       Maximum hardening waves (default: ${RALPHTHON_DEFAULTS.maxWaves})
  --poll-interval <s>   Poll interval in seconds (default: ${RALPHTHON_DEFAULTS.pollIntervalMs / 1000})
  --help, -h            Show this help

Examples:
  wise ralphthon "Build a REST API for user management"
  wise ralphthon --skip-interview "Implement auth middleware"
  wise ralphthon --resume
  wise ralphthon --max-waves 5 --poll-interval 60 "Add caching layer"
`;

// ============================================================================
// 参数解析
// ============================================================================

/**
 * 解析 ralphthon CLI 参数
 */
export function parseRalphthonArgs(args: string[]): RalphthonCliOptions {
  const options: RalphthonCliOptions = {
    resume: false,
    skipInterview: false,
    maxWaves: RALPHTHON_DEFAULTS.maxWaves,
    pollInterval: RALPHTHON_DEFAULTS.pollIntervalMs / 1000,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--resume":
        options.resume = true;
        break;
      case "--skip-interview":
        options.skipInterview = true;
        break;
      case "--max-waves": {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val) && val > 0) options.maxWaves = val;
        break;
      }
      case "--poll-interval": {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val) && val > 0) options.pollInterval = val;
        break;
      }
      case "--help":
      case "-h":
        console.log(RALPHTHON_HELP);
        process.exit(0);
        break;
      default:
        if (!arg.startsWith("--")) {
          positional.push(arg);
        }
        break;
    }
  }

  if (positional.length > 0) {
    options.task = positional.join(" ");
  }

  return options;
}

export function buildRalphthonPlanningContext(
  task: string,
): RalphthonPlanningContext {
  return {
    brownfield: true,
    assumptionsMode: "explicit",
    codebaseMapSummary: `Brownfield target: ${task.slice(0, 160)}`,
    knownConstraints: [
      "Prefer repository evidence over assumptions",
      "Capture brownfield/codebase-map findings explicitly before execution",
    ],
  };
}

export function buildRalphthonInterviewPrompt(
  task: string,
  options: RalphthonCliOptions,
): string {
  const sanitizedTask = task.replace(/[\r\n\0]+/g, " ").trim();
  return `/deep-interview ${sanitizedTask}

After the interview, generate a ralphthon-prd.json file in .wise/ with this structure:
{
  "project": "<project name>",
  "branchName": "<branch>",
  "description": "<description>",
  "stories": [{ "id": "US-001", "title": "...", "description": "...", "acceptanceCriteria": [...], "priority": "high", "tasks": [{ "id": "T-001", "title": "...", "description": "...", "status": "pending", "retries": 0 }] }],
  "hardening": [],
  "config": { "maxWaves": ${options.maxWaves}, "cleanWavesForTermination": 3, "pollIntervalMs": ${options.pollInterval * 1000}, "idleThresholdMs": 30000, "maxRetries": 3, "skipInterview": false },
  "planningContext": {
    "brownfield": true,
    "assumptionsMode": "explicit",
    "codebaseMapSummary": "<brief brownfield/codebase-map summary>",
    "knownConstraints": ["<constraint>"]
  }
}

Treat this as brownfield planning. Summarize the existing codebase/module context explicitly instead of relying on implicit rediscovery.`;
}

export function buildDefaultSkipInterviewStories(
  task: string,
): RalphthonStory[] {
  return [
    {
      id: "US-001",
      title: task.slice(0, 60),
      description: task,
      acceptanceCriteria: [
        "Implementation complete",
        "Tests pass",
        "No type errors",
      ],
      priority: "high",
      tasks: [
        {
          id: "T-001",
          title: task.slice(0, 60),
          description: task,
          status: "pending",
          retries: 0,
        },
      ],
    },
  ];
}

export function buildDefaultSkipInterviewPrdParams(task: string): {
  project: string;
  branchName: string;
  description: string;
  stories: RalphthonStory[];
  planningContext: RalphthonPlanningContext;
} {
  return {
    project: "ralphthon",
    branchName: "feat/ralphthon",
    description: task,
    stories: buildDefaultSkipInterviewStories(task),
    planningContext: buildRalphthonPlanningContext(task),
  };
}

// ============================================================================
// 事件处理器
// ============================================================================

function createEventLogger(): (event: OrchestratorEvent) => void {
  return (event: OrchestratorEvent) => {
    const ts = new Date().toLocaleTimeString();

    switch (event.type) {
      case "task_injected":
        console.log(chalk.cyan(`[${ts}] Task injected: ${event.taskTitle}`));
        break;
      case "task_completed":
        console.log(chalk.green(`[${ts}] Task completed: ${event.taskId}`));
        break;
      case "task_failed":
        console.log(
          chalk.yellow(
            `[${ts}] Task failed: ${event.taskId} (retry ${event.retries})`,
          ),
        );
        break;
      case "task_skipped":
        console.log(
          chalk.red(`[${ts}] Task skipped: ${event.taskId} — ${event.reason}`),
        );
        break;
      case "phase_transition":
        console.log(
          chalk.magenta(`[${ts}] Phase: ${event.from} -> ${event.to}`),
        );
        break;
      case "hardening_wave_start":
        console.log(chalk.blue(`[${ts}] Hardening wave ${event.wave} started`));
        break;
      case "hardening_wave_end":
        console.log(
          chalk.blue(
            `[${ts}] Hardening wave ${event.wave} ended — ${event.newIssues} new issues`,
          ),
        );
        break;
      case "idle_detected":
        console.log(
          chalk.gray(
            `[${ts}] Leader idle for ${Math.round(event.durationMs / 1000)}s`,
          ),
        );
        break;
      case "session_complete":
        console.log(
          chalk.green.bold(
            `[${ts}] Ralphthon complete! ${event.tasksCompleted} done, ${event.tasksSkipped} skipped`,
          ),
        );
        break;
      case "error":
        console.log(chalk.red(`[${ts}] Error: ${event.message}`));
        break;
    }
  };
}

// ============================================================================
// Tmux 辅助函数
// ============================================================================

function getCurrentTmuxSession(): string | null {
  try {
    return tmuxShell("display-message -p '#S'", {
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function getCurrentTmuxPane(): string | null {
  try {
    return tmuxShell("display-message -p '#{pane_id}'", {
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

// ============================================================================
// 主命令
// ============================================================================

/**
 * 执行 ralphthon CLI 命令
 */
export async function ralphthonCommand(args: string[]): Promise<void> {
  const options = parseRalphthonArgs(args);
  const cwd = process.cwd();

  // 恢复模式
  if (options.resume) {
    const state = readRalphthonState(cwd);
    if (!state || !state.active) {
      console.error(chalk.red("No active ralphthon session found to resume."));
      process.exit(1);
    }

    console.log(chalk.blue("Resuming ralphthon session..."));
    const prd = readRalphthonPrd(cwd);
    if (prd) {
      console.log(formatRalphthonStatus(prd));
    }

    const eventLogger = createEventLogger();
    const { stop } = startOrchestratorLoop(cwd, state.sessionId, eventLogger);

    // 处理优雅关闭
    const shutdown = () => {
      console.log(chalk.yellow("\nStopping ralphthon orchestrator..."));
      stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    return;
  }

  // 新会话 — 需要任务描述
  if (!options.task) {
    console.error(
      chalk.red('Task description required. Usage: wise ralphthon "your task"'),
    );
    console.log(RALPHTHON_HELP);
    process.exit(1);
  }

  // 必须位于 tmux 内
  if (!isInsideTmux()) {
    console.error(
      chalk.red(
        "Ralphthon requires tmux. Run inside a tmux session or use `wise` to launch one.",
      ),
    );
    process.exit(1);
  }

  const tmuxSession = getCurrentTmuxSession();
  const leaderPane = getCurrentTmuxPane();

  if (!tmuxSession || !leaderPane) {
    console.error(chalk.red("Could not detect tmux session/pane."));
    process.exit(1);
  }

  // 检查是否已有会话
  const existingState = readRalphthonState(cwd);
  if (existingState?.active) {
    console.error(
      chalk.red(
        "A ralphthon session is already active. Use --resume or cancel it first.",
      ),
    );
    process.exit(1);
  }

  const sessionId = `ralphthon-${Date.now()}`;
  const config: Partial<RalphthonConfig> = {
    maxWaves: options.maxWaves,
    pollIntervalMs: options.pollInterval * 1000,
    skipInterview: options.skipInterview,
  };

  console.log(chalk.blue.bold("Starting Ralphthon"));
  console.log(chalk.gray(`Task: ${options.task}`));
  console.log(
    chalk.gray(
      `Max waves: ${options.maxWaves}, Poll: ${options.pollInterval}s`,
    ),
  );
  console.log(chalk.gray(`Skip interview: ${options.skipInterview}`));

  // 阶段 1：访谈（除非已跳过）
  if (!options.skipInterview) {
    console.log(chalk.cyan("\nPhase 1: Deep Interview — generating PRD..."));
    console.log(
      chalk.gray(
        "The leader pane will run deep-interview to generate the PRD.",
      ),
    );

    // 向 leader 面板注入 deep-interview 命令
    // 编排器将等待 PRD 出现
    const interviewPrompt = buildRalphthonInterviewPrompt(
      options.task,
      options,
    );

    // 在访谈阶段初始化状态
    const state = initOrchestrator(
      cwd,
      tmuxSession,
      leaderPane,
      getRalphthonPrdPath(cwd),
      sessionId,
      config,
    );
    state.phase = "interview";
    writeRalphthonState(cwd, state, sessionId);

    // 向 leader 面板发送 deep-interview prompt
    if (!sendKeysToPane(leaderPane, interviewPrompt)) {
      console.log(
        chalk.red("Failed to inject deep-interview prompt to leader pane."),
      );
      clearRalphthonState(cwd, sessionId);
      process.exit(1);
    }

    console.log(chalk.gray("Waiting for PRD generation..."));

    // 轮询等待 PRD 文件出现
    const prdPath = getRalphthonPrdPath(cwd);
    const maxWaitMs = 600_000; // 访谈最长等待 10 分钟
    const pollMs = 5_000;
    let waited = 0;

    while (waited < maxWaitMs) {
      if (existsSync(prdPath)) {
        const prd = readRalphthonPrd(cwd);
        if (prd && prd.stories.length > 0) {
          console.log(chalk.green("PRD generated successfully!"));
          console.log(formatRalphthonStatus(prd));
          break;
        }
      }
      await sleep(pollMs);
      waited += pollMs;
    }

    if (waited >= maxWaitMs) {
      console.error(chalk.red("Timed out waiting for PRD generation."));
      clearRalphthonState(cwd, sessionId);
      process.exit(1);
    }
  } else {
    // 跳过访谈 — 根据任务创建一个简单的 PRD
    console.log(chalk.cyan("\nSkipping interview — creating PRD from task..."));

    const defaultPrd = buildDefaultSkipInterviewPrdParams(options.task);
    initRalphthonPrd(
      cwd,
      defaultPrd.project,
      defaultPrd.branchName,
      defaultPrd.description,
      defaultPrd.stories,
      config,
      defaultPrd.planningContext,
    );

    initOrchestrator(
      cwd,
      tmuxSession,
      leaderPane,
      getRalphthonPrdPath(cwd),
      sessionId,
      config,
    );
  }

  // 阶段 2：执行 — 启动编排器循环
  console.log(chalk.cyan("\nPhase 2: Execution — ralph loop active"));

  const eventLogger = createEventLogger();
  const { stop } = startOrchestratorLoop(cwd, sessionId, eventLogger);

  // 处理优雅关闭
  const shutdown = () => {
    console.log(chalk.yellow("\nStopping ralphthon orchestrator..."));
    stop();
    clearRalphthonState(cwd, sessionId);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 保持进程存活
  console.log(chalk.gray("Orchestrator running. Press Ctrl+C to stop."));
}

// ============================================================================
// 辅助函数
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
