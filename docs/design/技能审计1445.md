# Issue #1445 技能审计

日期：2026-03-08

## 目标

审计 issue #1445 中点名的七个低价值技能，判定它们是否已可弃用、应保留为内建，或在做出任何移除决定前需要补充埋点。

## 已审计技能

| 技能 | 行数 | 初始顾虑 | 审计结论 |
| --- | ---: | --- | --- |
| `configure-notifications` | 1213 | 对狭窄任务而言过大 | 暂保留；行为过多，无使用数据不宜弃用 |
| `sciwise` | 510 | 小众科研工作流 | 暂保留；小众不等于无用 |
| `deep-interview` | 551 | 复杂且频率不明 | 暂保留；关键词触发的规划面仍存在 |
| `project-session-manager` | 564 | 与原生 worktree 重叠 | 暂保留；仍提供超出纯 git worktree 的 tmux/会话编排 |
| `writer-memory` | 443 | 领域特定 | 暂保留；仅领域特定不足以作为移除证据 |
| `external-context` | 83 | 薄包装顾虑 | 后续整合候选，但当前证据不足以移除 |
| `release` | 87 | 项目特定 | 暂保留；本仓库预期存在项目特定的维护工作流 |

## 既有证据来源

仓库已具备有用的可观测性面，可支撑未来的弃用决定：

- `src/hooks/subagent-tracker/flow-tracer.ts`
- `src/hooks/subagent-tracker/session-replay.ts`
- `src/tools/trace-tools.ts`
- `docs/PERFORMANCE-MONITORING.md`
- `skills/learn-about-wise/SKILL.md`

这些面提供会话级 trace、回放数据与聚合摘要。在新增可选遥测之前，它们足以支撑结构化的人工审计。

## 为何此 Issue 尚不具备弃用条件

移除/弃用决定仍缺少三样东西：

1. **分母** — 使用量应仅对规范技能度量、对规范 + 已弃用别名度量，还是按用户会话度量。
2. **时间窗口** — 跨天、周或发布版本没有统一的 "<5% 使用量" 阈值。
3. **隐私姿态** — 新增遥测需要显式的可选范围与保留规则。

缺少这些，立即移除将是武断且难以辩护的。

## 推荐评估准则

在未来任何弃用 PR 之前，要求满足以下全部条件：

1. 至少一个发布周期的 trace 推导使用数据，或清晰文档化的人工采样方法。
2. 书面的低使用量阈值，包括所度量的总体。
3. 任何仍面向用户的命令的迁移路径。
4. 替代面（若技能因原生工具或其他技能已覆盖该用例而移除）。

## 推荐后续步骤

### 暂按原样保留

- `configure-notifications`
- `sciwise`
- `deep-interview`
- `project-session-manager`
- `writer-memory`
- `release`

### 稍后以更强证据重新评估

- `external-context`

### 若维护者需要更硬数据的后续工作

1. 文档化基于既有 `trace_summary` 与回放数据的 trace 审计工作流。
2. 决定 `learn-about-wise` 是否应直接暴露该审计视图。
3. 仅在 trace 工作流证明不足时，才考虑新增可选遥测。

## 结论

Issue #1445 作为审计请求是合理的，但当前**不**足以证明移除任何已审计技能。今日的正确结论是一份审计记录加上更清晰的决策框架，而非一批弃用。
