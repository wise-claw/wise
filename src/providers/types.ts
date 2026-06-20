/**
 * Git Provider 抽象类型
 *
 * 用于多 provider git 托管支持的共享接口。
 * Providers：GitHub、GitLab、Bitbucket、Azure DevOps、Gitea/Forgejo。
 */

/** 支持的 git 托管 provider 标识符 */
export type ProviderName =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'azure-devops'
  | 'gitea'
  | 'forgejo'
  | 'unknown';

/** 解析后的远程 URL 信息 */
export interface RemoteUrlInfo {
  provider: ProviderName;
  host: string;
  owner: string;
  repo: string;
}

/** Pull request / merge request 信息 */
export interface PRInfo {
  title: string;
  headBranch?: string;
  baseBranch?: string;
  url?: string;
  body?: string;
  author?: string;
}

/** Issue / work item 信息 */
export interface IssueInfo {
  title: string;
  body?: string;
  labels?: string[];
  url?: string;
}

/**
 * Git 托管 provider 接口。
 *
 * 每个 provider 实现该接口，通过其 CLI 工具或 REST API
 * 支持 PR/issue 操作。
 */
export interface GitProvider {
  /** Provider 标识符 */
  readonly name: ProviderName;

  /** 人类可读名称（例如 "GitHub"、"GitLab"） */
  readonly displayName: string;

  /** 该 provider 对 PR 的称呼：'PR' 或 'MR' */
  readonly prTerminology: 'PR' | 'MR';

  /**
   * 用于拉取 PR/MR 分支的 Git refspec 模式。
   * 使用 {number} 作为 PR/MR 编号占位符，
   * {branch} 作为本地分支名占位符。
   * 示例：GitHub 为 "pull/{number}/head:{branch}"。
   * 若 provider 不支持基于 refspec 的拉取，则为 null。
   */
  readonly prRefspec: string | null;

  /** 检查某远程 URL 是否属于该 provider */
  detectFromRemote(url: string): boolean;

  /** 探测 API 接口以识别该 provider（用于自托管场景） */
  detectFromApi?(baseUrl: string): Promise<boolean>;

  /** 拉取 PR/MR 信息 */
  viewPR(number: number, owner?: string, repo?: string): PRInfo | null | Promise<PRInfo | null>;

  /** 拉取 issue/work-item 信息 */
  viewIssue(number: number, owner?: string, repo?: string): IssueInfo | null | Promise<IssueInfo | null>;

  /** 检查该 provider 的 CLI 是否已通过鉴权 */
  checkAuth(): boolean;

  /** 返回所需的 CLI 工具名；若仅使用 API 则返回 null */
  getRequiredCLI(): string | null;
}
