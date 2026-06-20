# 智能体层级参考

这是所有智能体层级信息的唯一真相来源。所有技能文件与文档应引用本文件，而非重复该表。

## 层级矩阵

| 领域 | LOW (Haiku) | MEDIUM (Sonnet) | HIGH (Opus) |
|--------|-------------|-----------------|-------------|
| **分析** | architect-low | architect-medium | architect |
| **实现** | executor-low | executor | executor-high |
| **搜索** | explore | - | explore-high |
| **研究** | - | document-specialist | - |
| **前端** | designer-low | designer | designer-high |
| **文档** | writer | - | - |
| **视觉** | - | vision | - |
| **规划** | - | - | planner |
| **批判** | - | - | critic |
| **预规划** | - | - | analyst |
| **测试** | - | qa-tester | - |
| **安全** | security-reviewer-low | - | security-reviewer |
| **TDD** | test-engineer (model=haiku) | test-engineer | - |
| **代码审查** | - | - | code-reviewer |
| **数据科学** | - | scientist | scientist-high |

## 模型路由指南

| 任务复杂度 | 层级 | 模型 | 何时使用 |
|-----------------|------|-------|-------------|
| 简单 | LOW | haiku | 快速查找、简单修复、「X 返回什么？」 |
| 标准 | MEDIUM | sonnet | 功能实现、标准调试、「添加校验」 |
| 复杂 | HIGH | opus | 架构决策、复杂调试、「重构系统」 |

## 按任务类型选择智能体

| 任务类型 | 最佳智能体 | 层级 |
|-----------|------------|------|
| 快速代码查找 | explore | LOW |
| 查找文件/模式 | explore | LOW |
| 复杂架构搜索 | explore-high | HIGH |
| 简单代码变更 | executor-low | LOW |
| 功能实现 | executor | MEDIUM |
| 复杂重构 | executor-high | HIGH |
| 调试简单问题 | architect-low | LOW |
| 调试复杂问题 | architect | HIGH |
| UI 组件 | designer | MEDIUM |
| 复杂 UI 系统 | designer-high | HIGH |
| 编写文档/注释 | writer | LOW |
| 研究文档/API | document-specialist | MEDIUM |
| 分析图像/图表 | vision | MEDIUM |
| 战略规划 | planner | HIGH |
| 审查/批判计划 | critic | HIGH |
| 预规划分析 | analyst | HIGH |
| 交互式 CLI 测试 | qa-tester | MEDIUM |
| 安全审查 | security-reviewer | HIGH |
| 快速安全扫描 | security-reviewer-low | LOW |
| 修复构建错误 | debugger | MEDIUM |
| 简单构建修复 | debugger (model=haiku) | LOW |
| TDD 工作流 | test-engineer | MEDIUM |
| 快速测试建议 | test-engineer (model=haiku) | LOW |
| 代码审查 | code-reviewer | HIGH |
| 快速代码检查 | code-reviewer (model=haiku) | LOW |
| 数据分析/统计 | scientist | MEDIUM |
| 快速数据检视 | scientist (model=haiku) | LOW |
| 复杂 ML/假设 | scientist-high | HIGH |
| 查找符号引用 | explore-high | HIGH |
| 获取文件/工作区符号大纲 | explore | LOW |
| 结构化代码模式搜索 | explore | LOW |
| 结构化代码转换 | executor-high | HIGH |
| 全项目类型检查 | debugger | MEDIUM |
| 检查单文件错误 | executor-low | LOW |
| 数据分析/计算 | scientist | MEDIUM |
| 复杂自主工作 | executor-high | HIGH |
| 深度目标导向执行 | executor-high | HIGH |

## 用法

委派时，始终显式指定模型：

```
Task(subagent_type="wise:executor",
     model="sonnet",
     prompt="...")
```

为节省 token，任务允许时优先使用更低层级：
- 简单查找与快速修复用 `haiku`
- 标准实现工作用 `sonnet`
- 复杂推理任务保留 `opus`

## MCP 工具与智能体能力

### 工具清单

