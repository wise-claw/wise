# 模式选择指南

## 快速决策

| 如果你想要...                                                         | 使用此模式                     | 关键词                                          |
| --------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| 先澄清模糊需求                                                        | `deep-interview`               | "deep interview", "ouroboros", "don't assume"  |
| 从想法到完整自主构建                                                   | `autopilot`                    | "autopilot", "build me", "I want a"            |
| 并行自主（快 3-5 倍）                                                  | `team`（替代 `ultrapilot`）    | `/team N:executor "task"`                      |
| 持久化直至验证完成                                                     | `ralph`                        | "ralph", "don't stop"                          |
| 并行执行，人工监督                                                     | `ultrawork`                    | "ulw", "ultrawork"                             |
| 高性价比执行                                                           | `` （修饰器）                  | "eco", "budget"                                |
| 许多相似的独立任务                                                     | `team`（替代 `swarm`）         | `/team N:executor "task"`                      |
| 单一完成条件下的 Claude Code 原生跨轮循环                              | Claude Code `/goal`            | `/goal "condition with proof"`                 |
| 不启动另一循环的持久目标账本                                           | 仅制品 Ultragoal               | 仅写入目标制品/checkpoint/证据                 |

> **说明：** `ultrapilot` 与 `swarm` **已弃用** — 它们现在路由到 `team` 模式。

## 如果你感到困惑或不确定

**不知道自己不知道什么？** 从 `/deep-interview` 开始 — 它用苏格拉底式提问澄清模糊想法、暴露隐藏假设，并在编写任何代码前度量清晰度。

**已有清晰想法？** 从 `autopilot` 开始 — 它处理大多数场景并自动切换到其他模式。

## 详细决策流程图

```
对需求不确定或有模糊想法?
├── 是: 执行前用 deep-interview 澄清
└── 否: 继续下方

需要自主执行?
├── 是: 任务能否拆分为 3+ 个独立组件?
│   ├── 是: team N:executor（带文件所有权的并行自主）
│   └── 否: autopilot（带 ralph 阶段的顺序执行）
└── 否: 需要带人工监督的并行执行?
    ├── 是: 需要成本优化吗?
    │   ├── 是: eco + ultrawork
    │   └── 否: 单独 ultrawork
    └── 否: 需要持久化直至验证完成?
        ├── 是: ralph（持久化 + ultrawork + 验证）
        └── 否: 标准编排（直接委派给智能体）

有许多相似的独立任务（如「修复 47 个错误」）?
└── 是: team N:executor（N 个智能体从任务池领取）

已有一个可度量的完成条件，且想让 Claude Code 保持会话推进?
└── 是: Claude Code /goal，除非 Ralph/Team/UltraQA/autopilot 已拥有该循环

需要持久跟踪但尚无活跃执行循环?
└── 是: 仅制品 Ultragoal 账本/checkpoint/证据
```

## 目标导向工作流选择

Claude Code `/goal`、Ralph、Team、UltraQA 与仅制品 Ultragoal 都有助于「持续直至完成」类工作，但它们拥有工作流的不同部分。为会话选择一个主循环权威；不要同时运行相互竞争的持久化循环。

| 工作流                  | 主要权威                               | 最适用场景                                                                              | 证据与完成规则                                                                               | 避免当                                                                                     |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Claude Code `/goal`     | Claude Code 原生目标循环               | 一个活跃会话需要可度量的完成条件与跨轮持久化                                            | 在对话中呈现证据，再由 `/goal` 评估器判断所陈述的条件                                        | Ralph、Team、UltraQA、autopilot 或其他 Stop-hook 循环已在驱动续跑                          |
| Ralph                   | WISE 持久化循环                        | 单一 owner 实现必须完成所有 PRD story 并通过 reviewer 验证                              | 新鲜的测试/build/lint 加按 PRD 标准的 reviewer 批准                                          | 工作应先拆分给多个 owner                                                                   |
| Team                    | WISE 协调 team 流水线                  | 带显式任务所有权与分阶段验证的并行工作                                                  | 任务结果、worker commit、team 验证/修复循环证据                                             | 一人能比协调开销更快完成时                                                                 |
| UltraQA                 | WISE QA 循环                           | 重复 test/build/lint/typecheck 失败直至质量门通过                                       | 每轮所选 QA 目标的命令输出                                                                   | 需求或实现范围尚未定义时                                                                   |
| 仅制品 Ultragoal        | 持久目标制品，无活跃循环               | 运行时循环不可用或不安全时的规划、handoff 或审计轨迹                                    | 目标账本、checkpoint、handoff prompt 与附加证据                                             | 用户期望自动执行却未选择 Ralph/Team/`/goal` 时                                             |

