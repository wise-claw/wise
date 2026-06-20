/**
 * Teleport 命令 - 快速创建开发用 worktree
 *
 * 为在隔离环境中处理 issue/PR/feature 创建 git worktree。
 * 默认 worktree 位置：~/Workspace/wise-worktrees/
 */

import chalk from 'chalk';
import { execSync, execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync } from 'fs';
import { homedir } from 'os';
import { join, basename, isAbsolute, relative } from 'path';
import { loadConfig } from '../../config/loader.js';
import { parseRemoteUrl, getProvider } from '../../providers/index.js';
import type { ProviderName, GitProvider } from '../../providers/types.js';
import { validateWorktreeRemovalTarget } from '../../lib/worktree-cleanup-safety.js';

export interface TeleportOptions {
  worktree?: boolean;
  worktreePath?: string;
  base?: string;
  noCd?: boolean;
  json?: boolean;
}

export interface TeleportResult {
  success: boolean;
  worktreePath?: string;
  branch?: string;
  error?: string;
}

// 默认 worktree 根目录
const DEFAULT_WORKTREE_ROOT = join(homedir(), 'Workspace', 'wise-worktrees');
const PACKAGE_JSON_NAME = 'package.json';
const PACKAGE_MANAGER_LOCKFILES = {
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  npm: 'package-lock.json',
} as const;

type SupportedPackageManager = keyof typeof PACKAGE_MANAGER_LOCKFILES;

function readPackageJsonText(directory: string): string | null {
  try {
    return readFileSync(join(directory, PACKAGE_JSON_NAME), 'utf-8');
  } catch {
    return null;
  }
}

function detectPackageManager(parentRepoRoot: string, worktreePath: string): SupportedPackageManager {
  for (const [manager, lockfile] of Object.entries(PACKAGE_MANAGER_LOCKFILES) as [SupportedPackageManager, string][]) {
    if (existsSync(join(worktreePath, lockfile)) || existsSync(join(parentRepoRoot, lockfile))) {
      return manager;
    }
  }

  for (const directory of [worktreePath, parentRepoRoot]) {
    const packageJsonText = readPackageJsonText(directory);
    if (!packageJsonText) continue;
    try {
      const parsed = JSON.parse(packageJsonText) as { packageManager?: string };
      const packageManager = parsed.packageManager?.split('@')[0];
      if (packageManager === 'pnpm' || packageManager === 'yarn' || packageManager === 'npm') {
        return packageManager;
      }
    } catch {
      // 忽略并兜底回退到 npm。
    }
  }

  return 'npm';
}

