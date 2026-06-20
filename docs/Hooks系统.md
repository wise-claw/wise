# Hooks 系统

> WISE 的 20 个 hook 拦截 Claude Code 生命周期事件，以实现魔法关键词、上下文注入与质量强制。

## 什么是 Hooks？

Hooks 是在 Claude Code 生命周期事件触发时自动执行的脚本。wise 通过 20 个 hook 扩展了 Claude Code 的默认行为。

当用户提交 prompt、工具运行或会话开始/结束时，hook 会自动触发以注入额外上下文、激活模式并管理 state。

## Hooks 如何工作

Hooks 定义在 `hooks.json` 文件中。每个 hook 遵循如下结构：

```json
{
  "EventName": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "node scripts/hook-script.mjs",
          "timeout": 5
        }
      ]
    }
  ]
}
```

- **EventName**：hook 响应的生命周期事件
- **matcher**：运行 hook 的条件（`*` 匹配所有情况）
- **command**：要执行的 Node.js 脚本
- **timeout**：最大执行时间（秒）

Hook 输出经 `<system-reminder>` 标签注入 Claude。额外上下文通过 `hookSpecificOutput.additionalContext` 传递。

## Hook 类别

WISE hook 分为四类：

### 核心 Hooks

处理编排、关键词检测与模式持久化。

| Hook | 说明 |
|------|------|
| keyword-detector | 检测魔法关键词并激活对应技能 |
| persistent-mode | 当执行模式（ralph、autopilot、ultrawork 等）激活时强制续跑 — 在 Stop 时注入强化消息以防过早停止 |

### 上下文管理 Hooks

管理记忆、项目 state 与压缩。

| Hook | 说明 |
|------|------|
| notepad | 抗压缩记忆系统 |
| project-memory | 管理项目级记忆 |
| pre-compact | 在压缩前处理 state |

### 质量 / 验证 Hooks

处理代码质量、权限与 subagent 跟踪。

| Hook | 说明 |
|------|------|
| permission-handler | 处理权限请求与校验 |
| subagent-tracker | 跟踪 subagent 生成与完成 |
| code-simplifier | 在 Stop 时自动简化最近修改的文件（可选启用） |

## 禁用 Hooks

### 禁用全部 Hooks

```bash
export DISABLE_WISE=1
```

### 禁用特定 Hooks

```bash
export WISE_SKIP_HOOKS="keyword-detector,notepad"
```

用逗号分隔 hook 名称，以仅跳过这些 hook。

---

## 生命周期事件

Claude Code 在整个会话中发出事件。WISE 将 hook 挂载到这些事件以扩展行为。共有 11 个生命周期事件。

### UserPromptSubmit

在用户提交 prompt 时触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `keyword-detector.mjs` | 检测魔法关键词并调用对应技能 | 5s |
| `skill-injector.mjs` | 注入技能 prompt | 3s |

对所有用户输入运行（`matcher: "*"`）。当关键词检测器发现 "ultrawork"、"ralph" 或 "autopilot" 等关键词时，会通过 `additionalContext` 注入对应的技能调用指令。

### SessionStart

在新会话开始时触发。

| 脚本 | 匹配器 | 作用 | 超时 |
|------|--------|------|------|
| `session-start.mjs` | `*` | 会话初始化、state 恢复 | 5s |
| `project-memory-session.mjs` | `*` | 加载项目记忆 | 5s |
| `setup-init.mjs` | `init` | 初始 setup 向导 | 30s |
| `setup-maintenance.mjs` | `maintenance` | 维护任务 | 60s |

`init` 与 `maintenance` 匹配器仅在特殊情况运行。正常会话启动时，仅执行两个 `*` 匹配器脚本。

### PreToolUse

在 Claude 使用工具前立即触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `pre-tool-enforcer.mjs` | 在工具使用前校验规则 | 3s |

对所有工具调用运行（`matcher: "*"`）。强制智能体权限限制（例如，对只读智能体阻止 Write/Edit）。

### PermissionRequest

在 Bash 工具执行期间产生权限请求时触发。

| 脚本 | 匹配器 | 作用 | 超时 |
|------|--------|------|------|
| `permission-handler.mjs` | `Bash` | 处理 Bash 命令权限 | 5s |

仅处理 Bash 工具的权限请求。

### PostToolUse

在工具使用完成后触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `post-tool-verifier.mjs` | 验证工具结果并注入额外上下文 | 3s |
| `project-memory-posttool.mjs` | 更新项目记忆 | 3s |

