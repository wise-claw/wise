import { execFileSync } from 'node:child_process';
import type { GitProvider, PRInfo, IssueInfo } from './types.js';

export class GitLabProvider implements GitProvider {
  readonly name = 'gitlab' as const;
  readonly displayName = 'GitLab';
  readonly prTerminology = 'MR' as const;
  readonly prRefspec = 'merge-requests/{number}/head:{branch}';

  detectFromRemote(url: string): boolean {
    const lower = url.toLowerCase();
    if (lower.includes('gitlab.com')) return true;
    // 自托管：匹配主机名中包含 'gitlab' 的标签，而非路径/查询串
    const hostMatch = lower.match(/^(?:https?:\/\/|ssh:\/\/[^@]*@|[^@]+@)([^/:]+)/);
    const host = hostMatch ? hostMatch[1] : '';
    return /(^|[.-])gitlab([.-]|$)/.test(host);
  }

  async detectFromApi(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/v4/version`);
      return response.ok;
    } catch {
      return false;
    }
  }

  viewPR(number: number, owner?: string, repo?: string): PRInfo | null {
    if (!Number.isInteger(number) || number < 1) return null;
    try {
      const args = ['mr', 'view', String(number)];
      if (owner && repo) args.push('--repo', `${owner}/${repo}`);
      args.push('--output', 'json');
      const raw = execFileSync('glab', args, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      return {
        title: data.title,
        headBranch: data.source_branch,
        baseBranch: data.target_branch,
        url: data.web_url,
        body: data.description,
        author: data.author?.username,
      };
    } catch {
      return null;
    }
  }

  viewIssue(number: number, owner?: string, repo?: string): IssueInfo | null {
    if (!Number.isInteger(number) || number < 1) return null;
    try {
      const args = ['issue', 'view', String(number)];
      if (owner && repo) args.push('--repo', `${owner}/${repo}`);
      args.push('--output', 'json');
      const raw = execFileSync('glab', args, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(raw);
      return {
        title: data.title,
        body: data.description,
        url: data.web_url,
        labels: data.labels,
      };
    } catch {
      return null;
    }
  }

  checkAuth(): boolean {
    try {
      execFileSync('glab', ['auth', 'status'], {
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
    return 'glab';
  }
}
