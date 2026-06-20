# 功能参考（v3.1 - v3.4）

## 会话 Notepad（短期记忆）

位于 `.wise/notepad.md` 的抗 compaction 记忆系统，分三个层级：

| 节 | 行为 | 用于 |
|---------|----------|---------|
| **Priority Context** | 会话启动时始终加载（最多 500 字符） | 关键事实：「项目使用 pnpm」、「API key 在 .env」 |
| **Working Memory** | 带时间戳的条目，7 天后自动清理 | 调试面包屑、临时发现 |
| **MANUAL** | 从不自动清理 | 团队联系人、部署信息、永久笔记 |

**用户技能：** `/wise:note`
- `/wise:note <content>` - 添加到 Working Memory
- `/wise:note --priority <content>` - 添加到 Priority Context
- `/wise:note --manual <content>` - 添加到 MANUAL 节
- `/wise:note --show` - 显示 notepad 内容

**自动捕获：** Task 智能体输出中的 `<remember>` 标签会自动捕获：
- `<remember>content</remember>` → 带时间戳的 Working Memory
- `<remember priority>content</remember>` → 替换 Priority Context

**API：** `initNotepad()`, `addWorkingMemoryEntry()`, `setPriorityContext()`, `addManualEntry()`, `getPriorityContext()`, `getWorkingMemory()`, `formatNotepadContext()`, `pruneOldEntries()`

## Notepad 智慧系统（按计划范围）

按计划范围捕获学习、决策、问题与难题的智慧。

**位置：** `.wise/notepads/{plan-name}/`

| 文件 | 用途 |
|------|---------|
| `learnings.md` | 技术发现与模式 |
| `decisions.md` | 架构与设计决策 |
| `issues.md` | 已知问题与变通方案 |
| `problems.md` | 阻塞与挑战 |

**API：** `initPlanNotepad()`, `addLearning()`, `addDecision()`, `addIssue()`, `addProblem()`, `getWisdomSummary()`, `readPlanWisdom()`

## 委派类别

将任务语义分类，自动映射到模型层级、temperature 与 thinking 预算。

| 类别 | 层级 | Temperature | Thinking | 用于 |
|----------|------|-------------|----------|---------|
| `visual-engineering` | HIGH | 0.7 | high | UI/UX、前端、设计系统 |
| `ultrabrain` | HIGH | 0.3 | max | 复杂推理、架构、深度调试 |
| `artistry` | MEDIUM | 0.9 | medium | 创意方案、头脑风暴 |
| `quick` | LOW | 0.1 | low | 简单查找、基本操作 |
| `writing` | MEDIUM | 0.5 | medium | 文档、技术写作 |

**自动检测：** 类别从 prompt 关键词自动检测。

## 目录诊断工具

经 `lsp_diagnostics_directory` 工具进行项目级类型检查。

**策略：**
- `auto`（默认）- 自动选择最佳策略，存在 tsconfig.json 时偏好 tsc
- `tsc` - 快速，使用 TypeScript 编译器
- `lsp` - 降级，经 Language Server 逐文件迭代

**用法：** 提交前或重构后检查整个项目的错误。

## 会话恢复

后台智能体可通过 `resume-session` 工具带完整上下文恢复。

## 流水线（v3.4）

带阶段间数据传递的顺序智能体链接。

**内置预设：**
| 预设 | 阶段 |
|--------|--------|
| `review` | explore -> architect -> critic -> executor |
| `implement` | planner -> executor -> test-engineer |
| `debug` | explore -> architect -> debugger |
| `research` | parallel(document-specialist, explore) -> architect -> writer |
| `refactor` | explore -> architect-medium -> executor-high -> qa-tester |
| `security` | explore -> security-reviewer -> executor -> security-reviewer-low |

**自定义流水线：** `/pipeline explore:haiku -> architect:opus -> executor:sonnet`

## 统一取消（v3.4）

自动检测活跃模式的智能取消。

**用法：** `/cancel` 或直接说 "cancelwise"、"stopwise"

自动检测并取消：autopilot、ralph、ultrawork、ultraqa、pipeline
使用 `--force` 或 `--all` 清除所有状态。

## 验证模块（v3.4）

用于工作流的可复用验证协议。

**标准检查：** BUILD, TEST, LINT, FUNCTIONALITY, ARCHITECT, TODO, ERROR_FREE

**证据验证：** 5 分钟新鲜度检测、通过/失败跟踪

## 状态管理（v3.4）

标准化 state 文件位置。

**所有模式 state 文件的标准路径：**
- 主：`.wise/state/{name}.json`（本地，按项目）
- 全局备份：`~/.wise/state/{name}.json`（全局，会话连续性）

**模式 State 文件：**
| 模式 | State 文件 |
|------|-----------|
| ralph | `ralph-state.json` |
| ultragoal | `ultragoal-state.json` |
| autopilot | `autopilot-state.json` |
| ultrawork | `ultrawork-state.json` |
|  | `-state.json` |
| ultraqa | `ultraqa-state.json` |
| pipeline | `pipeline-state.json` |

**重要：** 切勿将 WISE state 存于 `~/.claude/` — 该目录保留给 Claude Code 自身。

Legacy 位置在读取时自动迁移。
