# 项目会话管理器 (PSM) - 设计文档

> **技能名：** `project-session-manager`（别名：`psm`）
> **版本：** 1.0.0
> **作者：** wise
> **状态：** 设计草案

## 概要

项目会话管理器 (PSM) 通过 git worktree 与 tmux 会话自动化创建和管理隔离开发环境，并结合 Claude Code。它支持跨多个任务、项目与仓库并行工作，同时保持清晰隔离与便捷的上下文切换。

---

## 目录

1. [问题陈述](#1-problem-statement)
2. [用例](#2-use-cases)
3. [命令接口](#3-command-interface)
4. [架构](#4-architecture)
5. [目录结构](#5-directory-structure)
6. [会话命名约定](#6-session-naming-conventions)
7. [工作流预设](#7-workflow-presets)
8. [状态管理](#8-state-management)
9. [清理策略](#9-cleanup-strategies)
10. [集成点](#10-integration-points)
11. [边界情况与错误处理](#11-edge-cases--error-handling)
12. [安全考量](#12-security-considerations)
13. [未来增强](#13-future-enhancements)

---

<a id="1-problem-statement"></a>
## 1. 问题陈述

### 当前痛点

1. **上下文切换开销**：在任务间切换需要暂存变更、切换分支，并丢失 Claude Code 上下文
2. **PR 审查隔离**：审查 PR 常会污染工作目录
3. **并行工作受限**：每个仓库一次只能处理一个任务
4. **会话管理**：手动创建 tmux 会话既繁琐又不一致
5. **清理负担**：孤儿 worktree 与会话会随时间累积

### 解决方案

PSM 提供统一接口以：
- 用单条命令创建隔离 worktree
- 用 Claude Code 生成预配置 tmux 会话
- 跟踪并管理所有活跃会话
- 自动化清理已完成工作

---

<a id="2-use-cases"></a>
## 2. 用例

### 2.1 PR 审查

```bash
# Review PR #123 from wise repo
/psm review wise#123

# Review PR from any GitHub URL
/psm review https://github.com/anthropics/claude-code/pull/456

# Review with specific focus
/psm review wise#123 --focus "security implications"
```

**执行过程：**
1. 拉取 PR 分支
2. 在 `~/.psm/worktrees/wise/pr-123` 创建 worktree
3. 生成 tmux 会话 `psm:wise:pr-123`
4. 启动 Claude Code 并预加载 PR 上下文
5. 在编辑器中打开 diff（可选）

### 2.2 修复 Issue

```bash
# Fix issue #42
/psm fix wise#42

# Fix with branch name override
/psm fix wise#42 --branch fix/auth-timeout

# Fix from issue URL
/psm fix https://github.com/anthropics/claude-code/issues/789
```

**执行过程：**
1. 经 `gh` 拉取 issue 详情
2. 从 main 创建 feature 分支
3. 在 `~/.psm/worktrees/wise/issue-42` 创建 worktree
4. 生成带 issue 上下文的 tmux 会话
5. 向 Claude Code 预填 issue 描述

### 2.3 功能开发

```bash
# Start new feature
/psm feature wise "add-webhook-support"

# Feature from existing branch
/psm feature wise --branch feature/webhooks

# Feature with specific base
/psm feature wise "dark-mode" --base develop
```

**执行过程：**
1. 从指定 base 创建 feature 分支
2. 创建 worktree
3. 生成带功能上下文的会话
4. 可选创建草稿 PR

### 2.4 发布准备

```bash
# Prepare release
/psm release wise v3.5.0

# Release candidate
/psm release wise v3.5.0-rc1 --draft

# Hotfix release
/psm release wise v3.4.1 --hotfix --base v3.4.0
```

**执行过程：**
1. 创建 release 分支
2. 创建 worktree
3. 生成带发布清单的会话
4. 预加载 CHANGELOG 上下文

### 2.5 会话管理

```bash
# List all sessions
/psm list

# List sessions for specific project
/psm list wise

# Attach to existing session
/psm attach wise:pr-123

# Detach current session (return to main)
/psm detach

# Kill specific session
/psm kill wise:pr-123

# Kill all sessions for project
/psm kill wise --all

# Cleanup completed sessions
/psm cleanup

# Cleanup aggressively (force)
/psm cleanup --force --older-than 7d
```

### 2.6 快速上下文切换

```bash
# Switch to another session (detach current, attach target)
/psm switch wise:feature-auth

# Switch with session picker (fzf)
/psm switch
```

---

<a id="3-command-interface"></a>
## 3. 命令接口

### 3.1 主要命令

| 命令 | 说明 | 别名 |
|---------|-------------|---------|
| `review <ref>` | 启动 PR 审查会话 | `pr`, `r` |
| `fix <ref>` | 启动 issue 修复会话 | `issue`, `i` |
| `feature <name>` | 启动功能开发 | `feat`, `f` |
| `release <version>` | 启动发布准备 | `rel` |
| `list [project]` | 列出活跃会话 | `ls`, `l` |
| `attach <session>` | 接入会话 | `a` |
| `detach` | 从当前会话分离 | `d` |
| `switch [session]` | 切换会话 | `sw`, `s` |
| `kill <session>` | 终止会话 | `k`, `rm` |
| `cleanup` | 清理已完成会话 | `gc`, `clean` |
| `status` | 显示当前会话信息 | `st` |

### 3.2 全局 flag

| Flag | 说明 | 默认值 |
|------|-------------|---------|
| `--project`, `-p` | 项目标识符或路径 | 当前目录 |
| `--no-claude` | 跳过启动 Claude Code | false |
| `--no-tmux` | 使用当前终端 | false |
| `--editor`, `-e` | 之后在编辑器中打开 | false |
| `--verbose`, `-v` | 详细输出 | false |
| `--dry-run` | 显示将执行的操作 | false |

### 3.3 项目引用

PSM 支持多种引用格式：

```bash
# Short alias (requires ~/.psm/projects.json config)
wise#123

# Full GitHub reference
anthropics/claude-code#123

# GitHub URL
https://github.com/anthropics/claude-code/pull/123

# Local path
/path/to/repo#123

# Current directory (implicit)
#123
```

### 3.4 项目别名配置

```json
// ~/.psm/projects.json
{
  "aliases": {
    "wise": {
      "repo": "anthropics/wise",
      "local": "~/Workspace/wise",
      "default_base": "main"
    },
    "cc": {
      "repo": "anthropics/claude-code",
      "local": "~/Workspace/claude-code",
      "default_base": "main"
    },
    "myapp": {
      "repo": "myorg/myapp",
      "local": "~/Projects/myapp",
      "default_base": "develop"
    }
  },
  "defaults": {
    "worktree_root": "~/.psm/worktrees",
    "cleanup_after_days": 14,
    "auto_cleanup_merged": true
  }
}
```

---

<a id="4-architecture"></a>
## 4. 架构

### 4.1 组件概览

```
┌─────────────────────────────────────────────────────────────┐
│                    PSM Skill Entry Point                     │
│                   /wise:psm                      │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │  Command Parser │ │ State Store │ │ Project Resolver│
    │   (argparse)    │ │  (JSON DB)  │ │  (git/gh API)   │
    └─────────────────┘ └─────────────┘ └─────────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
    ┌─────────────────────────────────────────────────────────┐
    │                   Session Orchestrator                   │
    └─────────────────────────────────────────────────────────┘
              │               │               │
              ▼               ▼               ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │ Worktree Manager│ │Tmux Manager │ │ Claude Launcher │
    │   (git cmd)     │ │ (tmux cmd)  │ │  (claude cmd)   │
    └─────────────────┘ └─────────────┘ └─────────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
    ┌─────────────────────────────────────────────────────────┐
    │                    Integration Layer                     │
    │  (gh CLI, git, tmux, claude, wise skills, Clawdbot)       │
    └─────────────────────────────────────────────────────────┘
```

### 4.2 会话生命周期

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  CREATING  │ ──▶ │   ACTIVE   │ ──▶ │  DETACHED  │ ──▶ │  ARCHIVED  │
└────────────┘     └────────────┘     └────────────┘     └────────────┘
      │                  │                  │                  │
      │                  │                  │                  │
      ▼                  ▼                  ▼                  ▼
  - Fetch refs      - Claude active    - Session saved    - Worktree kept
  - Create worktree - Tmux attached    - Tmux running     - PR merged
  - Create branch   - Work in progress - Can resume       - Ready for GC
  - Start tmux
  - Launch claude
```

### 4.3 数据流

```
User Command
     │
     ▼
┌─────────────────┐
│ Parse Arguments │
└─────────────────┘
     │
     ▼
┌─────────────────┐     ┌─────────────────┐
│ Resolve Project │◀───▶│ projects.json   │
└─────────────────┘     └─────────────────┘
     │
     ▼
┌─────────────────┐     ┌─────────────────┐
│ Fetch Context   │◀───▶│ GitHub API (gh) │
│ (PR/Issue/etc)  │     └─────────────────┘
└─────────────────┘
     │
     ▼
┌─────────────────┐     ┌─────────────────┐
│ Create Worktree │◀───▶│ Git Repository  │
└─────────────────┘     └─────────────────┘
     │
     ▼
┌─────────────────┐     ┌─────────────────┐
│ Create Session  │◀───▶│ sessions.json   │
└─────────────────┘     └─────────────────┘
     │
     ▼
┌─────────────────┐
│ Launch Tmux +   │
│ Claude Code     │
└─────────────────┘
```

---

<a id="5-directory-structure"></a>
## 5. 目录结构

### 5.1 全局 PSM 目录

```
~/.psm/
├── config.json              # Global configuration
├── projects.json            # Project aliases
├── sessions.json            # Active session registry
├── templates/               # Session templates
│   ├── pr-review.md         # PR review prompt template
│   ├── issue-fix.md         # Issue fix prompt template
│   ├── feature.md           # Feature dev template
│   └── release.md           # Release prep template
├── logs/                    # Session logs
│   └── psm.log
└── worktrees/               # Default worktree location
    ├── wise/                 # Per-project worktrees
    │   ├── pr-123/
    │   ├── issue-42/
    │   └── feature-auth/
    └── claude-code/
        └── pr-456/
```

### 5.2 单会话目录

```
~/.psm/worktrees/wise/pr-123/
├── .git                     # Git worktree link
├── .psm-session.json        # Session metadata
├── .psm-context.md          # Pre-loaded Claude context
├── <project files>          # Actual code
└── .wise/                    # WISE state (if applicable)
```

### 5.3 会话元数据文件

```json
// .psm-session.json
{
  "id": "wise:pr-123",
  "type": "review",
  "project": "wise",
  "ref": "pr-123",
  "branch": "feature/add-hooks",
  "base": "main",
  "created_at": "2024-01-26T10:30:00Z",
  "last_accessed": "2024-01-26T14:45:00Z",
  "tmux_session": "psm:wise:pr-123",
  "worktree_path": "~/.psm/worktrees/wise/pr-123",
  "source_repo": "~/Workspace/wise",
  "github": {
    "pr_number": 123,
    "pr_title": "Add webhook support",
    "pr_author": "contributor",
    "pr_url": "https://github.com/anthropics/wise/pull/123"
  },
  "state": "active",
  "notes": []
}
```

---

<a id="6-session-naming-conventions"></a>
## 6. 会话命名约定

### 6.1 Tmux 会话名

格式：`psm:<project>:<type>-<identifier>`

| 类型 | 模式 | 示例 |
|------|---------|---------|
| PR 审查 | `psm:<proj>:pr-<num>` | `psm:wise:pr-123` |
| Issue 修复 | `psm:<proj>:issue-<num>` | `psm:wise:issue-42` |
| 功能开发 | `psm:<proj>:feat-<name>` | `psm:wise:feat-auth` |
| 发布 | `psm:<proj>:rel-<ver>` | `psm:wise:rel-v3.5.0` |
| 通用 | `psm:<proj>:<name>` | `psm:wise:experiment` |

### 6.2 Worktree 目录名

格式：`<type>-<identifier>`

| 类型 | 模式 | 示例 |
|------|---------|---------|
| PR 审查 | `pr-<num>` | `pr-123` |
| Issue 修复 | `issue-<num>` | `issue-42` |
| 功能开发 | `feat-<name>` | `feat-auth` |
| 发布 | `rel-<ver>` | `rel-v3.5.0` |

### 6.3 分支名

| 类型 | 模式 | 示例 |
|------|---------|---------|
| PR 审查 | （使用 PR 分支） | `feature/add-hooks` |
| Issue 修复 | `fix/<issue>-<slug>` | `fix/42-auth-timeout` |
| 功能开发 | `feature/<name>` | `feature/auth` |
| 发布 | `release/<ver>` | `release/v3.5.0` |
| 热修复 | `hotfix/<ver>` | `hotfix/v3.4.1` |

---

<a id="7-workflow-presets"></a>
## 7. 工作流预设

### 7.1 PR 审查预设

```yaml
name: pr-review
steps:
  - fetch_pr_info
  - create_worktree_from_pr_branch
  - generate_review_context:
      template: pr-review.md
      includes:
        - pr_description
        - changed_files_summary
        - commit_history
        - related_issues
  - spawn_tmux_session
  - launch_claude_with_context:
      initial_prompt: |
        You are reviewing PR #{{pr_number}}: {{pr_title}}

        Focus areas:
        - Code quality and patterns
        - Security implications
        - Test coverage
        - Documentation updates

        Changed files:
        {{changed_files}}
```

### 7.2 Issue 修复预设

```yaml
name: issue-fix
steps:
  - fetch_issue_info
  - create_branch_from_base
  - create_worktree
  - generate_fix_context:
      template: issue-fix.md
      includes:
        - issue_description
        - issue_labels
        - related_code_search
        - similar_issues
  - spawn_tmux_session
  - launch_claude_with_context:
      initial_prompt: |
        You are fixing issue #{{issue_number}}: {{issue_title}}

        Issue description:
        {{issue_body}}

        Labels: {{labels}}

        Potentially related files:
        {{related_files}}
```

### 7.3 功能开发预设

```yaml
name: feature-dev
steps:
  - create_feature_branch
  - create_worktree
  - generate_feature_context:
      template: feature.md
      includes:
        - project_structure
        - related_components
        - coding_standards
  - spawn_tmux_session
  - launch_claude_with_context:
      initial_prompt: |
        You are developing feature: {{feature_name}}

        Project context loaded. Ready to implement.

        Suggested starting point:
        {{suggested_files}}
```

### 7.4 发布准备预设

```yaml
name: release-prep
steps:
  - validate_version_format
  - create_release_branch
  - create_worktree
  - generate_release_context:
      template: release.md
      includes:
        - changelog_since_last_release
        - pending_prs
        - version_files
        - release_checklist
  - spawn_tmux_session
  - launch_claude_with_context:
      initial_prompt: |
        You are preparing release {{version}}

        Changes since last release:
        {{changelog}}

        Release checklist:
        - [ ] Update version in package.json
        - [ ] Update CHANGELOG.md
        - [ ] Run full test suite
        - [ ] Update documentation
        - [ ] Create release notes
```

---

<a id="8-state-management"></a>
## 8. 状态管理

### 8.1 会话注册表

```json
// ~/.psm/sessions.json
{
  "version": 1,
  "sessions": {
    "wise:pr-123": {
      "id": "wise:pr-123",
      "state": "active",
      "created_at": "2024-01-26T10:30:00Z",
      "last_accessed": "2024-01-26T14:45:00Z",
      "worktree": "~/.psm/worktrees/wise/pr-123",
      "tmux": "psm:wise:pr-123",
      "type": "review",
      "metadata": {
        "pr_number": 123,
        "pr_merged": false
      }
    },
    "wise:issue-42": {
      "id": "wise:issue-42",
      "state": "detached",
      "created_at": "2024-01-25T09:00:00Z",
      "last_accessed": "2024-01-25T18:00:00Z",
      "worktree": "~/.psm/worktrees/wise/issue-42",
      "tmux": "psm:wise:issue-42",
      "type": "fix",
      "metadata": {
        "issue_number": 42,
        "issue_closed": false
      }
    }
  },
  "stats": {
    "total_created": 45,
    "total_cleaned": 32,
    "active_count": 3
  }
}
```

### 8.2 状态转换

```
┌───────────┐
│  CREATING │ ─── on success ───▶ ACTIVE
└───────────┘
      │
      │ on failure
      ▼
┌───────────┐
│  FAILED   │ ─── cleanup ───▶ (removed)
└───────────┘

┌───────────┐
│  ACTIVE   │ ─── detach ───▶ DETACHED
└───────────┘
      │
      │ kill
      ▼
┌───────────┐
│ ARCHIVED  │ ─── cleanup ───▶ (removed)
└───────────┘

┌───────────┐
│ DETACHED  │ ─── attach ───▶ ACTIVE
└───────────┘
      │
      │ pr_merged / issue_closed / timeout
      ▼
┌───────────┐
│ ARCHIVED  │
└───────────┘
```

### 8.3 自动归档触发条件

会话在以下情况下自动转为 ARCHIVED：

1. **PR 已合并**：GitHub webhook 或轮询检测到合并
2. **Issue 已关闭**：GitHub webhook 或轮询检测到关闭
3. **不活动超时**：超过配置天数未访问（默认：14）
4. **手动归档**：用户标记为完成

---

<a id="9-cleanup-strategies"></a>
## 9. 清理策略

### 9.1 清理级别

| 级别 | 命令 | 清理内容 |
|-------|---------|----------------|
| 安全 | `/psm cleanup` | 已合并 PR、已关闭 issue、已归档 |
| 中等 | `/psm cleanup --stale` | + 不活动超过 14 天 |
| 激进 | `/psm cleanup --force` | + 所有已分离会话 |
| 彻底 | `/psm cleanup --all` | 全部（需确认） |

### 9.2 清理算法

```python
def cleanup(options):
    sessions = load_sessions()
    to_remove = []

    for session in sessions:
        should_remove = False

        # Level 1: Safe (always)
        if session.type == "review" and session.pr_merged:
            should_remove = True
        elif session.type == "fix" and session.issue_closed:
            should_remove = True
        elif session.state == "archived":
            should_remove = True

        # Level 2: Stale
        if options.stale:
            days_inactive = now() - session.last_accessed
            if days_inactive > options.older_than:
                should_remove = True

        # Level 3: Force
        if options.force:
            if session.state == "detached":
                should_remove = True

        if should_remove:
            to_remove.append(session)

    # Execute cleanup
    for session in to_remove:
        if not options.dry_run:
            kill_tmux_session(session.tmux)
            remove_worktree(session.worktree)
            remove_session_record(session.id)

        log(f"Cleaned: {session.id}")
```

### 9.3 清理保护措施

1. **未提交变更检查**：worktree 有未提交变更时警告
2. **未推送提交检查**：本地提交未推送时警告
3. **活跃会话检查**：永不清理当前接入的会话
4. **确认提示**：激进/彻底清理时需确认
5. **试运行**：始终预览将清理的内容

### 9.4 定时清理

```json
// ~/.psm/config.json
{
  "cleanup": {
    "auto_enabled": true,
    "schedule": "daily",
    "level": "safe",
    "older_than_days": 14,
    "notify_before_cleanup": true
  }
}
```

---

<a id="10-integration-points"></a>
## 10. 集成点

### 10.1 WISE 技能集成

| WISE 技能 | PSM 集成 |
|-----------|-----------------|
| `autopilot` | 可为隔离工作生成 PSM 会话 |
| `ultrawork` | 跨 PSM 会话的并行智能体 |
| `ralph` | 按 PSM 会话进行持久化跟踪 |
| `git-master` | 感知 worktree 上下文 |
| `deepsearch` | 限定于会话 worktree 范围 |

### 10.2 Clawdbot 集成

```typescript
// Clawdbot can manage PSM sessions
interface ClawdbotPSMIntegration {
  // List sessions via Clawdbot UI
  listSessions(): Promise<Session[]>;

  // Create session from Clawdbot
  createSession(options: SessionOptions): Promise<Session>;

  // Attach to session in new terminal
  attachSession(sessionId: string): Promise<void>;

  // Session status in Clawdbot dashboard
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
}
```

### 10.3 GitHub 集成

| 功能 | 集成 |
|---------|-------------|
| PR 创建 | 从功能会话自动创建草稿 PR |
| PR 状态 | 跟踪合并状态以用于清理 |
| Issue 关联 | 自动将提交关联到 issue |
| 审查评论 | 加载审查评论作为上下文 |
| CI 状态 | 在会话信息中显示 CI 状态 |

### 10.4 编辑器集成

```bash
# VSCode
/psm review wise#123 --editor vscode

# Cursor
/psm review wise#123 --editor cursor

# Neovim
/psm review wise#123 --editor nvim
```

在 tmux 会话旁于 worktree 目录中打开编辑器。

### 10.5 HUD 集成

WISE HUD statusline 中的 PSM 状态：

```
[psm:wise:pr-123] 📋 Review | 🕐 2h active | 📁 ~/.psm/worktrees/wise/pr-123
```

---

<a id="11-edge-cases--error-handling"></a>
## 11. 边界情况与错误处理

### 11.1 常见边界情况

| 场景 | 处理方式 |
|----------|----------|
| worktree 已存在 | 提供：接入、重建或中止 |
| tmux 会话名冲突 | 追加时间戳后缀 |
| PR 分支被强制推送 | 警告并提供重新拉取选项 |
| 网络离线 | 缓存可缓存内容，排队 GitHub 操作 |
| 主仓库 git 脏状态 | 警告但允许（worktree 已隔离） |
| worktree 位于不同文件系统 | 改用 git clone |
| 极大仓库 | 提供浅克隆选项 |
| 会话元数据损坏 | 从 git/tmux 状态重建 |

### 11.2 错误恢复

```bash
# Rebuild sessions.json from existing worktrees and tmux
/psm repair

# Fix orphaned tmux sessions (no worktree)
/psm repair --orphaned-tmux

# Fix orphaned worktrees (no session record)
/psm repair --orphaned-worktrees

# Full reconstruction
/psm repair --full
```

### 11.3 冲突解决

```
User runs: /psm review wise#123

Existing session found!

Options:
  [A] Attach to existing session (recommended)
  [R] Recreate (destroys existing worktree)
  [C] Create parallel (wise:pr-123-2)
  [Q] Quit
```

---

<a id="12-security-considerations"></a>
## 12. 安全考量

### 12.1 凭据处理

- **GitHub Token**：使用既有 `gh` CLI 认证，PSM 永不存储
- **SSH 密钥**：依赖系统 SSH agent
- **worktree 中的密钥**：worktree 继承 .gitignore，密钥不重复

### 12.2 路径净化

```python
def sanitize_session_name(name: str) -> str:
    # Prevent path traversal
    name = name.replace("..", "")
    name = name.replace("/", "-")
    name = name.replace("\\", "-")
    # Limit length
    name = name[:64]
    # Alphanumeric + dash only
    name = re.sub(r'[^a-zA-Z0-9-]', '', name)
    return name
```

### 12.3 权限

- worktree 目录：`0755`（用户 rwx，其他 rx）
- 会话元数据：`0600`（仅用户）
- 配置文件：`0600`（仅用户）

---

<a id="13-future-enhancements"></a>
## 13. 未来增强

### 13.1 计划功能

| 功能 | 优先级 | 说明 |
|---------|----------|-------------|
| 会话模板 | 高 | 自定义工作流模板 |
| 团队共享 | 中 | 共享会话配置 |
| 会话录制 | 中 | 录制会话以供回放 |
| 云同步 | 低 | 跨机器同步会话 |
| 自动创建 PR | 中 | 会话完成时创建 PR |
| 会话指标 | 低 | 按会话跟踪时间 |

### 13.2 扩展点

```typescript
// Plugin interface for custom workflows
interface PSMPlugin {
  name: string;

  // Called before session creation
  beforeCreate?(context: SessionContext): Promise<void>;

  // Called after session creation
  afterCreate?(session: Session): Promise<void>;

  // Custom cleanup logic
  shouldCleanup?(session: Session): Promise<boolean>;

  // Custom context generation
  generateContext?(session: Session): Promise<string>;
}
```

### 13.3 潜在集成

- **Linear**：从 Linear issue 创建会话
- **Jira**：从 Jira 工单创建会话
- **Slack**：会话事件通知
- **Discord**：团队会话协调

---

## 附录 A：快速参考卡

```
┌────────────────────────────────────────────────────────────┐
│            Project Session Manager (PSM)                   │
├────────────────────────────────────────────────────────────┤
│ CREATE SESSIONS                                            │
│   /psm review <pr>      Review a PR                       │
│   /psm fix <issue>      Fix an issue                      │
│   /psm feature <name>   Start feature                     │
│   /psm release <ver>    Prepare release                   │
├────────────────────────────────────────────────────────────┤
│ MANAGE SESSIONS                                            │
│   /psm list             List all sessions                 │
│   /psm attach <id>      Attach to session                 │
│   /psm switch [id]      Switch sessions                   │
│   /psm detach           Detach current                    │
│   /psm status           Current session info              │
├────────────────────────────────────────────────────────────┤
│ CLEANUP                                                    │
│   /psm cleanup          Clean merged/closed               │
│   /psm kill <id>        Kill specific session             │
│   /psm repair           Fix corrupted state               │
├────────────────────────────────────────────────────────────┤
│ REFERENCES                                                 │
│   wise#123               Project alias + number            │
│   org/repo#123          Full GitHub reference             │
│   https://...           GitHub URL                        │
└────────────────────────────────────────────────────────────┘
```

---

## 附录 B：配置参考

```json
// ~/.psm/config.json (complete)
{
  "version": 1,
  "worktree_root": "~/.psm/worktrees",
  "defaults": {
    "editor": "cursor",
    "launch_claude": true,
    "launch_tmux": true,
    "shallow_clone_depth": 100
  },
  "cleanup": {
    "auto_enabled": true,
    "schedule": "daily",
    "level": "safe",
    "older_than_days": 14,
    "notify_before_cleanup": true,
    "keep_archived_days": 7
  },
  "tmux": {
    "session_prefix": "psm",
    "default_layout": "main-vertical",
    "status_bar": true
  },
  "claude": {
    "auto_context": true,
    "context_template": "default",
    "model": "opus"
  },
  "github": {
    "poll_interval_minutes": 5,
    "auto_fetch_pr_reviews": true
  },
  "notifications": {
    "on_pr_merged": true,
    "on_issue_closed": true,
    "on_cleanup": true
  }
}
```

---

## 附录 C：会话交互示例

```bash
$ /psm review wise#123

🔍 Fetching PR #123 from wise...
   Title: "Add webhook support for external integrations"
   Author: @contributor
   Changed: 12 files (+450, -23)

📁 Creating worktree at ~/.psm/worktrees/wise/pr-123...
   Branch: feature/webhook-support
   Base: main

🖥️  Creating tmux session: psm:wise:pr-123...

🤖 Launching Claude Code with PR context...

✅ Session ready!

   Session ID: wise:pr-123
   Worktree:   ~/.psm/worktrees/wise/pr-123
   Tmux:       psm:wise:pr-123

   Commands:
     /psm attach wise:pr-123  - Reattach later
     /psm kill wise:pr-123    - End session
     /psm cleanup            - Clean when PR merged

Attaching to session...
```

---

*文档版本：1.0.0*
*最后更新：2024-01-26*