### Claude Code `/goal` 来源边界

WISE 文档将 `/goal` 事实视为 Claude Code 事实。文档化其行为时仅引用 Claude Code 或 Anthropic 来源：[Claude Code `/goal` 文档](https://code.claude.com/docs/en/goal)与 [Anthropic Claude Code changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)。不得以 OpenAI/Codex 文档作为 `/goal` 的权威。

重要限制：`/goal` 评估器从 Claude Code 对话中呈现的证据作出判断。WISE 文档与 handoff 不得声称评估器独立运行 shell 命令、读取文件或检查隐藏仓库状态。若测试、diff 或日志相关，请通过正常 WISE/Claude Code 工具运行，并在依赖 `/goal` 状态前将结果纳入可见证据。

### 冲突策略

文档化或实现循环冲突处理时，使用确定性策略名 `refuse`、`adopt_existing` 与 `artifact_only`。

当类目标请求进入 WISE 会话时：

1. 若 Ralph、Team、UltraQA、autopilot 或 Stop-hook 循环已活跃，保留该 WISE 循环为权威，仅将 `/goal` 用作文档化的 handoff 选项。
2. 若 Claude Code `/goal` 已活跃，要么显式采纳该现有目标，要么拒绝启动竞争的 WISE 循环，要么降级为仅制品 Ultragoal 文档。
3. 若 hooks、工作区信任或托管设置使 `/goal` 不可用，改用 Ralph/Team/UltraQA 或仅制品 Ultragoal，而非假装 `/goal` 处于活跃。
4. 声明持久 WISE 完成前，始终附加命令/测试/审查证据。`/goal` 评估器成功本身不是 WISE 最终审查门控。

## 示例

| 用户请求                                | 最佳模式        | 原因                           |
| --------------------------------------- | --------------- | ------------------------------- |
| 「帮我构建一个 REST API」               | autopilot       | 单一连贯交付物                 |
| 「构建前端、后端和数据库」              | team 3:executor | 清晰的组件边界                 |
| 「修复全部 47 个 TypeScript 错误」      | team 5:executor | 许多独立相似任务               |
| 「彻底重构认证模块」                    | ralph           | 需要持久化 + 验证              |
| 「快速并行执行」                        | ultrawork       | 偏好人工监督                   |
| 「修复错误时节省 token」                | + ultrawork     | 成本敏感的并行                 |
| 「完成前不要停」                        | ralph           | 检测到持久化关键词             |

## 模式类型

### 独立模式

这些独立运行：

- **autopilot**：自主端到端执行
- **team**：带协调智能体的规范编排（替代 `ultrapilot` 与 `swarm`）

> **已弃用：** `ultrapilot` 与 `swarm` 现路由到 `team` 模式。

### 包装器模式

这些包装其他模式：

- **ralph**：在 ultrawork 外加持久化 + 验证

### 组件模式

这些被其他模式使用：

- **ultrawork**：并行执行引擎（由 ralph、autopilot 使用）

### 修饰器模式

这些修改其他模式的工作方式：

- \*\*\*\*：改变模型路由以偏好更便宜的层级

## 有效组合

| 组合            | 效果                                   |
| --------------- | -------------------------------------- |
| `eco ralph`     | 使用更便宜智能体的 Ralph 持久化        |
| `eco ultrawork` | 使用更便宜智能体的并行执行             |
| `eco autopilot` | 带成本节约的自主执行                   |

## 无效组合

| 组合             | 为何无效                          |
| ---------------- | --------------------------------- |
| `autopilot team` | 两者都是独立模式 — 选其一         |
| `` 单独          | 需要一个执行模式来修饰            |
