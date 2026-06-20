import chalk from 'chalk';
import { isTmuxAvailable } from './tmux-utils.js';

/**
 * 当运行在原生 Windows (win32) 且 tmux 不可用时发出警告。
 * 在 CLI 启动时由 src/cli/index.ts 调用。
 * 若 PATH 上存在 tmux 兼容二进制 (例如 psmux),则跳过警告。
 */
export function warnIfWin32(): void {
  if (process.platform === 'win32' && !isTmuxAvailable()) {
    console.warn(chalk.yellow.bold('\n⚠  WARNING: Native Windows (win32) detected — no tmux found'));
    console.warn(chalk.yellow('   WISE features that require tmux will not work.'));
    console.warn(chalk.yellow('   Install psmux for native Windows tmux support: winget install psmux'));
    console.warn(chalk.yellow('   Or use WSL2: https://learn.microsoft.com/en-us/windows/wsl/install'));
    console.warn('');
  }
}