function symlinkNodeModules(parentRepoRoot: string, worktreePath: string): boolean {
  const sourceNodeModules = join(parentRepoRoot, 'node_modules');
  const targetNodeModules = join(worktreePath, 'node_modules');

  if (!existsSync(sourceNodeModules) || existsSync(targetNodeModules)) {
    return false;
  }

  symlinkSync(sourceNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
  return true;
}

function installDependencies(worktreePath: string, packageManager: SupportedPackageManager): void {
  const argsByManager: Record<SupportedPackageManager, string[]> = {
    npm: ['install'],
    pnpm: ['install'],
    yarn: ['install'],
  };

  execFileSync(packageManager, argsByManager[packageManager], {
    cwd: worktreePath,
    stdio: 'inherit',
  });
}

function warnTeleportDependencyFallback(message: string, json: boolean | undefined): void {
  if (json) return;
  console.warn(chalk.yellow(message));
}

function bootstrapTeleportDependencies(
  parentRepoRoot: string,
  worktreePath: string,
  options: { json?: boolean; symlinkNodeModules: boolean }
): { mode: 'symlink' | 'install'; packageManager: SupportedPackageManager } {
  const packageManager = detectPackageManager(parentRepoRoot, worktreePath);

  if (!options.symlinkNodeModules) {
    installDependencies(worktreePath, packageManager);
    return { mode: 'install', packageManager };
  }

  const parentPackageJson = readPackageJsonText(parentRepoRoot);
  const worktreePackageJson = readPackageJsonText(worktreePath);

  if (!parentPackageJson || !worktreePackageJson) {
    warnTeleportDependencyFallback(
      'Warning: could not read package.json for teleport dependency reuse; running full install instead.',
      options.json,
    );
    installDependencies(worktreePath, packageManager);
    return { mode: 'install', packageManager };
  }

  if (parentPackageJson !== worktreePackageJson) {
    warnTeleportDependencyFallback(
      'Warning: worktree package.json differs from parent repo; running full install instead of symlinking node_modules.',
      options.json,
    );
    installDependencies(worktreePath, packageManager);
    return { mode: 'install', packageManager };
  }

  if (symlinkNodeModules(parentRepoRoot, worktreePath)) {
    return { mode: 'symlink', packageManager };
  }

  warnTeleportDependencyFallback(
    'Warning: parent node_modules is unavailable for teleport symlink reuse; running full install instead.',
    options.json,
  );
  installDependencies(worktreePath, packageManager);
  return { mode: 'install', packageManager };
}

/**
 * 将引用字符串解析为各组成部分
 * 支持：wise#123、owner/repo#123、#123、URL、feature 名称
 */
function parseRef(ref: string): {
  type: 'issue' | 'pr' | 'feature';
  owner?: string;
  repo?: string;
  number?: number;
  name?: string;
  provider?: ProviderName;
} {
  // GitHub PR URL：github.com/owner/repo/pull/N
  const ghPrUrlMatch = ref.match(/^https?:\/\/[^/]*github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[?#].*)?$/);
  if (ghPrUrlMatch) {
    return {
      type: 'pr',
      owner: ghPrUrlMatch[1],
      repo: ghPrUrlMatch[2],
      number: parseInt(ghPrUrlMatch[3], 10),
      provider: 'github',
    };
  }

  // GitHub Issue URL：github.com/owner/repo/issues/N
  const ghIssueUrlMatch = ref.match(/^https?:\/\/[^/]*github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[?#].*)?$/);
  if (ghIssueUrlMatch) {
    return {
      type: 'issue',
      owner: ghIssueUrlMatch[1],
      repo: ghIssueUrlMatch[2],
      number: parseInt(ghIssueUrlMatch[3], 10),
      provider: 'github',
    };
  }

  // GitLab MR URL：gitlab.*/namespace/-/merge_requests/N（支持嵌套组和自托管）
  const glMrUrlMatch = ref.match(/^https?:\/\/[^/]*gitlab[^/]*\/(.+)\/-\/merge_requests\/(\d+)(?:[?#].*)?$/);
  if (glMrUrlMatch) {
    const namespaceParts = glMrUrlMatch[1].split('/');
    const repo = namespaceParts.pop()!;
    const owner = namespaceParts.join('/');
    return {
      type: 'pr',
      owner,
      repo,
      number: parseInt(glMrUrlMatch[2], 10),
      provider: 'gitlab',
    };
  }

  // GitLab Issue URL：gitlab.*/namespace/-/issues/N（支持嵌套组和自托管）
  const glIssueUrlMatch = ref.match(/^https?:\/\/[^/]*gitlab[^/]*\/(.+)\/-\/issues\/(\d+)(?:[?#].*)?$/);
  if (glIssueUrlMatch) {
    const namespaceParts = glIssueUrlMatch[1].split('/');
    const repo = namespaceParts.pop()!;
    const owner = namespaceParts.join('/');
    return {
      type: 'issue',
      owner,
      repo,
      number: parseInt(glIssueUrlMatch[2], 10),
      provider: 'gitlab',
    };
  }

  // Bitbucket PR URL：bitbucket.org/workspace/repo/pull-requests/N
  const bbPrUrlMatch = ref.match(/^https?:\/\/[^/]*bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)(?:[?#].*)?$/);
  if (bbPrUrlMatch) {
    return {
      type: 'pr',
      owner: bbPrUrlMatch[1],
      repo: bbPrUrlMatch[2],
      number: parseInt(bbPrUrlMatch[3], 10),
      provider: 'bitbucket',
    };
  }

  // Bitbucket Issue URL：bitbucket.org/workspace/repo/issues/N
  const bbIssueUrlMatch = ref.match(/^https?:\/\/[^/]*bitbucket\.org\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[?#].*)?$/);
  if (bbIssueUrlMatch) {
    return {
      type: 'issue',
      owner: bbIssueUrlMatch[1],
      repo: bbIssueUrlMatch[2],
      number: parseInt(bbIssueUrlMatch[3], 10),
      provider: 'bitbucket',
    };
  }

  // Azure DevOps PR URL：dev.azure.com/org/project/_git/repo/pullrequest/N
  const azPrUrlMatch = ref.match(/^https?:\/\/[^/]*dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)(?:[?#].*)?$/);
  if (azPrUrlMatch) {
    return {
      type: 'pr',
      owner: `${azPrUrlMatch[1]}/${azPrUrlMatch[2]}`,
      repo: azPrUrlMatch[3],
      number: parseInt(azPrUrlMatch[4], 10),
      provider: 'azure-devops',
    };
  }

  // Azure DevOps 旧版：https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
  const azureLegacyPrMatch = ref.match(
    /^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i
  );
  if (azureLegacyPrMatch) {
    return {
      type: 'pr',
      provider: 'azure-devops',
      owner: `${azureLegacyPrMatch[1]}/${azureLegacyPrMatch[2]}`,
      repo: azureLegacyPrMatch[3],
      number: parseInt(azureLegacyPrMatch[4], 10),
    };
  }

  // owner/repo!123 格式（GitLab MR 简写，支持嵌套组）
  const gitlabShorthand = ref.match(/^(.+?)\/([^!/]+)!(\d+)$/);
  if (gitlabShorthand) {
    return {
      type: 'pr',
      owner: gitlabShorthand[1],
      repo: gitlabShorthand[2],
      number: parseInt(gitlabShorthand[3], 10),
      provider: 'gitlab',
    };
  }

  // owner/repo#123 格式（与 provider 无关，支持嵌套组）
  const fullRefMatch = ref.match(/^(.+)\/([^/#]+)#(\d+)$/);
  if (fullRefMatch) {
    return {
      type: 'issue', // 将由 provider CLI 进一步细化
      owner: fullRefMatch[1],
      repo: fullRefMatch[2],
      number: parseInt(fullRefMatch[3], 10),
    };
  }

  // alias#123 格式（如 wise#123）
  const aliasMatch = ref.match(/^([a-zA-Z][a-zA-Z0-9_-]*)#(\d+)$/);
  if (aliasMatch) {
    return {
      type: 'issue',
      name: aliasMatch[1], // 待解析的别名
      number: parseInt(aliasMatch[2], 10),
    };
  }

  // #123 格式（当前仓库）
  const numberMatch = ref.match(/^#?(\d+)$/);
  if (numberMatch) {
    return {
      type: 'issue',
      number: parseInt(numberMatch[1], 10),
    };
  }

  // Feature 名称（其他情况）
  return {
    type: 'feature',
    name: ref,
  };
}

/**
 * 对字符串进行清洗，以便用于分支/目录名
 */
function sanitize(str: string, maxLen: number = 30): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

/**
 * 获取当前 git 仓库信息
 */
function getCurrentRepo(): { owner: string; repo: string; root: string; provider: ProviderName } | null {
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', timeout: 5000 }).trim();
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8', timeout: 5000 }).trim();
    const parsed = parseRemoteUrl(remoteUrl);
    if (parsed) {
      return { owner: parsed.owner, repo: parsed.repo, root, provider: parsed.provider };
    }
  } catch {
    // 不在 git 仓库中，或没有 origin
  }
  return null;
}

/**
 * 通过 provider 抽象获取 issue/PR 信息
 */
async function fetchProviderInfo(
  type: 'issue' | 'pr',
  number: number,
  provider: GitProvider,
  owner?: string,
  repo?: string
): Promise<{ title: string; branch?: string } | null> {
  if (type === 'pr') {
    const pr = await provider.viewPR(number, owner, repo);
    return pr ? { title: pr.title, branch: pr.headBranch } : null;
  }
  const issue = await provider.viewIssue(number, owner, repo);
  return issue ? { title: issue.title } : null;
}

/**
 * 创建 git worktree
 */
function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
  baseBranch: string
): { success: boolean; error?: string } {
  try {
    // 确保 worktree 父目录存在
    const parentDir = join(worktreePath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // 检查 worktree 是否已存在
    if (existsSync(worktreePath)) {
      return { success: false, error: `Worktree already exists at ${worktreePath}` };
    }

    // 从 origin 拉取最新内容
    execFileSync('git', ['fetch', 'origin', baseBranch], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    // 若分支不存在，则基于 base 分支创建
    try {
      execFileSync('git', ['branch', branchName, `origin/${baseBranch}`], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch {
      // 分支可能已存在，没关系
    }

    // 创建 worktree
    execFileSync('git', ['worktree', 'add', worktreePath, branchName], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * teleport 主命令
 */
export async function teleportCommand(
  ref: string,
  options: TeleportOptions
): Promise<TeleportResult> {
  const parsed = parseRef(ref);
  const baseBranch = options.base || 'main';
  const worktreeRoot = options.worktreePath || DEFAULT_WORKTREE_ROOT;

  // 获取当前仓库信息
  const currentRepo = getCurrentRepo();
  if (!currentRepo) {
    const error = 'Not in a git repository. Run this command from within a git repo.';
    if (!options.json) {
      console.error(chalk.red(error));
    }
    return { success: false, error };
  }

  const { owner, repo, root: repoRoot } = currentRepo;
  const repoName = basename(repoRoot);
  const config = loadConfig();
  const shouldSymlinkNodeModules = config.teleport?.symlinkNodeModules ?? true;
  // 若解析出的 ref 带 provider 则使用之，否则兜底回退到当前仓库的 provider
  const effectiveProviderName = parsed.provider || currentRepo.provider;
  const provider = getProvider(effectiveProviderName);

  let branchName: string;
  let worktreeDirName: string;
  let title: string | undefined;

  if (parsed.type === 'feature') {
    // Feature 分支
    const safeName = sanitize(parsed.name || 'feature');
    branchName = `feat/${safeName}`;
    worktreeDirName = `feat/${repoName}-${safeName}`;
    title = parsed.name;

    if (!options.json) {
      console.log(chalk.blue(`Creating feature worktree: ${parsed.name}`));
    }
  } else {
    // Issue 或 PR
    const resolvedOwner = parsed.owner || owner;
    const resolvedRepo = parsed.repo || repo;

    if (!parsed.number) {
      const error = 'Could not parse issue/PR number from reference';
      if (!options.json) {
        console.error(chalk.red(error));
      }
      return { success: false, error };
    }

    if (!provider) {
      const error = `Could not fetch info for #${parsed.number}. Could not detect git provider.`;
      if (!options.json) {
        console.error(chalk.red(error));
      }
      return { success: false, error };
    }

    // 尝试检测其是 PR 还是 issue
    const prInfo = await fetchProviderInfo('pr', parsed.number, provider, resolvedOwner, resolvedRepo);
    const issueInfo = !prInfo
      ? await fetchProviderInfo('issue', parsed.number, provider, resolvedOwner, resolvedRepo)
      : null;

    const info = prInfo || issueInfo;
    const isPR = !!prInfo;

    if (!info) {
      const cli = provider.getRequiredCLI();
      const error = `Could not fetch info for #${parsed.number} from ${provider.displayName}. ${cli ? `Make sure ${cli} CLI is installed and authenticated.` : 'Check your authentication credentials and network connection.'}`;
      if (!options.json) {
        console.error(chalk.red(error));
      }
      return { success: false, error };
    }

    title = info.title;
    const slug = sanitize(title, 20);

    if (isPR) {
      // 对于 PR，使用 PR 自身的分支
      branchName = info.branch || `pr-${parsed.number}-review`;
      worktreeDirName = `pr/${repoName}-${parsed.number}`;

      if (!options.json) {
        console.log(chalk.blue(`Creating PR review worktree: #${parsed.number} - ${title}`));
      }

      // 使用 provider 特定的 refspec 或 head 分支拉取 PR 分支
      if (provider.prRefspec) {
        try {
          const refspec = provider.prRefspec
            .replace('{number}', String(parsed.number))
            .replace('{branch}', branchName);
          execFileSync(
            'git', ['fetch', 'origin', refspec],
            { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
          );
        } catch {
          // 分支可能已存在
        }
      } else if (info.branch) {
        // 对于没有 prRefspec 的 provider（Bitbucket、Azure、Gitea），
        // 从 origin 拉取 PR 的 head 分支
        try {
          execFileSync(
            'git', ['fetch', 'origin', `${info.branch}:${branchName}`],
            { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
          );
        } catch {
          // 分支可能在本地已存在
        }
      }
    } else {
      // 对于 issue，创建修复分支
      branchName = `fix/${parsed.number}-${slug}`;
      worktreeDirName = `issue/${repoName}-${parsed.number}`;

      if (!options.json) {
        console.log(chalk.blue(`Creating issue fix worktree: #${parsed.number} - ${title}`));
      }
    }
  }

  // 确定 worktree 的完整路径
  const worktreePath = join(worktreeRoot, worktreeDirName);

  if (!options.json) {
    console.log(chalk.gray(`  Branch: ${branchName}`));
    console.log(chalk.gray(`  Path: ${worktreePath}`));
  }

  // 创建 worktree
  const result = createWorktree(repoRoot, worktreePath, branchName, baseBranch);

  if (!result.success) {
    if (!options.json) {
      console.error(chalk.red(`Failed to create worktree: ${result.error}`));
    }
    return { success: false, error: result.error };
  }

  try {
    bootstrapTeleportDependencies(repoRoot, worktreePath, {
      json: options.json,
      symlinkNodeModules: shouldSymlinkNodeModules,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!options.json) {
      console.error(chalk.red(`Failed to bootstrap worktree dependencies: ${message}`));
    }
    return { success: false, error: message };
  }

  if (!options.json) {
    console.log('');
    console.log(chalk.green('Worktree created successfully!'));
    console.log('');
    console.log(chalk.bold('To start working:'));
    console.log(chalk.cyan(`  cd ${worktreePath}`));
    console.log('');
    if (title) {
      console.log(chalk.gray(`Title: ${title}`));
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      worktreePath,
      branch: branchName,
      title,
    }, null, 2));
  }

  return {
    success: true,
    worktreePath,
    branch: branchName,
  };
}

/**
 * 通过扫描 .git 文件（而非目录）来查找 worktree 目录
 */
function findWorktreeDirs(dir: string, maxDepth: number = 3, currentDepth: number = 0): string[] {
  if (currentDepth >= maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(dir, entry.name);
      try {
        const gitPath = join(fullPath, '.git');
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          results.push(fullPath);
          continue; // 不递归进入 worktree 内部
        }
      } catch {
        // 没有 .git 文件，继续向更深层递归
      }
      results.push(...findWorktreeDirs(fullPath, maxDepth, currentDepth + 1));
    }
  } catch {
    // 目录不可读
  }
  return results;
}

/**
 * 列出默认位置下已存在的 worktree
 */
export async function teleportListCommand(options: { json?: boolean }): Promise<void> {
  const worktreeRoot = DEFAULT_WORKTREE_ROOT;

  if (!existsSync(worktreeRoot)) {
    if (options.json) {
      console.log(JSON.stringify({ worktrees: [] }));
    } else {
      console.log(chalk.gray('No worktrees found.'));
    }
    return;
  }

  const worktreeDirs = findWorktreeDirs(worktreeRoot);

  const worktrees = worktreeDirs.map(worktreePath => {
    const relativePath = relative(worktreeRoot, worktreePath);

    let branch = 'unknown';
    try {
      branch = execSync('git branch --show-current', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();
    } catch {
      // 忽略
    }

    return { path: worktreePath, relativePath, branch };
  });

  if (options.json) {
    console.log(JSON.stringify({ worktrees }, null, 2));
  } else {
    if (worktrees.length === 0) {
      console.log(chalk.gray('No worktrees found.'));
      return;
    }

    console.log(chalk.bold('\nWISE Worktrees:\n'));
    console.log(chalk.gray('─'.repeat(60)));

    for (const wt of worktrees) {
      console.log(`  ${chalk.cyan(wt.relativePath)}`);
      console.log(`    Branch: ${chalk.yellow(wt.branch)}`);
      console.log(`    Path: ${chalk.gray(wt.path)}`);
      console.log('');
    }
  }
}

/**
 * 移除一个 worktree
 * 成功返回 0，失败返回 1。
 */
export async function teleportRemoveCommand(
  pathOrName: string,
  options: { force?: boolean; json?: boolean }
): Promise<number> {
  const worktreeRoot = DEFAULT_WORKTREE_ROOT;

  // 解析路径 - 可能是相对名称或完整路径
  let worktreePath = pathOrName;
  if (!isAbsolute(pathOrName)) {
    worktreePath = join(worktreeRoot, pathOrName);
  }

  try {
    validateWorktreeRemovalTarget({
      candidatePath: worktreePath,
      expectedRoots: [worktreeRoot],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const error = detail.startsWith('worktree_path_missing:')
      ? `Worktree not found: ${worktreePath}`
      : `Refusing to remove unsafe worktree path: ${detail}`;
    if (options.json) {
      console.log(JSON.stringify({ success: false, error }));
    } else {
      console.error(chalk.red(error));
    }
    return 1;
  }

  try {
    // 检查是否有未提交的改动
    if (!options.force) {
      const status = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
      });

      if (status.trim()) {
        const error = 'Worktree has uncommitted changes. Use --force to remove anyway.';
        if (options.json) {
          console.log(JSON.stringify({ success: false, error }));
        } else {
          console.error(chalk.red(error));
        }
        return 1;
      }
    }

    // 找到主仓库以执行 git worktree remove
    const gitDir = execSync('git rev-parse --git-dir', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim();

    // 可移除的 worktree 其 git-dir 应位于主仓库的 .git/worktrees 目录内。
    // 主仓库会报告 .git 或 <repo>/.git；任何其他形态都属于异常，必须以失败收尾，
    // 而不是直接删除目标目录。
    const mainRepoMatch = gitDir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/);
    const mainRepo = mainRepoMatch ? mainRepoMatch[1] : null;

    if (!mainRepo) {
      throw new Error(
        `Refusing to remove ${worktreePath}: git directory ${JSON.stringify(gitDir)} is not a registered worktree git-dir`,
      );
    }

    validateWorktreeRemovalTarget({
      candidatePath: worktreePath,
      expectedRoots: [worktreeRoot],
      mainRepoRoots: [mainRepo],
    });

    const args = options.force
      ? ['worktree', 'remove', '--force', worktreePath]
      : ['worktree', 'remove', worktreePath];
    execFileSync('git', args, {
      cwd: mainRepo,
      stdio: 'pipe',
    });

    if (options.json) {
      console.log(JSON.stringify({ success: true, removed: worktreePath }));
    } else {
      console.log(chalk.green(`Removed worktree: ${worktreePath}`));
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: message }));
    } else {
      console.error(chalk.red(`Failed to remove worktree: ${message}`));
    }
    return 1;
  }
}
