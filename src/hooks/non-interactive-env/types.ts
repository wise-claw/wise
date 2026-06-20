export interface NonInteractiveEnvConfig {
  disabled?: boolean
}

/**
 * 用于命令拦截的 Shell 钩子接口
 */
export interface ShellHook {
  name: string
  beforeCommand?(command: string): Promise<{ command: string; warning?: string }>
}
