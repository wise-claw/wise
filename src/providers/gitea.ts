import { execFileSync } from 'node:child_process';
import type { GitProvider, PRInfo, IssueInfo, ProviderName } from './types.js';
import { validateUrlForSSRF } from '../utils/ssrf-guard.js';

function validateGiteaUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!validateUrlForSSRF(raw).allowed) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export class GiteaProvider implements GitProvider {
  readonly name: ProviderName;
  readonly displayName: string;
  readonly prTerminology = 'PR' as const;
  readonly prRefspec = null;

  constructor(options?: { name?: 'gitea' | 'forgejo'; displayName?: string }) {
    this.name = options?.name ?? 'gitea';
    this.displayName = options?.displayName ?? 'Gitea';
  }

  detectFromRemote(_url: string): boolean {
    // 自托管：无法仅凭 URL 模式可靠识别
    return false;
  }

  async detectFromApi(baseUrl: string): Promise<boolean> {
    try {
      // 先检查 Forgejo（Forgejo 是 Gitea 的分支，拥有独立的版本接口）
      const forgejoRes = await fetch(`${baseUrl}/api/forgejo/v1/version`);
      if (forgejoRes.ok) return true;
    } catch {
      // Forgejo 接口不可用，回退尝试 Gitea
    }

    try {
      const giteaRes = await fetch(`${baseUrl}/api/v1/version`);
      return giteaRes.ok;
    } catch {
      return false;
    }
  }

  viewPR(number: number, owner?: string, repo?: string): PRInfo | null {
    if (!Number.isInteger(number) || number < 1) return null;
    // 优先尝试 tea CLI
    try {
      const raw = execFileSync('tea', ['pr', 'view', String(number)], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      return {
        title: data.title,
        headBranch: data.head_branch,
        baseBranch: data.base_branch,
        url: data.html_url,
        body: data.body,
        author: data.user?.login,
      };
    } catch {
      // tea 未安装或失败，回退到 REST API
    }

    return this.viewPRviaRest(number, owner, repo);
  }

  private viewPRviaRest(number: number, owner?: string, repo?: string): PRInfo | null {
    const baseUrl = validateGiteaUrl(process.env.GITEA_URL ?? '');
    const token = process.env.GITEA_TOKEN;
    if (!baseUrl || !owner || !repo) return null;

    try {
      const args = ['-sS'];
      if (token) args.push('-H', `Authorization: token ${token}`);
      args.push(`${baseUrl}/api/v1/repos/${owner}/${repo}/pulls/${number}`);
      const raw = execFileSync('curl', args, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      return {
        title: data.title,
        headBranch: data.head?.ref ?? data.head_branch,
        baseBranch: data.base?.ref ?? data.base_branch,
        url: data.html_url,
        body: data.body,
        author: data.user?.login,
      };
    } catch {
      return null;
    }
  }

  viewIssue(number: number, owner?: string, repo?: string): IssueInfo | null {
    if (!Number.isInteger(number) || number < 1) return null;
    // 优先尝试 tea CLI
    try {
      const raw = execFileSync('tea', ['issues', 'view', String(number)], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      return {
        title: data.title,
        body: data.body,
        url: data.html_url,
        labels: data.labels?.map((l: { name: string }) => l.name),
      };
    } catch {
      // tea 未安装或失败，回退到 REST API
    }

    return this.viewIssueviaRest(number, owner, repo);
  }

  private viewIssueviaRest(number: number, owner?: string, repo?: string): IssueInfo | null {
    const baseUrl = validateGiteaUrl(process.env.GITEA_URL ?? '');
    const token = process.env.GITEA_TOKEN;
    if (!baseUrl || !owner || !repo) return null;

    try {
      const args = ['-sS'];
      if (token) args.push('-H', `Authorization: token ${token}`);
      args.push(`${baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`);
      const raw = execFileSync('curl', args, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      return {
        title: data.title,
        body: data.body,
        url: data.html_url,
        labels: data.labels?.map((l: { name: string }) => l.name),
      };
    } catch {
      return null;
    }
  }

  checkAuth(): boolean {
    // 检查 GITEA_TOKEN 环境变量
    if (process.env.GITEA_TOKEN) return true;

    // 尝试 tea CLI 鉴权
    try {
      execFileSync('tea', ['login', 'list'], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  getRequiredCLI(): string | null {
    return null;
  }
}
