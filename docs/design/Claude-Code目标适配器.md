# Claude Code `/goal` 适配器设计

## 背景

Claude Code 将 `/goal` 暴露为原生的、会话作用域的工作循环。WISE 可将该循环用作执行表面，但 WISE 必须保留自身持久的审计轨迹、hook 安全规则以及 Ralph/Team/UltraQA 边界。此处描述的适配器是面向未来实现的设计契约；它不会变更隐藏的 Claude Code goal 状态。

## 来源权威边界

WISE 文档与代码注释中关于 Claude Code `/goal` 的事实只能来自 Claude Code 或 Anthropic 的来源，例如：

- Claude Code 文档：<https://code.claude.com/docs/en/goal>
- Anthropic Claude Code 更新日志：<https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>

OpenAI、Codex、OMX 或 OMO 的引用可用于与其自身的 goal/运行时行为作对比，但它们并非 Claude Code `/goal` 事实的权威来源。

## 适配器职责

Claude Code `/goal` 适配器是面向 WISE 的边界，负责渲染安全的交接文本与持久证据。它必须：

1. 在建议原生交接前，检测或接收关于 `/goal` 的能力判定。
2. 渲染可度量的 `/goal <完成条件>` 交接提示，而非直接写入隐藏的 Claude Code 会话状态。
3. 通过在 WISE 自有的制品中记录所请求的条件、状态快照、浮现的评估器理由、命令证据与最终评审结果，保留 WISE 的可审计性。
4. 当工作区信任、hook 设置或托管 hook 策略导致 `/goal` 不可用时，拒绝或降级。
5. 每个会话强制单一活跃循环权威，使 `/goal` 不与 Ralph、Team、autopilot、UltraQA 或 Stop-hook 续接循环竞争。

## Goal 契约子集

未来实现应将每个 goal 项映射到以下共享持久契约：

| 字段                   | 必需行为                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `goal_id`              | 用于交接、检查点与评审的稳定仓库本地标识符。                                                       |
| `objective`            | 人类可读的目标结果。                                                                               |
| `completion_condition` | 适合 `/goal <条件>` 交接的可度量条件。                                                              |
| `runtime_target`       | 原生 `/goal` 用 `claude-code-goal`，否则用 `artifact-only` 降级。                                  |
| `loop_authority`       | 恰好一个主权威：`claude-code-goal`、`ralph`、`team`、`ultraqa`、`autopilot` 或 `artifact-only`。   |
| `conflict_policy`      | 取值之一：`refuse`、`adopt_existing` 或 `artifact_only`。                                           |
| `source_refs`          | Claude Code `/goal` 的声明只引用 Claude Code/Anthropic 来源。                                       |
| `evidence`             | 浮现的命令输出、文档更新、测试输出、评审结论与状态快照。                                            |
| `status`               | 区分评估器成功与 WISE 最终评审：`evaluator_passed` 不等于 `complete`。                              |

## 确定性循环冲突策略

当另一个主循环处于活跃状态时，适配器必须应用以下确定性策略之一，并在证据中记录该决策：

| 策略             | 行为                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `refuse`         | 在渲染 `/goal` 交接前停止。说明当前活跃的权威，以及用户必须先清除的确切命令或状态。                |
| `adopt_existing` | 保留现有循环权威，并将该 goal 契约作为该循环的证据/检查点附加。不要启动 `/goal`。                  |
| `artifact_only`  | 仅写入持久 goal 账本与交接制品。不要要求 Claude Code 激活 `/goal`。                                |

适配器绝不可与竞争循环“警告并继续”。任何未知策略均无效，必须以可操作的诊断信息失败。

## 可用性与降级矩阵

| 条件                                                            | 适配器结果                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/goal` 受支持、可信工作区、无竞争循环                          | 渲染 `/goal <条件>` 交接并记录预期的循环权威。                                  |
| 禁用 hook 的设置阻止 `/goal`                                    | 使用 `refuse` 或 `artifact_only`；在诊断中包含 hook 策略。                      |
| 托管 hooks 阻止 `/goal`                                         | 使用 `refuse` 或 `artifact_only`；不建议绕过策略。                              |
| 工作区不可信                                                    | 在建立信任前拒绝原生交接，或创建仅制品证据。                                     |
| Ralph/autopilot/Stop-hook/Team/UltraQA 已是权威                 | 精确应用 `conflict_policy`。                                                    |
| 无法判定能力                                                    | 优先使用 `artifact_only`，除非用户显式请求手动原生 `/goal` 交接。                |

## 交接渲染契约

原生交接必须显式且可验证：

```text
/goal Complete <objective> when <measurable condition>. Before claiming completion, surface evidence from: <proof command>, <docs check>, and <final review checkpoint>.
```

交接文本必须提醒智能体：`/goal` 评估器判定的是浮现的会话证据。它不得暗示评估器独立读取文件或运行命令。

## 最终评审门

WISE 完成要求在任何 `/goal` 评估器成功后进行最终评审：

1. `/goal` 评估器基于浮现的证据通过。
2. WISE 记录 `evaluator_passed` 及状态快照/评估器理由。
3. WISE 运行或记录必需的验证证据。
4. 最终评审者标记 `complete`、`review_blocked` 或 `failed`。

直接的 `evaluator_passed -> complete` 转换无效，因为它们跳过了 WISE 自有的验证。

## 存储边界

适配器应优先使用逻辑制品名，其次通过 WISE 运行时路径解析：

| 逻辑制品   | WISE 路径意图                                                   |
| ---------- | --------------------------------------------------------------- |
| Goal 账本  | `.wise/goals/` 或配置的 WISE 状态根。                            |
| 交接制品   | `.wise/context/` 或配置的交接目录。                              |
| 完成证据   | `.wise/goals/<goal_id>/evidence/` 或配置的证据存储。             |

文档可对比 OMX `.omx` 或 OMO 原生路径，但 WISE 适配器代码不得要求 `.omx/` 在仅 WISE 工作区中存在。
