/**
 * Git Provider 检测与注册表
 *
 * 从远程 URL 自动识别 git 托管 provider，并提供对
 * 各 provider 专属适配器的访问。
 */

import { execSync } from 'node:child_process';
import type { ProviderName, RemoteUrlInfo, GitProvider } from './types.js';
import { GitHubProvider } from './github.js';
import { GitLabProvider } from './gitlab.js';
import { BitbucketProvider } from './bitbucket.js';
import { AzureDevOpsProvider } from './azure-devops.js';
import { GiteaProvider } from './gitea.js';

// 单例 provider 注册表
let providerRegistry: Map<ProviderName, GitProvider> | null = null;

// 以解析后的 cwd 为键的 git 远程 URL 查询 TTL 缓存
const REMOTE_URL_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  url: string | null;
  expiresAt: number;
}

const remoteUrlCache = new Map<string, CacheEntry>();

/**
 * 重置远程 URL 缓存。专供测试使用。
 */
export function resetProviderCache(): void {
  remoteUrlCache.clear();
}

function getCachedRemoteUrl(cwd: string): string | null | undefined {
  const entry = remoteUrlCache.get(cwd);
  if (!entry) return undefined; // 缓存未命中
  if (Date.now() > entry.expiresAt) {
    remoteUrlCache.delete(cwd);
    return undefined; // 已过期
  }
  return entry.url; // 可能为 null（缓存了“非 git 仓库”的结果）
}

function setCachedRemoteUrl(cwd: string, url: string | null): void {
  remoteUrlCache.set(cwd, { url, expiresAt: Date.now() + REMOTE_URL_CACHE_TTL_MS });
}