| 工具 | 类别 | 用途 | 已分配给智能体？ |
|------|----------|---------|---------------------|
| `lsp_hover` | LSP | 获取代码位置处的类型信息与文档 | 否（编排器直接使用） |
| `lsp_goto_definition` | LSP | 跳转到符号定义处 | 否（编排器直接使用） |
| `lsp_find_references` | LSP | 跨代码库查找符号所有用法 | 是（仅 `explore-high`） |
| `lsp_document_symbols` | LSP | 获取文件中所有符号的大纲 | 是 |
| `lsp_workspace_symbols` | LSP | 跨工作区按名称搜索符号 | 是 |
| `lsp_diagnostics` | LSP | 获取文件的错误、警告与提示 | 是 |
| `lsp_diagnostics_directory` | LSP | 项目级类型检查（tsc --noEmit 或 LSP） | 是 |
| `lsp_prepare_rename` | LSP | 检查符号是否可重命名 | 否（编排器直接使用） |
| `lsp_rename` | LSP | 跨整个项目重命名符号 | 否（编排器直接使用） |
| `lsp_code_actions` | LSP | 获取可用重构与快速修复 | 否（编排器直接使用） |
| `lsp_code_action_resolve` | LSP | 获取 code action 的完整编辑详情 | 否（编排器直接使用） |
| `lsp_servers` | LSP | 列出可用语言服务器及安装状态 | 否（编排器直接使用） |
| `ast_grep_search` | AST | 基于 AST 的模式结构化代码搜索 | 是 |
| `ast_grep_replace` | AST | 基于模式的结构化代码转换 | 是（仅 `executor-high`） |
| `python_repl` | Data | 用于数据分析与计算的持久 Python REPL | 是 |

### 智能体工具矩阵（仅 MCP 工具）

| 智能体 | LSP 诊断 | LSP 目录诊断 | LSP 符号 | LSP 引用 | AST 搜索 | AST 替换 | Python REPL |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `explore` | - | - | doc + workspace | - | yes | - | - |
| `explore-high` | - | - | doc + workspace | yes | yes | - | - |
| `architect-low` | yes | - | - | - | - | - | - |
| `architect-medium` | yes | yes | - | - | yes | - | - |
| `architect` | yes | yes | - | - | yes | - | - |
| `executor-low` | yes | - | - | - | - | - | - |
| `executor` | yes | yes | - | - | - | - | - |
| `executor-high` | yes | yes | - | - | yes | yes | - |
| `debugger` | yes | yes | - | - | - | - | - |
| `test-engineer` | yes | - | - | - | - | - | - |
| `code-reviewer` | yes | - | - | - | yes | - | - |
| `qa-tester` | yes | - | - | - | - | - | - |
| `scientist` | - | - | - | - | - | - | yes |
| `scientist-high` | - | - | - | - | - | - | yes |

### 未分配工具（编排器直接使用）

以下 7 个 MCP 工具未分配给任何智能体。需要时直接使用：

| 工具 | 何时直接使用 |
|------|---------------------|
| `lsp_hover` | 对话中快速类型查找 |
| `lsp_goto_definition` | 分析时跳转到符号定义 |
| `lsp_prepare_rename` | 决定方案前检查重命名可行性 |
| `lsp_rename` | 安全重命名操作（返回编辑预览，不自动应用） |
| `lsp_code_actions` | 发现可用重构 |
| `lsp_code_action_resolve` | 获取特定 code action 详情 |
| `lsp_servers` | 检查语言服务器可用性 |

需要实现的复杂重命名或重构任务，委派给 `executor-high`，它可使用 `ast_grep_replace` 进行结构化转换。

### 工具选择指引

- **需要文件符号大纲或工作区搜索？** 经 `explore` 或 `explore-high` 使用 `lsp_document_symbols`/`lsp_workspace_symbols`
- **需要查找符号所有用法？** 经 `explore-high` 使用 `lsp_find_references`（唯一拥有它的智能体）
- **需要结构化代码模式？**（如「查找所有匹配 X 形状的函数」）经 `explore` 系列、`architect`/`architect-medium` 或 `code-reviewer` 使用 `ast_grep_search`
- **需要结构化转换代码？** 经 `executor-high` 使用 `ast_grep_replace`（唯一拥有它的智能体）
- **需要全项目类型检查？** 经 `architect`/`architect-medium`、`executor`/`executor-high` 或 `debugger` 使用 `lsp_diagnostics_directory`
- **需要单文件错误检查？** 经多个智能体使用 `lsp_diagnostics`（见矩阵）
- **需要数据分析/计算？** 经 `scientist` 或 `scientist-high` 使用 `python_repl`
- **需要快速类型信息或定义查找？** 直接使用 `lsp_hover`/`lsp_goto_definition`（编排器直接使用工具）