根据 Read、Write、Edit 与 Bash 结果注入额外指引。例如，读取文件后可能提示"考虑使用并行读取"。

### PostToolUseFailure

在工具使用失败时触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `post-tool-use-failure.mjs` | 为失败的工具使用提供恢复指引 | 3s |

可通过 `DISABLE_WISE=1`（或 `DISABLE_WISE=true`）或 `WISE_SKIP_HOOKS=post-tool-use-failure` 禁用（`post-tool-use` token 也会跳过它，同时跳过 `post-tool-verifier.mjs`）。

### SubagentStart

在生成 subagent 时触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `subagent-tracker.mjs start` | 跟踪 subagent 启动、注入 prompt | 3s |

记录 subagent 名称、启动时间与会话信息。

### SubagentStop

在 subagent 完成时触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `subagent-tracker.mjs stop` | 跟踪 subagent 完成 | 5s |
| `verify-deliverables.mjs` | 验证 subagent 交付物 | 5s |

### PreCompact

在上下文压缩前立即触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `pre-compact.mjs` | 在压缩前保留 state | 10s |
| `project-memory-precompact.mjs` | 保留项目记忆 | 5s |

因上下文窗口已满而运行压缩前，保存重要的 state 与记忆。

### Stop

在 Claude 完成响应时触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `context-guard-stop.mjs` | 监控上下文使用量 | 5s |
| `persistent-mode.cjs` | 维护激活模式 state（ralph、ultrawork 等） | 10s |
| `code-simplifier.mjs` | 自动简化已修改文件（可选启用） | 5s |

当有激活的执行模式运行时，`persistent-mode` 会注入如"The boulder never stops"的强化消息，提示继续工作。

### SessionEnd

在会话结束时触发。

| 脚本 | 作用 | 超时 |
|------|------|------|
| `session-end.mjs` | 保存会话摘要、发送回调通知 | 30s |

将智能体活动、token 使用量与其他会话数据保存到 `.wise/sessions/`。若已配置，则通过 Discord、Telegram 或 Slack 发送完成通知。

---

## 核心 Hooks

### 核心 Hook 详情

#### keyword-detector

检测用户 prompt 中的魔法关键词并调用对应技能。

- **事件**：UserPromptSubmit
- **行为**：净化 prompt（移除代码块、URL、文件路径）后匹配关键词模式
- **冲突解决**：cancel 优先级最高，其次 ralph > autopilot > ultrawork
- **安全**：在 team worker 内禁用，以防无限生成

