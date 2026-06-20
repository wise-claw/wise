# wise 与 Claude Code 集成设计

> 本文描述 WISE 如何通过 Claude Code 官方扩展点（Plugin、Hooks、Skills、MCP、Subagent、CLAUDE.md）实现多智能体编排，以及各子系统在运行时的协作关系。
>
> 相关文档：[架构](../架构.md) · [HOOKS.md](../HOOKS.md) · [参考.md](../参考.md) · [LOCAL_PLUGIN_INSTALL.md](../LOCAL_PLUGIN_INSTALL.md)

## 1. 设计目标与边界

### 1.1 定位

**wise（WISE）** 不是 Claude Code 的替代品，而是在其之上的一层**编排中间件**：

| 层次 | 职责 |
|------|------|
| Claude Code | 会话、工具调用、子 agent（Task）、插件加载、上下文压缩 |
| WISE | 工作流剧本（Skills）、角色定义（Agents）、生命周期拦截（Hooks）、持久状态（`.wise/`）、代码智能工具（MCP） |

WISE 的设计原则是：**尽量使用 Claude Code 原生能力**，只在原生能力不足处（持久循环、关键词路由、跨 compaction 记忆、LSP 工具等）注入逻辑。

### 1.2 非目标

- 不替代 Claude Code 的模型推理或工具执行引擎
- 不直接修改 Claude Code 内部状态（例如 `/goal` 适配器仅渲染 handoff 文本，见 [CLAUDE_CODE_GOAL_ADAPTER.md](./CLAUDE_CODE_GOAL_ADAPTER.md)）
- 不在 Plugin 模式下重复安装已由插件提供的 agents/skills（installer 会检测并跳过）

### 1.3 两条安装/运行路径

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        用户接入 WISE 的两条路径                            │
├──────────────────────────────┬──────────────────────────────────────────┤
│  Plugin 路径（推荐）           │  npm CLI 路径                             │
│  /plugin install             │  npm i -g wise           │
│  + /wise-setup                │  + wise setup                              │
├──────────────────────────────┼──────────────────────────────────────────┤
│  Claude Code 加载插件清单     │  installer 同步到 ~/.claude/              │
│  skills/commands/MCP/hooks   │  hooks、CLAUDE.md、HUD、legacy agents     │
├──────────────────────────────┼──────────────────────────────────────────┤
│  会话内：/autopilot、/team 等  │  终端：wise team、wise ask、wise setup       │
└──────────────────────────────┴──────────────────────────────────────────┘
```

两条路径可共存：Plugin 提供运行时资源；`wise setup` 负责 CLAUDE.md 合并、HUD、以及非 Plugin 场景下的 hooks 同步。

---

## 2. 总体架构

### 2.1 四大系统 + 配置层

```
                    ┌──────────────────────────────────────┐
                    │         CLAUDE.md 编排指令层          │
                    │  委派规则 · 模型路由 · 验证协议 · 状态路径  │
                    └──────────────────┬───────────────────┘
                                       │ 始终注入主会话上下文
┌──────────┐    ┌──────────┐    ┌─────▼─────┐    ┌──────────┐    ┌──────────┐
│ 用户输入  │───▶│  Hooks   │───▶│  Skills   │───▶│  Agents  │───▶│  State   │
│ Prompt   │    │ 生命周期  │    │ 工作流剧本 │    │ 子智能体  │    │ .wise/    │
└──────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘
                     │                                    │
                     │         ┌──────────────────────────┘
                     ▼         ▼
              ┌─────────────────────────┐
              │   MCP Server (bridge)    │
              │ state · notepad · LSP ·  │
              │ ast_grep · trace · wiki  │
              └─────────────────────────┘