function getRemoteUrl(cwd?: string): string | null {
  const resolvedCwd = cwd ?? process.cwd();
  const cached = getCachedRemoteUrl(resolvedCwd);
  if (cached !== undefined) return cached;

  try {
    const url = execSync('git remote get-url origin', {
      cwd: resolvedCwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const result = url || null;
    setCachedRemoteUrl(resolvedCwd, result);
    return result;
  } catch {
    setCachedRemoteUrl(resolvedCwd, null);
    return null;
  }
}

/**
 * 通过匹配已知主机名从 git 远程 URL 识别 provider。
 */
export function detectProvider(remoteUrl: string): ProviderName {
  const url = remoteUrl.toLowerCase();

  // 提取主机名部分以便精确匹配（若有端口则剥离）
  const hostMatch = url.match(/^(?:https?:\/\/|ssh:\/\/[^@]*@|[^@]+@)([^/:]+)/);
  const rawHost = hostMatch ? hostMatch[1].toLowerCase() : '';
  const host = rawHost.replace(/:\d+$/, ''); // 剥离端口用于匹配

  // Azure DevOps（需在通用模式之前检查）
  if (host.includes('dev.azure.com') || host.includes('ssh.dev.azure.com') || host.endsWith('.visualstudio.com')) {
    return 'azure-devops';
  }

  // GitHub
  if (host === 'github.com') {
    return 'github';
  }

  // GitLab（SaaS）
  if (host === 'gitlab.com') {
    return 'gitlab';
  }

  // Bitbucket
  if (host === 'bitbucket.org') {
    return 'bitbucket';
  }

  // 自托管启发式——仅匹配主机名标签
  if (/(^|[.-])gitlab([.-]|$)/.test(host)) {
    return 'gitlab';
  }
  if (/(^|[.-])gitea([.-]|$)/.test(host)) {
    return 'gitea';
  }
  if (/(^|[.-])forgejo([.-]|$)/.test(host)) {
    return 'forgejo';
  }

  return 'unknown';
}

/**
 * 将 git 远程 URL 解析为结构化组件。
 * 支持 HTTPS、SSH（SCP 风格）以及 provider 专属格式。
 */
export function parseRemoteUrl(url: string): RemoteUrlInfo | null {
  const trimmed = url.trim();

  // Azure DevOps HTTPS：https://dev.azure.com/{org}/{project}/_git/{repo}
  const azureHttpsMatch = trimmed.match(
    /https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?$/
  );
  if (azureHttpsMatch) {
    return {
      provider: 'azure-devops',
      host: 'dev.azure.com',
      owner: `${azureHttpsMatch[1]}/${azureHttpsMatch[2]}`,
      repo: azureHttpsMatch[3],
    };
  }

  // Azure DevOps SSH：git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const azureSshMatch = trimmed.match(
    /git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?$/
  );
  if (azureSshMatch) {
    return {
      provider: 'azure-devops',
      host: 'dev.azure.com',
      owner: `${azureSshMatch[1]}/${azureSshMatch[2]}`,
      repo: azureSshMatch[3],
    };
  }

  // Azure DevOps 旧版 HTTPS：https://{org}.visualstudio.com/{project}/_git/{repo}
  const azureLegacyMatch = trimmed.match(
    /https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?$/
  );
  if (azureLegacyMatch) {
    return {
      provider: 'azure-devops',
      host: `${azureLegacyMatch[1]}.visualstudio.com`,
      owner: `${azureLegacyMatch[1]}/${azureLegacyMatch[2]}`,
      repo: azureLegacyMatch[3],
    };
  }

  // 标准 HTTPS：https://host/owner/repo.git（支持嵌套组，如 group/subgroup/repo）
  const httpsMatch = trimmed.match(
    /https?:\/\/([^/]+)\/(.+?)\/([^/\s]+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    const host = httpsMatch[1];
    return {
      provider: detectProvider(trimmed),
      host,
      owner: httpsMatch[2],
      repo: httpsMatch[3],
    };
  }

  // SSH URL 风格：ssh://git@host[:port]/owner/repo.git（必须在 SCP 风格之前检查）
  const sshUrlMatch = trimmed.match(
    /ssh:\/\/git@([^/:]+)(?::\d+)?\/(.+?)\/([^/\s]+?)(?:\.git)?$/
  );
  if (sshUrlMatch) {
    const host = sshUrlMatch[1];
    return {
      provider: detectProvider(trimmed),
      host,
      owner: sshUrlMatch[2],
      repo: sshUrlMatch[3],
    };
  }

  // SSH SCP 风格：git@host:owner/repo.git（支持嵌套组，如 group/subgroup/repo）
  const sshMatch = trimmed.match(
    /git@([^:]+):(.+?)\/([^/\s]+?)(?:\.git)?$/
  );
  if (sshMatch) {
    const host = sshMatch[1];
    return {
      provider: detectProvider(trimmed),
      host,
      owner: sshMatch[2],
      repo: sshMatch[3],
    };
  }

  return null;
}

/**
 * 通过读取 origin 远程 URL 识别当前工作目录的 git provider。
 */
export function detectProviderFromCwd(cwd?: string): ProviderName {
  const url = getRemoteUrl(cwd);
  if (!url) return 'unknown';
  return detectProvider(url);
}

/**
 * 解析当前工作目录的远程 URL。
 */
export function parseRemoteFromCwd(cwd?: string): RemoteUrlInfo | null {
  const url = getRemoteUrl(cwd);
  if (!url) return null;
  return parseRemoteUrl(url);
}

/**
 * 用所有可用 provider 初始化 provider 注册表。
 */
function initRegistry(): Map<ProviderName, GitProvider> {
  if (providerRegistry) return providerRegistry;

  providerRegistry = new Map<ProviderName, GitProvider>([
    ['github', new GitHubProvider()],
    ['gitlab', new GitLabProvider()],
    ['bitbucket', new BitbucketProvider()],
    ['azure-devops', new AzureDevOpsProvider()],
    ['gitea', new GiteaProvider()],
    ['forgejo', new GiteaProvider({ name: 'forgejo', displayName: 'Forgejo' })],
  ]);

  return providerRegistry;
}

/**
 * 按名称获取 provider 实例。
 * 若该 provider 未注册则返回 null。
 */
export function getProvider(name: ProviderName): GitProvider | null {
  const registry = initRegistry();
  return registry.get(name) ?? null;
}

/**
 * 获取当前工作目录对应的 provider。
 * 从 git 远程 URL 识别 provider 并返回其适配器。
 */
export function getProviderFromCwd(cwd?: string): GitProvider | null {
  const name = detectProviderFromCwd(cwd);
  if (name === 'unknown') return null;
  return getProvider(name);
}

// 为方便使用而重新导出类型
export type { ProviderName, RemoteUrlInfo, GitProvider, PRInfo, IssueInfo } from './types.js';