完整关键词列表见[魔法关键词](#magic-keywords)节。

#### persistent-mode

当执行模式激活时强制续跑。这是让 autopilot、ralph 与 ultrawork 等技能持续运行的 hook。

- **事件**：Stop
- **行为**：检查 `.wise/state/` 中的激活模式 state 文件。若任一模式（ralph、ultragoal、autopilot、ultrawork、ultraqa、team、pipeline）激活，则注入强化消息以防 Claude 停止。
- **强化消息**："The boulder never stops" — 提示 Claude 继续工作
- **陈旧检查**：超过 2 小时的 state 视为非激活，以防陈旧 state 阻塞新会话
- **通知**：首次 stop 时发送 Discord/Telegram/Slack 通知（若已配置）
- **取消**：使用 `/wise:cancel` 停用模式

> **说明**：autopilot、ralph、ultrawork 与 ultraqa 是**技能**（经 keyword-detector 调用），不是 hooks。persistent-mode hook 通过阻塞 Stop 事件来强制其续跑。

### 模式 State 管理

执行模式 hook 管理 `.wise/state/` 目录中的 state 文件。

```json
{
  "active": true,
  "started_at": "2025-01-15T10:30:00Z",
  "prompt": "ultrawork implement auth",
  "session_id": "abc123",
  "project_path": "/path/to/project",
  "iteration": 0,
  "max_iterations": 10,
  "linked_ultrawork": false,
  "last_checked_at": "2025-01-15T10:30:00Z"
}
```

当存在会话 ID 时，state 存储于 `.wise/state/sessions/{sessionId}/` 下的会话作用域中。


#### ultragoal-state.json 生命周期

`ultragoal-state.json` 是 `$ultragoal` 运行的会话作用域 Stop/PreToolUse 守卫。持久计划与审计账本保留在 `.wise/ultragoal/goals.json` 与 `.wise/ultragoal/ledger.jsonl`；state 文件仅记录激活的运行时守卫。

- **位置**：当存在 Claude 会话 id 时为 `.wise/state/sessions/{sessionId}/ultragoal-state.json`；legacy 降级为 `.wise/state/ultragoal-state.json`。
- **激活字段**：`active: true`、`session_id`、`project_path`、`started_at`、`last_checked_at`、`current_phase`、可选 `claude_goal_objective` 与 `reinforcement_count`。
- **Stop hook**：仅当 state 激活、新鲜（在正常 2 小时模式 state 新鲜窗口内）、会话匹配且项目匹配时才强化。终态阶段（`complete`、`completed`、`done`、`all-done`、`failed`、`cancelled`）与 all-done 的 `.wise/ultragoal/goals.json` 计划被忽略。
- **PreToolUse 守卫**：激活时，除非 hook 能看到匹配的激活 Claude `/goal` 快照，否则工具被拒绝。仅在有意本地绕过时使用 `ALLOW_ULTRAGOAL_WITHOUT_GOAL=1`。
- **完成**：在最终质量门与 ultragoal checkpoint 后，标记 state 为非激活或运行 `/wise:cancel`，以便该 state 文件随其他工作流 state 一并清除。

#### 取消模式

```
cancelwise
```

或

```
/wise:cancel
```

`cancel` 移除所有激活模式的 state 文件：ralph、autopilot、ultrawork 及其他。

---

## 上下文管理 Hooks

Claude Code 的上下文窗口有限。长会话中会发生压缩，之前的对话内容被摘要。WISE 的上下文管理 hook 为压缩做准备、保留重要信息并维护项目级记忆。

### notepad

抗压缩记忆系统。

- **存储路径**：`.wise/notepad.md`
- **MCP 工具**：`notepad_read`、`notepad_write_priority`、`notepad_write_working`、`notepad_write_manual`
- **行为**：写入 notepad 的信息在压缩后仍保留

notepad 支持三个优先级：

| 优先级 | 工具 | 说明 |
|--------|------|------|
| Priority | `notepad_write_priority` | 绝不可丢失的信息 |
| Working | `notepad_write_working` | 当前进行中工作状态 |
| Manual | `notepad_write_manual` | 手动记录的笔记 |

使用 `notepad_prune` 清理旧条目，使用 `notepad_stats` 检查状态。

### project-memory

管理永久项目级记忆。

- **存储路径**：`.wise/project-memory.json`
- **MCP 工具**：`project_memory_read`、`project_memory_write`、`project_memory_add_note`、`project_memory_add_directive`
- **相关 hooks**：
  - `project-memory-session.mjs`（SessionStart）：会话开始时加载项目记忆
  - `project-memory-posttool.mjs`（PostToolUse）：工具使用后更新记忆
  - `project-memory-precompact.mjs`（PreCompact）：压缩前保留记忆
- **多会话契约**：两个写入方在读取或重写 `project-memory.json` 前都获取 `withProjectMemoryLock`（见 `src/lib/file-lock.ts`）。同一 workspace 中的并发会话经此锁串行化，因此并行 Claude 会话间不可能发生丢失更新竞争。回归守卫见 `tests/integration/concurrent-project-memory.test.ts`。

project-memory 中存储两类数据：

- **Notes**：关于项目的习得事实（架构模式、bug 历史等）
- **Directives**：在该项目上工作时须遵守的指令

### pre-compact

在压缩前立即保留重要 state。

- **事件**：PreCompact
- **行为**：摘要并保留当前工作 state、进行中 TODO 与关键上下文
- **目的**：保留关键信息，以便压缩后可恢复工作

### 上下文保留策略

WISE 的上下文管理 hook 按如下策略协作：

```
Session Start
  → Load project-memory
    → [Work in progress]
    → Write important info to notepad
    → Update project-memory
      → [Compaction fires]
      → pre-compact preserves state
      → project-memory preserved
        → [After compaction]
        → Restored via notepad / project-memory
```

---

<a id="magic-keywords"></a>
## 魔法关键词

当在用户自然语言 prompt 中检测到特定词语或模式时，魔法关键词会自动激活 WISE 技能或执行模式。无需斜杠命令 — 在 prompt 中包含关键词即可自动激活功能。

### keyword-detector 如何工作

`keyword-detector.mjs` 在 UserPromptSubmit 事件上运行。

1. 接收用户 prompt 并净化
2. 移除代码块、XML 标签、URL 与文件路径以防误报
3. 对净化后文本匹配关键词模式
4. 解决冲突，然后注入技能调用指令

**安全措施：**

- **净化**：代码块、URL 或文件路径内的关键词被忽略
- **team worker 保护**：设置 `WISE_TEAM_WORKER` 环境变量时禁用（防止无限生成）
- **禁用**：设置 `DISABLE_WISE=1` 或 `WISE_SKIP_HOOKS=keyword-detector`

### 执行模式关键词

这些关键词调用技能并创建 state 文件。

| 关键词 | 技能 | 说明 |
|--------|------|------|
| `cancelwise`, `stopwise` | cancel | 取消所有激活模式 |
| `ralph`, `don't stop`, `must complete`, `until done` | ralph | 持久执行直至验证完成 |
| `autopilot`, `build me`, `I want a`, `handle it all`, `end to end`, `auto-pilot`, `full auto`, `fullsend`, `e2e this` | autopilot | 完全自主执行 |
| `ultrawork`, `ulw`, `uw` | ultrawork | 最大并行执行 |
| `ccg`, `claude-codex-gemini` | ccg | Claude-Codex-Gemini 三模型编排 |
| `ralplan` | ralplan | 基于共识的迭代规划 |
| `deep interview`, `ouroboros` | deep-interview | 苏格拉底式深度访谈 |

### AI Slop 清理关键词

支持两种模式类型：

**显式模式**（自身即激活）：

- `ai-slop`, `anti-slop`, `deslop`, `de-slop`

**组合模式**（当动作关键词与气味关键词组合时激活）：

| 动作关键词 | 气味关键词 |
|-----------|-----------|
| `cleanup`, `refactor`, `simplify`, `dedupe`, `prune` | `slop`, `duplicate`, `dead code`, `unused code`, `over-abstraction`, `wrapper layers`, `needless abstractions`, `ai-generated`, `tech debt` |

示例："cleanup the duplicate code" → 激活 ai-slop-cleaner 技能。

### 智能体快捷关键词

用自然语言而非斜杠命令激活智能体。

| 关键词 | 效果 | 行为 |
|--------|------|------|
| `tdd`, `test first`, `red green` | TDD 模式 | 强制测试先行编写 |
| `code review`, `review code` | 代码审查模式 | 运行全面代码审查 |
| `security review`, `review security` | 安全审查模式 | 运行安全导向审查 |

这些关键词注入内联模式消息，而非调用技能。

### 推理增强关键词

| 关键词 | 效果 |
|--------|------|
| `ultrathink`, `think hard`, `think deeply` | 激活扩展推理模式 |
| `deepsearch`, `search the codebase`, `find in codebase` | 激活面向代码库的搜索模式 |
| `deep-analyze`, `deepanalyze` | 激活深度分析模式 |

### 本地化触发（韩语 / 日语）

`keyword-detector.mjs` 还识别这些关键词的韩语与日语别名（如 `랄프` / `ラルフ` → ralph、`코드 리뷰` / `コード レビュー` → code-review、`딥 분석` / `ディープ アナライズ` → analyze）。由于韩语与日语无 ASCII 词边界，这些别名按子串匹配，因此更长名词短语中的本地化别名仍会路由（如 `コードレビュー記事を要約して` → code-review）。

完整别名表与路由行为细节（reviewer 后缀守卫、信息性抑制，包括 `違いを教えて`/`何が違う` 差异类问题）见[参考.md → 魔法关键词 → 本地化触发](./参考.md#magic-keywords)。

### 优先级与冲突解决

当同时检测到多个关键词时，按以下优先级解决：

```
cancel  (highest priority, exclusive)
  → ralph
    → autopilot
      → ultrawork
        → ccg
          → ralplan
            → deep-interview
              → ai-slop-cleaner
                → tdd
                  → code-review
                    → security-review
                      → ultrathink
                        → deepsearch
                          → analyze
```

`cancel` 是排他的 — 它忽略所有其他匹配，仅运行 cancel 动作。其他所有关键词可被同时匹配，并按优先级顺序处理。

### 使用示例

```bash
# In Claude Code:

# Autonomous execution
autopilot: implement user authentication with OAuth

# Parallel execution
ultrawork write all tests for this module

# Persistent execution
ralph refactor this authentication module

# TDD
implement password validation with tdd

# Code review
code review the recent changes

# Cancel
stopwise
```

### 关于 `team` 关键词的说明

`team` 不被自动检测。必须经 `/team` 斜杠命令显式调用，以防无限生成。

```
/wise:team 3:executor "build a fullstack todo app"
```
