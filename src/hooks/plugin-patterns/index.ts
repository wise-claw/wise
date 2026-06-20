/**
 * 常用插件模式
 *
 * 来自 Claude Code 社区的常见钩子模式：
 * - 文件保存时自动格式化
 * - 提交前 lint 校验
 * - 提交信息校验
 * - 提交前运行测试
 * - 类型检查强制
 */

import { existsSync, readFileSync } from 'fs';
import { join, extname, normalize } from 'path';
import { execFileSync, spawnSync } from 'child_process';

// =============================================================================
// 安全工具
// =============================================================================

/**
 * 出于安全考虑校验文件路径
 * 拦截 shell 元字符与路径穿越尝试
 */
export function isValidFilePath(filePath: string): boolean {
  // 检查前先将 Windows 路径分隔符规范化为正斜杠。
  // 反斜杠在 Windows 上是合法的路径分隔符（如 src\file.ts、
  // C:\repo\file.ts），不能当作 shell 元字符处理。
  const normalized = filePath.replace(/\\/g, '/');

  // 拦截 shell 元字符
  if (/[;&|`$()<>{}[\]*?~!#\n\r\t\0]/.test(normalized)) return false;

  // 拦截路径穿越
  if (normalize(normalized).includes('..')) return false;

  return true;
}

// =============================================================================
// 自动格式化模式
// =============================================================================

export interface FormatConfig {
  /** 待格式化的文件扩展名 */
  extensions: string[];
  /** 格式化命令（如 'prettier --write'、'black'） */
  command: string;
  /** 是否在文件保存时运行 */
  enabled: boolean;
}

const DEFAULT_FORMATTERS: Record<string, string> = {
  '.ts': 'prettier --write',
  '.tsx': 'prettier --write',
  '.js': 'prettier --write',
  '.jsx': 'prettier --write',
  '.json': 'prettier --write',
  '.css': 'prettier --write',
  '.scss': 'prettier --write',
  '.md': 'prettier --write',
  '.py': 'black',
  '.go': 'gofmt -w',
  '.rs': 'rustfmt'
};

/**
 * 获取某文件扩展名对应的格式化命令
 */
export function getFormatter(ext: string): string | null {
  return DEFAULT_FORMATTERS[ext] || null;
}

/**
 * 检查格式化器是否可用
 */
export function isFormatterAvailable(command: string): boolean {
  const binary = command.split(' ')[0];
  const checkCommand = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checkCommand, [binary], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * 使用合适的格式化器格式化文件
 */
export function formatFile(filePath: string): { success: boolean; message: string } {
  // 出于安全考虑校验文件路径
  if (!isValidFilePath(filePath)) {
    return { success: false, message: 'Invalid file path: contains unsafe characters or path traversal' };
  }

  const ext = extname(filePath);
  const formatter = getFormatter(ext);

  if (!formatter) {
    return { success: true, message: `No formatter configured for ${ext}` };
  }

  if (!isFormatterAvailable(formatter)) {
    return { success: true, message: `Formatter ${formatter} not available` };
  }

  try {
    const [formatterBin, ...formatterArgs] = formatter.split(' ');
    execFileSync(formatterBin, [...formatterArgs, filePath], { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, message: `Formatted ${filePath}` };
  } catch (_error) {
    return { success: false, message: `Format failed: ${_error}` };
  }
}

// =============================================================================
// LINT 校验模式
// =============================================================================

export interface LintConfig {
  /** 待运行的 lint 命令 */
  command: string;
  /** 待 lint 的文件模式 */
  patterns: string[];
  /** 是否在 lint 出错时阻断 */
  blocking: boolean;
}

const DEFAULT_LINTERS: Record<string, string> = {
  '.ts': 'eslint --fix',
  '.tsx': 'eslint --fix',
  '.js': 'eslint --fix',
  '.jsx': 'eslint --fix',
  '.py': 'ruff check --fix',
  '.go': 'golangci-lint run',
  '.rs': 'cargo clippy'
};

/**
 * 获取某文件扩展名对应的 linter 命令
 */
export function getLinter(ext: string): string | null {
  return DEFAULT_LINTERS[ext] || null;
}

/**
 * 对单个文件运行 linter
 */
export function lintFile(filePath: string): { success: boolean; message: string } {
  // 出于安全考虑校验文件路径
  if (!isValidFilePath(filePath)) {
    return { success: false, message: 'Invalid file path: contains unsafe characters or path traversal' };
  }

  const ext = extname(filePath);
  const linter = getLinter(ext);

  if (!linter) {
    return { success: true, message: `No linter configured for ${ext}` };
  }

  const linterBin = linter.split(' ')[0];
  const checkCommand = process.platform === 'win32' ? 'where' : 'which';
  const checkResult = spawnSync(checkCommand, [linterBin], { stdio: 'ignore' });
  if (checkResult.status !== 0) {
    return { success: true, message: `Linter ${linter} not available` };
  }

  try {
    const [linterCmd, ...linterArgs] = linter.split(' ');
    execFileSync(linterCmd, [...linterArgs, filePath], { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, message: `Lint passed for ${filePath}` };
  } catch (_error) {
    return { success: false, message: `Lint errors in ${filePath}` };
  }
}

// =============================================================================
// 提交信息校验模式
// =============================================================================

export interface CommitConfig {
  /** 允许的约定式提交类型 */
  types: string[];
  /** 主题行最大长度 */
  maxSubjectLength: number;
  /** 是否要求 scope */
  requireScope: boolean;
  /** 是否要求正文 */
  requireBody: boolean;
}

const DEFAULT_COMMIT_TYPES = [
  'feat',     // 新功能
  'fix',      // Bug 修复
  'docs',     // 文档
  'style',    // 格式化，无代码变更
  'refactor', // 重构
  'perf',     // 性能改进
  'test',     // 新增测试
  'build',    // 构建系统变更
  'ci',       // CI 配置
  'chore',    // 日常维护
  'revert'    // 回退之前的提交
];

const CONVENTIONAL_COMMIT_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?(!)?:\s.+$/;

/**
 * 按约定式提交格式校验提交信息
 */
export function validateCommitMessage(
  message: string,
  config?: Partial<CommitConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = message.trim().split('\n');
  const subject = lines[0];

  // 检查主题行
  if (!subject) {
    errors.push('Commit message cannot be empty');
    return { valid: false, errors };
  }

  // 确定生效类型：config.types 非空时优先使用
  const effectiveTypes = config?.types?.length ? config.types : DEFAULT_COMMIT_TYPES;
  const commitRegex = effectiveTypes === DEFAULT_COMMIT_TYPES
    ? CONVENTIONAL_COMMIT_REGEX
    : new RegExp(`^(${effectiveTypes.join('|')})(\\([a-z0-9-]+\\))?(!)?:\\s.+$`);

  // 检查约定式提交格式
  if (!commitRegex.test(subject)) {
    errors.push(
      'Subject must follow conventional commit format: type(scope?): description'
    );
    errors.push(`Allowed types: ${effectiveTypes.join(', ')}`);
  }

  // 检查主题长度
  const maxLength = config?.maxSubjectLength || 72;
  if (subject.length > maxLength) {
    errors.push(`Subject line exceeds ${maxLength} characters`);
  }

  // 如有要求则检查 scope
  if (config?.requireScope) {
    const hasScope = /\([a-z0-9-]+\)/.test(subject);
    if (!hasScope) {
      errors.push('Scope is required in commit message');
    }
  }

  // 如有要求则检查正文
  if (config?.requireBody) {
    if (lines.length < 3 || !lines[2]) {
      errors.push('Commit body is required');
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// 类型检查模式
// =============================================================================

/**
 * 运行 TypeScript 类型检查
 */
export function runTypeCheck(directory: string): { success: boolean; message: string } {
  const tsconfigPath = join(directory, 'tsconfig.json');

  if (!existsSync(tsconfigPath)) {
    return { success: true, message: 'No tsconfig.json found' };
  }

  const checkCommand = process.platform === 'win32' ? 'where' : 'which';
  const tscCheck = spawnSync(checkCommand, ['tsc'], { stdio: 'ignore' });
  if (tscCheck.status !== 0) {
    return { success: true, message: 'TypeScript not installed' };
  }

  // Windows 下 shell:true 可避免在派生 npx.cmd 时触发 Node 20.12+ EINVAL（CVE-2024-27980）。#2721
  const tscResult = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd: directory,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  if (tscResult.status === 0) {
    return { success: true, message: 'Type check passed' };
  }
  return { success: false, message: 'Type errors found' };
}

// =============================================================================
// 测试运行器模式
// =============================================================================

/**
 * 检测并运行项目的测试
 */
export function runTests(directory: string): { success: boolean; message: string } {
  const packageJsonPath = join(directory, 'package.json');

  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.scripts?.test) {
        execFileSync('npm', ['test'], {
          cwd: directory,
          encoding: 'utf-8',
          stdio: 'pipe',
          // Windows 下 shell:true 可避免在派生 npm.cmd 时触发 Node 20.12+ EINVAL（CVE-2024-27980）。#2721
          shell: process.platform === 'win32',
        });
        return { success: true, message: 'Tests passed' };
      }
    } catch (_error) {
      return { success: false, message: 'Tests failed' };
    }
  }

  // 检查 pytest
  if (existsSync(join(directory, 'pytest.ini')) || existsSync(join(directory, 'pyproject.toml'))) {
    try {
      execFileSync('pytest', [], { cwd: directory, encoding: 'utf-8', stdio: 'pipe' });
      return { success: true, message: 'Tests passed' };
    } catch (_error) {
      return { success: false, message: 'Tests failed' };
    }
  }

  return { success: true, message: 'No test runner found' };
}

// =============================================================================
// 项目级 LINT 运行器模式
// =============================================================================

/**
 * 运行项目级 lint 检查
 */
export function runLint(directory: string): { success: boolean; message: string } {
  const packageJsonPath = join(directory, 'package.json');

  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.scripts?.lint) {
        try {
          execFileSync('npm', ['run', 'lint'], {
            cwd: directory,
            encoding: 'utf-8',
            stdio: 'pipe',
            // Windows 下 shell:true 可避免在派生 npm.cmd 时触发 Node 20.12+ EINVAL（CVE-2024-27980）。#2721
            shell: process.platform === 'win32',
          });
          return { success: true, message: 'Lint passed' };
        } catch (_error) {
          return { success: false, message: 'Lint errors found' };
        }
      }
    } catch {
      // 无法读取 package.json
    }
  }

  return { success: true, message: 'No lint script found' };
}

// =============================================================================
// 提交前校验钩子
// =============================================================================

export interface PreCommitResult {
  canCommit: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}

/**
 * 运行所有提交前检查
 */
export function runPreCommitChecks(
  directory: string,
  commitMessage?: string
): PreCommitResult {
  const checks: PreCommitResult['checks'] = [];

  // 类型检查
  const typeCheck = runTypeCheck(directory);
  checks.push({
    name: 'Type Check',
    passed: typeCheck.success,
    message: typeCheck.message
  });

  // 测试运行器
  const testCheck = runTests(directory);
  checks.push({
    name: 'Tests',
    passed: testCheck.success,
    message: testCheck.message
  });

  // Lint
  const lintCheck = runLint(directory);
  checks.push({
    name: 'Lint',
    passed: lintCheck.success,
    message: lintCheck.message
  });

  // 提交信息校验
  if (commitMessage) {
    const commitCheck = validateCommitMessage(commitMessage);
    checks.push({
      name: 'Commit Message',
      passed: commitCheck.valid,
      message: commitCheck.valid ? 'Valid format' : commitCheck.errors.join('; ')
    });
  }

  // 所有检查必须通过
  const canCommit = checks.every(c => c.passed);

  return { canCommit, checks };
}

// =============================================================================
// 钩子消息生成器
// =============================================================================

/**
 * 生成提交前检查提醒消息
 */
export function getPreCommitReminderMessage(result: PreCommitResult): string {
  if (result.canCommit) {
    return '';
  }

  const failedChecks = result.checks.filter(c => !c.passed);

  return `<pre-commit-validation>

[PRE-COMMIT CHECKS FAILED]

The following checks did not pass:
${failedChecks.map(c => `- ${c.name}: ${c.message}`).join('\n')}

Please fix these issues before committing.

</pre-commit-validation>

---

`;
}

/**
 * 生成自动格式化提醒消息
 */
export function getAutoFormatMessage(filePath: string, result: { success: boolean; message: string }): string {
  if (result.success) {
    return '';
  }

  return `<auto-format>

[FORMAT WARNING]

File ${filePath} could not be auto-formatted:
${result.message}

Please check the file manually.

</auto-format>

---

`;
}
