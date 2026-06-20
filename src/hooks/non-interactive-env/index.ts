import type { ShellHook } from "./types.js"
import { HOOK_NAME, NON_INTERACTIVE_ENV, SHELL_COMMAND_PATTERNS } from "./constants.js"

export * from "./constants.js"
export * from "./detector.js"
export * from "./types.js"

const BANNED_ENTRIES: { pattern: RegExp; name: string }[] =
  SHELL_COMMAND_PATTERNS.banned
    .filter((cmd: string) => !cmd.includes("("))
    .map((cmd: string) => ({ pattern: new RegExp(`\\b${cmd}\\b`), name: cmd }))

function detectBannedCommand(command: string): string | undefined {
  for (const entry of BANNED_ENTRIES) {
    if (entry.pattern.test(command)) {
      return entry.name
    }
  }
  return undefined
}

/**
 * 对用于 VAR=value 前缀的值进行 Shell 转义。
 * 若含特殊字符则用单引号包裹。
 */
function shellEscape(value: string): string {
  // 空字符串需要加引号
  if (value === "") return "''"
  // 若含特殊字符，用单引号包裹（转义已有的单引号）
  if (/[^a-zA-Z0-9_\-.:\/]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`
  }
  return value
}

/**
 * 为环境变量构建 export 语句。
 * 使用 `export VAR1=val1 VAR2=val2;` 格式，以确保变量
 * 作用于链中的所有命令（如 `cmd1 && cmd2`）。
 *
 * 之前的做法使用 VAR=value 前缀，仅作用于第一条命令。
 */
function buildEnvPrefix(env: Record<string, string>): string {
  const exports = Object.entries(env)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(" ")
  return `export ${exports};`
}

/**
 * Claude Code 的非交互环境钩子。
 *
 * 通过以下方式检测并处理非交互环境（CI、cron 等）：
 * - 对禁用的交互式命令（vim、less 等）发出警告
 * - 注入环境变量以防止 git/工具发起提示
 * - 在 git 命令前拼接 export 语句以阻断编辑器/分页器
 */
export const nonInteractiveEnvHook: ShellHook = {
  name: HOOK_NAME,

  async beforeCommand(command: string): Promise<{ command: string; warning?: string }> {
    // 检查禁用的交互式命令
    const bannedCmd = detectBannedCommand(command)
    const warning = bannedCmd
      ? `Warning: '${bannedCmd}' is an interactive command that may hang in non-interactive environments.`
      : undefined

    // 仅对 git 命令拼接环境变量（阻断编辑器、分页器等）
    const isGitCommand = /\bgit\b/.test(command)
    if (!isGitCommand) {
      return { command, warning }
    }

    // 在命令前拼接 export 语句以确保非交互行为
    // 使用 `export VAR=val;` 格式以确保变量作用于所有命令
    // 链中（如 `git add file && git rebase --continue`）。
    const envPrefix = buildEnvPrefix(NON_INTERACTIVE_ENV)
    const modifiedCommand = `${envPrefix} ${command}`

    return { command: modifiedCommand, warning }
  },
}
