# MCP 工具

> WISE 提供用于 state 管理、代码智能与数据分析的 MCP 工具。

与用户直接调用的技能不同，工具由智能体在任务执行过程中内部使用。

## 工具类别

- [State](#state) — 管理执行模式 state
- [Notepad](#notepad) — 在上下文压缩后存续的持久笔记
- [Project Memory](#project-memory) — 跨会话的长期项目级记忆
- [LSP](#lsp) — 语言服务器协议代码智能（12 个工具）
- [AST Grep](#ast-grep) — 基于 AST 结构的代码搜索与替换
- [Python REPL](#python-repl) — 持久 Python 执行环境
- [Session Search](#session-search) — 搜索历史会话
- [Trace](#trace) — 智能体流程追踪分析
- [Shared Memory](#shared-memory) — 用于团队协调的跨智能体共享内存
- [Skills](#skills) — 内部技能管理工具
- [Deepinit Manifest](#deepinit-manifest) — 增量 AGENTS.md 再生成清单

---

## State

State 工具管理 WISE 执行模式（autopilot、ralph、ultrawork 等）的 state。每个模式在 state 文件中记录其当前进度、激活状态与配置。

### 存储路径

```
.wise/state/
├── sessions/{sessionId}/     # Session-scoped state
│   ├── autopilot-state.json
│   ├── ralph-state.json
│   └── ultrawork-state.json
├── autopilot-state.json      # Legacy fallback
├── ralph-state.json
└── ultrawork-state.json
```

当提供会话 ID 时使用会话作用域路径，否则降级使用 legacy 路径。

### 工具

#### `state_read`

读取指定模式的 state。

```
state_read(mode="ralph")
state_read(mode="ralph", session_id="abc123")
```

若 state 文件不存在则返回空响应。

#### `state_write`

保存指定模式的 state。

```
state_write(mode="ralph", state={
  active: true,
  current_phase: "execution",
  iteration: 3,
  max_iterations: 10
})
```

#### `state_clear`

删除指定模式的 state 文件。

```
state_clear(mode="ralph")
state_clear(mode="ralph", session_id="abc123")
```

不带会话 ID 调用时清除 legacy 文件。

#### `state_list_active`

列出所有当前激活的会话。

```
state_list_active()
```

返回 `.wise/state/sessions/` 下所有会话 ID 及其对应模式。

#### `state_get_status`

返回特定会话的状态摘要。

```
state_get_status(session_id="abc123")
```

包含激活模式名称，以及是否存在依赖模式。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WISE_STATE_DIR` | _(unset)_ | 集中式 state 目录。设置后，即使 worktree 被删除 state 也会保留。 |

当设置 `WISE_STATE_DIR` 时，state 存储于 `$WISE_STATE_DIR/{project-id}/`。

```bash
export WISE_STATE_DIR="$HOME/.claude/wise"
```

### 使用模式

**激活模式：**

```
state_write(mode="autopilot", state={
  active: true,
  current_phase: "expansion",
  started_at: "2024-01-15T09:00:00Z"
})
```

**停用模式：**

```
state_clear(mode="autopilot")
```

**检查激活模式：**

```
state_list_active()
→ [{session_id: "abc123", mode: "ralph", active: true}]
```

---

## Notepad

Notepad 是能在上下文窗口压缩后存续的持久笔记系统。在长会话中，当对话早期的重要信息被挤出上下文时，保存到 Notepad 的笔记会在压缩后被恢复。

### 存储路径

```
.wise/notepad.md
```

### 工具

#### `notepad_read`

读取 notepad 的完整内容。

```
notepad_read()
```

#### `notepad_write_priority`

以最高优先级保存笔记。压缩时优先恢复。

```
notepad_write_priority(content="This project uses TypeScript strict mode")
```

用于架构决策、关键约束以及绝不可遗忘的信息。

#### `notepad_write_working`

保存当前工作上下文。通用笔记。

```
notepad_write_working(content="Currently refactoring auth module, 3/5 files done")
```

用于进度跟踪、后续步骤以及工作中发现的信息。

#### `notepad_write_manual`

手动在指定位置保存笔记。

```
notepad_write_manual(content="Bug: sessionId undefined at session.ts:45")
```

#### `notepad_prune`

清理陈旧或冗余的笔记。

```
notepad_prune()
```

#### `notepad_stats`

返回 notepad 的统计信息（条目数、大小等）。

```
notepad_stats()
```

### 使用模式

**记录重要决策：**

```
notepad_write_priority(content="DB migration: PostgreSQL → MySQL is forbidden. Existing query compatibility issue.")
```

**跟踪工作进度：**

```
notepad_write_working(content="TODO: 1. Fix auth module ✓  2. Add tests  3. Update docs")
```

**恢复会话时重建上下文：**

```
notepad_read()
→ "Currently refactoring auth. src/auth/login.ts done. Next: src/auth/session.ts"
```

### 压缩行为

当 Claude Code 压缩上下文时：

1. Notepad 内容包含在压缩结果中
2. 优先笔记先恢复
3. 工作笔记次之恢复
4. 已清理笔记排除在外

即使在超长会话中核心上下文也被保留。

---

## Project Memory

Project Memory 管理长期项目级记忆。它跨会话持久化项目结构、规则、习得知识与指令，使智能体能快速理解项目上下文。

### 存储路径

```
.wise/project-memory.json
```

### 工具

#### `project_memory_read`

读取 project memory 的完整内容。

```
project_memory_read()
```

返回该项目所有已存储笔记与指令。

#### `project_memory_write`

完全覆写 project memory。

```
project_memory_write(content={
  notes: ["Uses TypeScript strict mode", "Tests use vitest"],
  directives: ["JSDoc required on all functions"]
})
```

> **警告：** 这会完全替换现有内容。如需部分更新，请改用 `project_memory_add_note` 或 `project_memory_add_directive`。

#### `project_memory_add_note`

添加关于项目的笔记。

```
project_memory_add_note(note="src/utils/ should contain pure functions only")
```

用于项目结构、模式与习得知识。

#### `project_memory_add_directive`

添加智能体必须遵守的指令。

```
project_memory_add_directive(directive="Use structured logging instead of console.log")
```

用于编码规则、禁令与要求。

### Notes 与 Directives 对比

| | Notes | Directives |
|---|---|---|
| 性质 | 信息、观察、习得知识 | 规则、约束、要求 |
| 示例 | "本项目使用 monorepo 结构" | "无测试不得提 PR" |
| 智能体行为 | 作为决策参考 | 必须严格遵守 |

### Notepad 与 Project Memory 对比

| | Notepad | Project Memory |
|---|---|---|
| 范围 | 当前会话 | 整个项目（跨会话持久） |
| 用途 | 进行中笔记 | 项目规则、结构、习得知识 |
| 文件 | `.wise/notepad.md` | `.wise/project-memory.json` |
| 压缩 | 压缩时恢复 | 始终可用 |

### 使用模式

**登记项目规则：**

```
project_memory_add_directive("This repo uses conventional commits")
project_memory_add_directive("Files under src/generated/ must not be edited manually")
```

**记录代码库结构：**

```
project_memory_add_note("API layer: src/api/ → src/services/ → src/repositories/")
project_memory_add_note("Auth: JWT + passport.js, implemented in src/auth/")
```

**记录习得知识：**

```
project_memory_add_note("tsconfig paths settings need to be kept in sync with jest.config")
```

---

## LSP

LSP 工具提供基于语言服务器协议的代码智能：类型信息、跳转定义、查找引用、错误诊断、符号搜索与重命名。

须安装语言服务器（如 `typescript-language-server`、`ty`、`rust-analyzer`、`gopls`）。使用 `lsp_servers()` 检查安装状态。

### 工具

#### `lsp_hover`

返回指定位置的类型信息与文档。

```
lsp_hover(file="src/auth.ts", line=42, character=10)
```

#### `lsp_goto_definition`

跳转到符号的定义。

```
lsp_goto_definition(file="src/auth.ts", line=42, character=10)
```

#### `lsp_find_references`

查找符号的所有使用位置。

```
lsp_find_references(file="src/auth.ts", line=42, character=10)
```

#### `lsp_document_symbols`

返回文件的结构大纲（函数、类、接口等）。

```
lsp_document_symbols(file="src/auth.ts")
```

#### `lsp_workspace_symbols`

跨整个工作区搜索符号。

```
lsp_workspace_symbols(query="UserConfig")
```

#### `lsp_diagnostics`

返回文件的错误、警告与提示。

```
lsp_diagnostics(file="src/auth.ts")
```

适合在代码变更后立即检查类型错误。

#### `lsp_diagnostics_directory`

返回整个目录或项目的诊断信息。

```
lsp_diagnostics_directory(path="src/")
```

在复杂多文件变更后用于检查项目级类型错误。

#### `lsp_prepare_rename`

检查指定位置的重命名操作是否合法。

```
lsp_prepare_rename(file="src/auth.ts", line=42, character=10)
```

#### `lsp_rename`

跨整个项目重命名符号。

```
lsp_rename(file="src/auth.ts", line=42, character=10, newName="AuthService")
```

#### `lsp_code_actions`

返回某范围可用的重构操作。

```
lsp_code_actions(file="src/auth.ts", startLine=40, endLine=50)
```

#### `lsp_code_action_resolve`

返回特定 code action 的详细信息。

```
lsp_code_action_resolve(action=<action_object>)
```

#### `lsp_servers`

返回可用语言服务器列表及其安装状态。

```
lsp_servers()
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WISE_LSP_TIMEOUT_MS` | `15000` | LSP 请求超时（毫秒）。大型仓库或慢服务器可适当增大。 |

### 故障排查

| 问题 | 解决方案 |
|------|----------|
| LSP 工具不工作 | 安装语言服务器：`npm install -g typescript-language-server` |
| 超时错误 | 增大 `WISE_LSP_TIMEOUT_MS` |
| 检查服务器状态 | 运行 `lsp_servers()` 验证安装 |

---

## AST Grep

AST Grep 工具使用 [@ast-grep/napi](https://ast-grep.github.io/) 搜索并替换结构化代码模式。因为它基于 AST（抽象语法树）而非正则，所以能精确匹配代码结构。

### 工具

#### `ast_grep_search`

使用 AST 模式搜索代码。

```
ast_grep_search(
  pattern="console.log($$$ARGS)",
  lang="typescript"
)
```

**元变量：**

| 元变量 | 说明 | 示例 |
|---|---|---|
| `$VAR` | 匹配单个 AST 节点 | `$VAR.map($FUNC)` |
| `$$$` | 匹配多个 AST 节点 | `console.log($$$ARGS)` |

**示例：**

```
# Find all console.log calls
ast_grep_search(pattern="console.log($$$)", lang="typescript")

# Find specific fetch call patterns
ast_grep_search(pattern="fetch($URL, { method: 'POST', $$$REST })", lang="typescript")

# Find React useState usage
ast_grep_search(pattern="const [$STATE, $SETTER] = useState($INIT)", lang="tsx")

# Find try-catch blocks
ast_grep_search(pattern="try { $$$ } catch($ERR) { $$$ }", lang="typescript")
```

#### `ast_grep_replace`

使用结构化 AST 模式替换代码。

```
ast_grep_replace(
  pattern="console.log($$$ARGS)",
  replacement="logger.info($$$ARGS)",
  lang="typescript",
  dryRun=true
)
```

> **始终先用 `dryRun=true` 运行，审查变更后再应用。**

**示例：**

```
# Replace console.log with logger.info
ast_grep_replace(
  pattern="console.log($$$ARGS)",
  replacement="logger.info($$$ARGS)",
  lang="typescript",
  dryRun=true
)

# Convert synchronous functions to async
ast_grep_replace(
  pattern="function $NAME($$$PARAMS) { $$$BODY }",
  replacement="async function $NAME($$$PARAMS) { $$$BODY }",
  lang="typescript",
  dryRun=true
)
```

### AST Grep 与正则对比

| | 正则（Grep） | AST Grep |
|---|---|---|
| 匹配对象 | 文本模式 | 代码结构 |
| 空白与换行 | 敏感 | 无关 |
| 注释 | 被匹配 | 被跳过 |
| 重构安全性 | 有风险 | 保结构 |
| 适用场景 | 文本搜索 | 代码转换 |

### 支持语言

TypeScript、JavaScript、TSX、JSX、Python、Go、Rust、Java、C、C++、C#、Ruby、Swift、Kotlin 等大多数主流编程语言。

---

## Python REPL

Python REPL 是一个 Python 执行环境，状态在会话内的调用之间持久保留。用于数据分析、统计计算、可视化与原型设计。

### 工具

#### `python_repl`

执行 Python 代码并返回结果。

```
python_repl(code="import json; data = json.loads('{\"key\": \"value\"}'); print(data)")
```

### 特性

**持久状态：** 在一次调用中定义的变量、函数与导入，在后续调用中仍可用。

```python
# First call
python_repl(code="import pandas as pd; df = pd.read_csv('data.csv')")

# Second call (df is still available)
python_repl(code="print(df.describe())")
```

**数据分析：**

```python
python_repl(code="""
import json
with open('.wise/research/session-1/state.json') as f:
    state = json.load(f)
print(f"Stages: {len(state['stages'])}")
print(f"Status: {state['status']}")
""")
```

**计算与转换：**

```python
python_repl(code="""
# Token cost estimation
input_tokens = 150000
output_tokens = 50000
cost = (input_tokens * 0.003 + output_tokens * 0.015) / 1000
print(f"Estimated cost: ${cost:.4f}")
""")
```

**文件处理：**

```python
python_repl(code="""
import os

# Project file statistics
extensions = {}
for root, dirs, files in os.walk('src'):
    for f in files:
        ext = os.path.splitext(f)[1]
        extensions[ext] = extensions.get(ext, 0) + 1

for ext, count in sorted(extensions.items(), key=lambda x: -x[1]):
    print(f"{ext}: {count} files")
""")
```

### 使用场景

| 使用场景 | 说明 |
|----------|------|
| 数据分析 | 分析 CSV/JSON 文件、计算统计量 |
| 原型设计 | 验证算法、测试逻辑 |
| 文件处理 | 文件转换、批处理 |
| 可视化 | 用 matplotlib 或 plotly 生成图表 |
| 计算 | 数学计算、成本估算 |

### 与 scientist 智能体集成

`scientist` 智能体使用 `python_repl` 完成数据分析任务。

---

## Session Search

搜索历史本地会话历史与 transcript 制品。

### 工具

#### `session_search`

搜索会话历史并返回匹配的摘录。

```
session_search(query="authentication refactor")
```

返回会话 ID、时间戳、来源路径与匹配摘录的结构化 JSON。

---

## Trace

分析智能体流程追踪数据，用于调试与性能分析。

### 工具

#### `trace_timeline`

按时间顺序显示 hook、关键词、技能、智能体与工具。

```
trace_timeline()
```

#### `trace_summary`

聚合 hook 统计、关键词频次、技能激活、模式转换与工具瓶颈。

```
trace_summary()
```

---

## Shared Memory

跨智能体共享内存，用于团队协调。使智能体能在协调工作流中跨团队边界共享数据。

### 工具

#### `shared_memory_write`

向共享内存写入一个值。

```
shared_memory_write(key="auth-spec", value="JWT with refresh tokens")
```

#### `shared_memory_read`

从共享内存读取一个值。

```
shared_memory_read(key="auth-spec")
```

#### `shared_memory_list`

列出共享内存中的所有 key。

```
shared_memory_list()
```

#### `shared_memory_delete`

从共享内存删除一个 key。

```
shared_memory_delete(key="auth-spec")
```

#### `shared_memory_cleanup`

移除共享内存中的所有条目。

```
shared_memory_cleanup()
```

---

## Skills

内部技能管理工具，由运行时用于加载并列举可用技能。

### 工具

#### `load_wise_skills_local`

从本地项目目录（`.wise/skills/`）加载技能。

```
load_wise_skills_local()
```

#### `load_wise_skills_global`

从全局用户目录（`~/.claude/skills/`）加载技能。

```
load_wise_skills_global()
```

#### `list_wise_skills`

列出所有可用 WISE 技能（内置 + 本地 + 全局）。

```
list_wise_skills()
```

---

## Deepinit Manifest

管理增量 AGENTS.md 再生成的清单。通过比对目录文件列表检测结构变更，使 `deepinit` 技能仅对有变更的目录重新生成文档。

### 工具

#### `deepinit_manifest`

通过三种操作管理 deepinit 清单。

**diff** — 查找自上次生成后有结构变更的目录：

```
deepinit_manifest(action="diff")
```

**save** — 将当前目录结构持久化为新基线：

```
deepinit_manifest(action="save")
```

**check** — 验证现有清单：

```
deepinit_manifest(action="check")
```

由 `deepinit` 技能（`/wise:deepinit`）内部使用，以实现增量 AGENTS.md 再生成而非全量重扫。