```

**数据流（单次请求）**：

1. 用户提交 prompt → `UserPromptSubmit` hook 检测魔法关键词
2. Hook 通过 `<system-reminder>` 注入 skill 调用指令
3. 主会话读取 `CLAUDE.md` + skill 剧本，按阶段委派 `Task(subagent_type="wise:…")`
4. 子 agent 执行；`SubagentStart/Stop` hook 追踪与验证交付物
5. 模式状态写入 `.wise/state/`；关键记忆写入 notepad / project-memory
6. Claude 尝试 `Stop` → `persistent-mode` hook 检查是否允许结束

### 2.2 仓库目录与运行时映射

| 仓库路径 | 运行时角色 |
|----------|-----------|
| `.claude-plugin/plugin.json` | Claude Code 插件清单：skills、commands、MCP |
| `hooks/hooks.json` | Hook 事件注册表（由插件或 installer 合并到 settings） |
| `scripts/*.mjs` | Hook 运行时脚本（跨平台 Node） |
| `src/hooks/` | Hook 逻辑的 TypeScript 实现（build → scripts / bridge） |
| `skills/*/SKILL.md` | 工作流 skill 定义 |
| `agents/*.md` | 子 agent prompt 模板 |
| `commands/` | 斜杠命令（逐步迁移为 plugin-scoped skills） |
| `bridge/mcp-server.cjs` | 独立进程 MCP 服务器 |
| `src/mcp/wise-tools-server.ts` | SDK 内嵌 MCP 工具定义 |
| `docs/CLAUDE.md` | 安装到 `~/.claude/CLAUDE.md` 的编排指令源 |
| `dist/` | TS 编译产物；**改 `src/**/*.ts` 后需 `npm run build`** |

### 2.3 环境变量：`CLAUDE_PLUGIN_ROOT`

插件模式下，Claude Code 设置 `CLAUDE_PLUGIN_ROOT` 指向插件安装目录。所有 hook 命令通过该变量定位脚本：

```json
"command": "node \"$CLAUDE_PLUGIN_ROOT\"/scripts/run.cjs \"$CLAUDE_PLUGIN_ROOT\"/scripts/keyword-detector.mjs"
```

`scripts/run.cjs` 负责：

- 使用 `process.execPath` 跨平台 spawn `.mjs` hook
- 处理插件更新后旧版本路径失效（扫描 cache 目录取最新版本，见 issue #1007）

---

## 3. Plugin 清单与 Claude Code 加载流程

### 3.1 `plugin.json` 结构

```json
{
  "name": "wise",
  "skills": ["./skills/autopilot/", "./skills/ralph/", "..."],
  "mcpServers": "./.mcp.json",
  "commands": "./commands/"
}
```

Claude Code 在启用插件后：

1. 发现并注册 **40+ skills**（用户可通过 `/wise:<name>` 调用）
2. 加载 **commands/** 下的斜杠命令
3. 启动 **MCP 服务器**（`.mcp.json` → `bridge/mcp-server.cjs`）
4. 合并 **hooks**（`hooks/hooks.json` 进入用户 settings 或通过插件 hook 机制加载）

### 3.2 MCP 注册

`.mcp.json`：

```json
{
  "mcpServers": {
    "t": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bridge/mcp-server.cjs"]
    }
  }
}
```

工具在 Claude 侧以 `mcp__t__<tool_name>` 形式暴露（服务器别名为 `t`）。

### 3.3 Installer 与 Plugin 的分工

`src/installer/index.ts` 中 `install()` 根据运行上下文分支：

| 条件 | 行为 |
|------|------|
| `runningAsPlugin` | 跳过 agents/commands 文件复制；插件系统已提供 |
| `pluginProvidesAgentFiles` | 跳过 `~/.claude/agents` 同步，并 prune 重复副本 |
| `pluginDirMode`（`wise --plugin-dir`） | 跳过 skill/agent 同步；开发时插件直接提供 |
| 非 Plugin | 安装 hooks 到 `~/.claude/hooks/`，合并 settings.json |
| 始终（非 project-scoped） | 可安装 HUD statusline、合并 CLAUDE.md |

**配置优先级**（CLAUDE.md）：

```
./.claude/CLAUDE.md（项目）  →  覆盖  →  ~/.claude/CLAUDE.md（全局）
```

合并使用 `<!-- WISE:START -->` / `<!-- WISE:END -->` 标记，支持增量更新而不覆盖用户自定义内容。

---

## 4. CLAUDE.md 编排指令层

### 4.1 作用

`docs/CLAUDE.md` 经 `wise-setup` 合并后，成为主 Claude 会话的**操作系统手册**。它不包含可执行代码，而是约束主会话行为：

- **operating_principles**：证据优先、最轻路径
- **delegation_rules**：何时委派 executor / architect / verifier
- **model_routing**：haiku / sonnet / opus 选型
- **skills**：关键词 → skill 映射、team 显式调用
- **verification**：完成前必须收集 verifier 证据
- **execution_protocols**：广域请求先 explore、并行 `run_in_background`
- **worktree_paths**：`.wise/` 状态路径约定
- **cancellation**：`/wise:cancel` 结束模式

### 4.2 与 Hook 的分工

| 机制 | 触发时机 | 内容性质 |
|------|----------|----------|
| CLAUDE.md | 会话全程 | 静态编排协议、角色目录 |
| Hooks | 特定生命周期事件 | 动态上下文、模式激活、继续执行 |

两者互补：CLAUDE.md 告诉主会话「应该怎么编排」；Hook 在关键时刻注入「现在必须做什么」（例如 `[MAGIC KEYWORD: ralph]` 或 `The boulder never stops`）。

---

## 5. Hooks 系统（核心集成机制）

### 5.1 设计模型

Claude Code 在 11 个生命周期事件上允许注册 shell/node 命令。Hook 脚本：

1. 从 **stdin** 读取 JSON 事件载荷
2. 执行业务逻辑（纯 `.mjs` 或通过 `src/hooks/bridge.ts` 的 `processHook()`）
3. 向 **stdout** 输出 JSON，Claude Code 将 `additionalContext` 包装为 `<system-reminder>` 注入上下文

**输出契约示例**：

```xml
<system-reminder>
hook success: Success
</system-reminder>
```

| 注入模式 | 含义 |
|----------|------|
| `hook success: Success` | Hook 正常，继续 |
| `[MAGIC KEYWORD: ralph]` | 检测到关键词，调用对应 skill |
| `The boulder never stops` | 持久模式激活，禁止过早停止 |
| `hook additional context: ...` | 附加上下文 |

### 5.2 完整事件映射

`hooks/hooks.json` 注册的 WISE hook：

| 事件 | 脚本 | 职责 |
|------|------|------|
| **UserPromptSubmit** | `keyword-detector.mjs` | 魔法关键词检测、模式激活、skill 状态写入 |
| | `skill-injector.mjs` | 注入 skill 相关提示 |
| **SessionStart** | `session-start.mjs` | 恢复持久模式状态、会话标记、死会话清理 |
| | `project-memory-session.mjs` | 加载项目记忆 |
| | `wiki-session-start.mjs` | Wiki 会话初始化 |
| | `setup-init.mjs`（matcher: `init`） | 首次安装向导 |
| | `setup-maintenance.mjs`（matcher: `maintenance`） | 维护任务 |
| **PreToolUse** | `pre-tool-enforcer.mjs` | 委派约束、前置规则、orchestrator 逻辑 |
| **PermissionRequest** | `permission-handler.mjs`（matcher: Bash） | Bash 权限处理 |
| **PostToolUse** | `post-tool-verifier.mjs` | 工具结果校验 |
| | `project-memory-posttool.mjs` | 从工具结果提取项目知识 |
| | `post-tool-rules-injector.mjs` | 规则文件注入 |
| **PostToolUseFailure** | `post-tool-use-failure.mjs` | 失败恢复 |
| **SubagentStart** | `subagent-tracker.mjs start` | 子 agent 启动追踪 |
| **SubagentStop** | `subagent-tracker.mjs stop` | 子 agent 完成追踪 |
| | `verify-deliverables.mjs` | 交付物验证 |
| **PreCompact** | `pre-compact.mjs` | 压缩前保存 notepad |
| | `project-memory-precompact.mjs` | 压缩前保存项目记忆 |
| | `wiki-pre-compact.mjs` | Wiki 压缩前处理 |
| **Stop** | `context-guard-stop.mjs` | 上下文用量告警 |
| | `persistent-mode.mjs` | **持久模式继续执行**（ralph/ultrawork/autopilot 等） |
| | `code-simplifier.mjs` | 可选：停止时简化已修改文件 |
| **SessionEnd** | `session-end.mjs` | 会话清理 |
| | `wiki-session-end.mjs` | Wiki 会话结束 |

### 5.3 TypeScript Bridge

复杂逻辑集中在 `src/hooks/bridge.ts` 的 `processHook()`：

- **keyword-detector**：`getAllKeywordsWithSizeCheck`、`applyRalplanGate`、非拉丁字符消毒
- **wise-orchestrator**：`processOrchestratorPreTool` / `PostTool`
- **skill-state**：`writeSkillActiveState`、`upsertWorkflowSkillSlot`、workflow tombstone
- **subagent-tracker**：`getAgentDashboard`、session replay
- **prompt-prerequisites**：阻止未完成前置条件的工具调用

`.mjs` 脚本为薄包装层，保证 Windows/macOS/Linux 一致；`scripts/run.cjs` 解决路径与 Node 版本问题。

### 5.4 关键词检测（keyword-detector）

**优先级顺序**（节选）：

1. `cancelwise` / `stopwise` → 取消活动模式
2. `ralph` → 持久循环直到验证完成
3. `autopilot` → 全自动流水线
4. `ultrawork` / `ulw` → 最大并行
5. `ccg` → Claude-Codex-Gemini 三模型
6. `ralplan` → 共识规划
7. `deep interview` → 苏格拉底式访谈
8. `tdd`、code review、security review、ultrathink、deepsearch、analyze 等

**两个配置源**：

| 来源 | 可定制 |
|------|--------|
| `config.jsonc` 的 `magicKeywords` | ultrawork、search、analyze、ultrathink 四类 |
| `keyword-detector` hook 硬编码 | autopilot、ralph、ccg 等核心触发器 |

`team` **不会**被关键词自动触发，必须显式 `/team`（避免误启动多 agent 编排）。

### 5.5 持久模式（persistent-mode）与 Stop Hook

**软 enforcement 设计**（`src/hooks/AGENTS.md`）：

```typescript
// Stop hook 始终 continue: true
// 通过 message 注入继续执行，而非硬阻塞
return { continue: true, message: result.message };
```

**原因**：硬阻塞（`continue: false`）会阻止上下文压缩，可能导致死锁。

**绕过条件**（允许停止）：

1. `context-limit` — 上下文耗尽，必须允许 compaction
2. `user-abort` — 用户显式停止

**模式优先级**（可能注入继续消息）：

1. Ralph → 2. Autopilot → 3. Ultrapilot → 4. Swarm → 5. Pipeline → 6. UltraQA → 7. Ultrawork

**会话隔离**：仅对匹配 `session_id` 的状态 enforcement；超过 2 小时的 stale 状态忽略。

### 5.6 SessionStart 状态恢复

`session-start.mjs` 在会话开始时：

- 读取 `.wise/state/*.json` 与各模式的 `skill-active-state.json`
- 检查 workflow slot tombstone（24h TTL），避免已完成模式被错误恢复
- 写入 `session-started` 标记，支持 PID 感知的多会话 liveness
- 向上下文注入恢复消息（例如「ralph 模式仍活跃，继续执行」）

### 5.7 关闭 Hook

```bash
export DISABLE_WISE=1              # 关闭全部 WISE hooks
export WISE_SKIP_HOOKS="keyword-detector,persistent-mode"  # 跳过指定 hook
```

---

## 6. Skills 系统

### 6.1 本质

Skill 是带 YAML frontmatter 的 Markdown 文件（`skills/<name>/SKILL.md`），**不是可执行程序**，而是给主会话的结构化工作流说明书。

```markdown
---
name: autopilot
description: Full autonomous execution from idea to working code
level: 4
---
```

### 6.2 调用方式

| 方式 | 示例 |
|------|------|
| 显式斜杠 | `/wise:autopilot build REST API` |
| 魔法关键词 | `autopilot build me a todo app`（由 hook 触发） |
| Skill 管道 | frontmatter 中 `pipeline` / `next-skill` 定义 handoff |

### 6.3 Skill 分层模型

```
┌─────────────────────────────────────────┐
│  GUARANTEE 层（可选）                      │
│  ralph: 验证完成前不可停止                  │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  ENHANCEMENT 层（0-N）                    │
│  ultrawork · git-master · frontend-ui   │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  EXECUTION 层（主 skill）                  │
│  autopilot · team · plan · default      │
└─────────────────────────────────────────┘
```

公式：`[Execution] + [0-N Enhancements] + [Optional Guarantee]`

### 6.4 核心工作流 Skill 阶段

#### autopilot（6 阶段）

| 阶段 | 内容 | 产出 |
|------|------|------|
| Phase 0 | 需求扩展（analyst + architect） | `.wise/autopilot/spec.md` |
| Phase 1 | 规划 + critic 校验 | `.wise/plans/autopilot-impl.md` |
| Phase 2 | ralph + ultrawork 并行实现 | 代码变更 |
| Phase 3 | ultraqa 测试循环（最多 5 轮） | 通过测试 |
| Phase 4 | architect + security-reviewer + code-reviewer 并行审查 | 全部 approve |
| Phase 5 | 清理状态文件 | — |

若已有 `ralplan-*.md` 共识计划，跳过 Phase 0/1。

#### ralph（持久循环）

- 默认 **PRD 模式**：`.wise/state/sessions/{sessionId}/prd.json` 跟踪 user stories
- 每轮迭代直到所有 story `passes: true` 且 reviewer 验证
- 与 ultrawork 组合：并行执行 + 持久不停止
- 完成条件由 verifier/architect/critic/codex（`--critic=`）审查

#### team（Claude Code 原生 Team）

五阶段 pipeline：

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

使用 Claude Code 原生 API：

- `TeamCreate` / `TeamDelete`
- `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`
- `SendMessage`（队友间通信）
- `Task(team_name=..., name=worker-N)` 生成队友

可选 `ralph` 修饰符：在 team pipeline 外包一层持久循环。

#### ultrawork

- 最大并行：独立任务同时 `Task(...)` 派发
- `run_in_background: true` 用于长时构建/测试
- 常与 ralph 组合

#### ralplan

- Planner + Architect + Critic 迭代直到共识
- 产出 `.wise/plans/ralplan-*.md` 或 `consensus-*.md`
- autopilot Phase 0/1 可跳过

### 6.5 Skill 状态机

`src/hooks/skill-state/` 维护 `skill-active-state.json`：

- `active_skills` 槽位跟踪当前工作流
- `completed_at` + tombstone 防止 SessionStart 错误恢复已完成模式
- 与 `.wise/state/<mode>-state.json` 协同

---

## 7. Agents 系统

### 7.1 定义与调用

Agent prompt 位于 `agents/*.md`，带 frontmatter：

```yaml
name: executor
model: sonnet
level: 2
```

主会话或 skill 通过 Claude Code **Task 工具**派发：

```typescript
Task(
  subagent_type="wise:executor",
  model="sonnet",
  prompt="..."
)
```

前缀 `wise:` 由插件注册，将子 agent 与 WISE prompt 绑定。

### 7.2 四条 Lane

| Lane | 代表 Agent | 默认模型 | 职责 |
|------|-----------|----------|------|
| Build/Analysis | explore, analyst, planner, architect, debugger, executor, verifier, tracer | haiku~opus | 发现→分析→规划→实现→验证 |
| Review | security-reviewer, code-reviewer | sonnet/opus | 安全与质量门禁 |
| Domain | test-engineer, designer, writer, qa-tester, scientist, git-master, document-specialist, code-simplifier | 各异 | 领域专家 |
| Coordination | critic | opus | 挑战计划/设计中的漏洞 |

### 7.3 模型三层

| Tier | 模型 | 典型 Agent |
|------|------|-----------|
| LOW | haiku | explore, writer |
| MEDIUM | sonnet | executor, debugger, test-engineer |
| HIGH | opus | architect, planner, critic, code-reviewer |

详见 [TIERED_AGENTS_V2.md](./TIERED_AGENTS_V2.md)。

### 7.4 典型工作流链

```
explore → analyst → planner → critic → executor → verifier
```

### 7.5 子 Agent 追踪

`subagent-tracker` hook 在 `SubagentStart/Stop` 时：

- 记录活跃子 agent 仪表板（HUD 可展示）
- `verify-deliverables.mjs` 在 Stop 时检查交付物
- Session replay 支持事后 trace

---

## 8. MCP 工具服务器

### 8.1 双实现

| 实现 | 路径 | 使用场景 |
|------|------|----------|
| 独立进程 | `bridge/mcp-server.cjs` | Plugin `.mcp.json` 启动，主会话可用 |
| SDK 内嵌 | `src/mcp/wise-tools-server.ts` | `createSdkMcpServer`，子 agent 进程内 |

工具名格式：`mcp__t__<tool_name>`（服务器别名 `t`）。

### 8.2 工具分类

`src/mcp/wise-tools-server.ts` 聚合：

| 分类 | 工具示例 | 环境变量禁用组 |
|------|----------|----------------|
| LSP（12） | `lsp_diagnostics`, `lsp_hover`, `lsp_find_references`… | `WISE_DISABLE_TOOLS=lsp` |
| AST（2） | `ast_grep_search`, `ast_grep_replace` | `ast` |
| Python | `python_repl` | `python` |
| State | `state_read`, `state_write`, `state_clear`… | `state` |
| Notepad | `notepad_read`, `notepad_write_priority`… | `notepad` |
| Memory | `project_memory_read`, `project_memory_add_note`… | `memory` |
| Trace | `trace_timeline`, `trace_summary` | `trace` |
| Skills | skill 管理工具 | `skills` |
| Wiki | wiki 相关 | `wiki` |
| Deepinit | `deepinit_manifest` | `deepinit` |
| Shared Memory | 跨会话共享记忆 | `shared-memory` |
| Interop | 跨工具任务信封（需 `WISE_INTEROP_TOOLS_ENABLED=1`） | `interop` |

### 8.3 State 工具与模式生命周期

各执行模式（ralph、autopilot、team、ultrawork 等）在启动/阶段切换/完成时调用：

```
state_write(mode="ralph", active=true, current_phase="executing", ...)
state_write(mode="ralph", active=false, completed_at=...)
state_clear(mode="ralph")
```

这使 Hook 与 Skill 能跨 compaction 读取一致状态。

---

## 9. 状态管理与持久化

### 9.1 `.wise/` 目录结构

```
.wise/
├── state/
│   ├── ralph-state.json
│   ├── autopilot-state.json
│   ├── team/
│   ├── interop/              # 跨工具任务/消息信封
│   └── sessions/{sessionId}/ # 会话隔离状态
├── notepad.md                # 抗 compaction 备忘录
├── project-memory.json       # 跨会话项目知识
├── plans/                    # 计划、PRD、共识文档
├── notepads/{plan-name}/     # 每计划知识捕获
├── autopilot/spec.md
├── research/
└── logs/
```

### 9.2 状态根解析顺序

`getWiseRoot()` / `resolveWiseStateRoot()`：

1. `WISE_STATE_DIR` — 中心化存储（`~/.claude/wise/{project-id}/`）
2. `.wise-workspace` 标记 — 多 repo 共享父目录
3. `git rev-parse --show-toplevel` — 单 repo 根
4. `process.cwd()` — 回退

`WISE_DISABLE_MULTIREPO=1` 禁用 workspace 标记解析。

### 9.3 控制面 vs 数据面

| 平面 | 路径 | 内容 |
|------|------|------|
| 控制面 | `.wise/state/**` | 队列、worker 分配、会话状态、interop 元数据 |
| 数据面 | `.wise/plans/`, `notepads/`, `prompts/`, `interop/artifacts/` | 大体积 durable 制品 |

大 payload 使用 **descriptor**（`kind`, `path`, `contentHash`, `producer`…）引用，避免撑爆控制面 JSON。

### 9.4 Notepad 与 Project Memory 生命周期

| 事件 | Notepad | Project Memory |
|------|---------|----------------|
| PreCompact | 保存关键上下文 | 持久化 |
| SessionStart | 重新注入 | 加载并注入 |
| PostToolUse | — | 从工具结果提取知识 |

---

## 10. 端到端场景 walkthrough

### 10.1 场景 A：自然语言触发 autopilot

```
用户: "autopilot build me a REST API for tasks"
  │
  ├─ UserPromptSubmit → keyword-detector
  │     └─ 检测 "autopilot" → 写入 autopilot-state.json
  │     └─ 注入 [MAGIC KEYWORD: autopilot]
  │
  ├─ 主会话调用 /wise:autopilot
  │     ├─ Phase 0: Task(analyst) + Task(architect) → spec.md
  │     ├─ Phase 1: Task(planner) + Task(critic) → impl plan
  │     ├─ Phase 2: 并行 Task(executor) + state_write(ralph/ultrawork)
  │     ├─ Phase 3: ultraqa 循环
  │     └─ Phase 4: 并行 reviewer agents
  │
  ├─ Stop → persistent-mode
  │     └─ active=true → 注入 "继续执行 Phase N"
  │
  └─ 全部完成 → state_clear → /cancel → SessionEnd 清理
```

### 10.2 场景 B：显式 team 编排

```
用户: /team 3:executor "fix all TypeScript errors"
  │
  ├─ keyword-detector: team 不自动触发（需显式 /team）
  │
  ├─ team skill 启动五阶段 pipeline
  │     ├─ team-plan: explore/architect 分解任务
  │     ├─ team-prd: 验收标准
  │     ├─ team-exec: TeamCreate + TaskCreate×N + Task(worker)×3
  │     ├─ team-verify: verifier 检查
  │     └─ team-fix: 失败则循环
  │
  └─ SubagentStart/Stop hooks 追踪 worker 进度
```

### 10.3 场景 C：上下文压缩

```
上下文接近上限
  │
  ├─ PreCompact → pre-compact.mjs + project-memory-precompact.mjs
  │     └─ 关键信息写入 notepad.md / project-memory.json
  │
  ├─ Claude Code 执行 compaction
  │
  └─ 后续回合从 notepad / SessionStart 恢复上下文
```

---

## 11. CLI 与 In-Session 双表面

| 能力 | In-Session（Plugin） | Terminal CLI（`wise`） |
|------|---------------------|----------------------|
| Setup | `/setup`, `/wise-setup` | `wise setup` |
| autopilot / ralph / ultrawork | `/autopilot` 等 skill | 无 |
| team | `/team`（Claude 原生 team） | `wise team`（tmux 多 pane：claude/codex/gemini） |
| ask 多模型 | `/ask codex "..."` | `wise ask codex "..."` |
| 诊断 | `/wise-doctor` | `wise doctor` |
| HUD | `/hud` | `wise hud` |

**重要区别**：`wise team` 与 `/team` 是**不同运行时**——前者在终端起 tmux worker；后者使用 Claude Code 会话内原生 Team API。

---

## 12. 构建与本地开发

### 12.1 构建管线

```bash
npm run build
# tsc → build-skill-bridge → build-mcp-server → build-bridge-entry
# → compose-docs → build-runtime-cli → build-team-server → build-cli
```

- **`src/**/*.ts`** → 编译到 `dist/`，Plugin 加载 `dist/` 而非 `src/`
- **`.mjs` / `.md`** → 直接从磁盘加载，无需 build

### 12.2 本地 Plugin 开发

```bash
claude plugin marketplace add /path/to/wise
claude plugin install wise@wise
npm run build   # TS 变更后
claude plugin marketplace update wise
claude plugin update wise@wise
/setup          # 刷新 CLAUDE.md
```

或使用 `--plugin-dir` 免 cache 热加载（见 [LOCAL_PLUGIN_INSTALL.md](../LOCAL_PLUGIN_INSTALL.md)）。

### 12.3 `wise setup` 的 plugin-dir 模式

```bash
wise setup --plugin-dir-mode
# 或 export WISE_PLUGIN_ROOT（由 wise --plugin-dir 设置）
```

跳过 agent/skill 重复同步，避免与插件运行时冲突。

---

## 13. 配置与 Kill Switch

### 13.1 配置文件

| 文件 | 作用 |
|------|------|
| `~/.claude/settings.json` | hooks 合并、enabledPlugins、HUD |
| `~/.config/claude-wise/config.jsonc` | 全局 WISE 配置 |
| `./.claude/wise.jsonc` | 项目级覆盖（优先级更高） |
| `./.claude/CLAUDE.md` | 项目级编排指令 |

### 13.2 关键环境变量

| 变量 | 作用 |
|------|------|
| `DISABLE_WISE` | 禁用全部 hooks |
| `WISE_SKIP_HOOKS` | 逗号分隔跳过指定 hook |
| `WISE_STATE_DIR` | 中心化状态目录 |
| `WISE_DISABLE_TOOLS` | 禁用 MCP 工具组 |
| `WISE_SECURITY=strict` | persistent-mode 硬上限迭代（默认 200） |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | 启用 Claude Code 原生 team（team skill 需要） |

---

## 14. 设计约束与已知边界

### 14.1 单会话 Loop Authority

同一时刻只能有一个**主循环权威**（ralph、team、autopilot、ultraqa、Claude `/goal` 等）。冲突时采用确定性策略：`refuse` | `adopt_existing` | `artifact_only`（见 [CLAUDE_CODE_GOAL_ADAPTER.md](./CLAUDE_CODE_GOAL_ADAPTER.md)）。

### 14.2 Stop Hook 软 enforcement

持久模式通过消息注入继续执行，不硬阻塞 Stop。用户仍可通过 `/cancel` 或 `user-abort` 退出。

### 14.3 Plugin Cache 与版本

Marketplace 安装会 cache 到 `~/.claude/plugins/cache/`；本地开发需 `marketplace update` + `plugin update`。`run.cjs` 处理 `CLAUDE_PLUGIN_ROOT` 指向已删除旧版本的路径。

### 14.4 平台要求

- Node.js ≥ 20（hooks 与 MCP）
- Claude Code 已安装并启用 WISE 插件
- Team 模式需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

---

## 15. 扩展指南（贡献者）

### 15.1 新增 Skill

1. 创建 `skills/new-skill/SKILL.md`（frontmatter + 工作流）
2. 注册到 `.claude-plugin/plugin.json` 的 `skills` 数组
3. 若需关键词触发：扩展 `scripts/keyword-detector.mjs` 或 `src/hooks/keyword-detector/`
4. 若需持久模式：添加 `.wise/state/new-skill-state.json` 约定 + `persistent-mode.mjs` 分支
5. 更新 `docs/参考.md`

### 15.2 新增 Hook

1. 实现 `scripts/new-hook.mjs`（或 `src/hooks/new-hook/` + bridge 路由）
2. 注册到 `hooks/hooks.json`
3. installer 在非 Plugin 模式下同步到 `~/.claude/hooks/`
4. 文档写入 `docs/HOOKS.md`

### 15.3 新增 Agent

1. 创建 `agents/new-agent.md`
2. 更新 `src/agents/definitions.ts`（若 SDK 路径需要）
3. 更新 `docs/参考.md` Agents 节

### 15.4 新增 MCP 工具

1. 在 `src/tools/` 定义工具 + Zod schema
2. 注册到 `src/tools/index.ts` 和 `src/mcp/wise-tools-server.ts`
3. `npm run build` 重建 `bridge/mcp-server.cjs`

---

## 16. 相关文档索引

| 文档 | 内容 |
|------|------|
| [架构](../架构.md) | 面向用户的架构概览 |
| [HOOKS.md](../HOOKS.md) | Hook 事件与禁用方式 |
| [参考.md](../参考.md) | 完整 API、agents、skills 列表 |
| [FEATURES.md](../FEATURES.md) | 内部特性开发者参考 |
| [TIERED_AGENTS_V2.md](./TIERED_AGENTS_V2.md) | 分层 agent 与模型路由设计 |
| [CLAUDE_CODE_GOAL_ADAPTER.md](./CLAUDE_CODE_GOAL_ADAPTER.md) | `/goal` 适配器契约 |
| [SYNC-SYSTEM.md](../SYNC-SYSTEM.md) | 状态同步 |
| [DELEGATION-ENFORCER.md](../DELEGATION-ENFORCER.md) | 委派强制协议 |
| [LOCAL_PLUGIN_INSTALL.md](../LOCAL_PLUGIN_INSTALL.md) | 本地插件开发 |
| [TEAM-WORKTREE-MODE.md](../TEAM-WORKTREE-MODE.md) | Team worktree 模式 |

---

## 附录 A：Hook 脚本 → TypeScript 模块映射（节选）

| 脚本 | TS 模块 |
|------|---------|
| `keyword-detector.mjs` | `src/hooks/keyword-detector/`, `src/hooks/bridge.ts` |
| `persistent-mode.mjs` | `src/hooks/persistent-mode/` |
| `session-start.mjs` | `src/hooks/session-end/`, skill-state |
| `pre-tool-enforcer.mjs` | `src/hooks/wise-orchestrator/` |
| `subagent-tracker.mjs` | `src/hooks/subagent-tracker/` |
| `pre-compact.mjs` | `src/hooks/pre-compact/`, `src/hooks/notepad/` |

## 附录 B：模式状态文件一览

| 模式 | 状态文件 |
|------|----------|
| ralph | `.wise/state/ralph-state.json` |
| autopilot | `.wise/state/autopilot-state.json` |
| ultrawork | `.wise/state/ultrawork-state.json` |
| ultraqa | `.wise/state/ultraqa-state.json` |
| team | `.wise/state/team/` |
| 全局 skill 槽 | `.wise/state/skill-active-state.json` 或 `sessions/{id}/skill-active-state.json` |
