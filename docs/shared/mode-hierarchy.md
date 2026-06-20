# 执行模式层级

本文档定义执行模式之间的关系，并提供模式选择指引。

## 模式继承树

```
autopilot（自主端到端）
├── 包含: ralph（持久化）
│   └── 包含: ultrawork（并行）
├── 包含: ultraqa（QA 循环）
└── 包含: plan（战略思考）

 （仅 token 效率）
└── 修改: 智能体层级选择（偏好 haiku/sonnet）
    （不包含持久化 — 那是 ralph 的职责）

ralph（持久化包装器）
└── 包含: ultrawork（并行引擎）
    （新增: 循环直至完成 + architect 验证）

ultrawork（并行引擎）
└── 仅组件 — 并行智能体派生
    （无持久化，无验证循环）
```

## 模式关系

| 模式 | 类型 | 包含 | 互斥于 |
|------|------|----------|------------------------|
| autopilot | 独立 | ralph, ultraqa, plan | - |
| ralph | 包装器 | ultrawork | - |
| ultrawork | 组件 | - | - |
|  | 修饰器 | - | - |
| ultraqa | 组件 | - | - |

## 决策树

```
需要自主执行?
├── 是: 任务能否拆分为 3+ 个独立组件?
│   ├── 是: team N:executor（带文件所有权的并行自主）
│   └── 否: autopilot（带 ralph 阶段的顺序执行）
└── 否: 需要带人工监督的并行执行?
    ├── 是: 需要成本优化吗?
    │   ├── 是:  + ultrawork
    │   └── 否: 单独 ultrawork
    └── 否: 需要持久化直至验证完成?
        ├── 是: ralph（持久化 + ultrawork + 验证）
        └── 否: 标准编排（直接委派给智能体）

有许多相似的独立任务（如「修复 47 个错误」）?
└── 是: team N:executor（N 个智能体从任务池领取）
```

## 模式差异矩阵

| 模式 | 最适用场景 | 并行性 | 持久化 | 验证 | 文件所有权 |
|------|----------|-------------|-------------|--------------|----------------|
| autopilot | 「帮我构建 X」 | 经由 ralph | 是 | 是 | 不适用 |
| team | 多组件/同质 | N 个 worker | 按任务 | 按任务 | 按任务 |
| ralph | 「不要停」 | 经由 ultrawork | 是 | 强制 | 不适用 |
| ultrawork | 仅并行 | 是 | 否 | 否 | 不适用 |
|  | 节省成本 | 修饰器 | 否 | 否 | 不适用 |

## 快速参考

**只想构建点东西？** → `autopilot`
**构建多组件系统？** → `team N:executor`
**修复许多相似问题？** → `team N:executor`
**想要控制执行？** → `ultrawork`
**需要验证完成？** → `ralph`
**想节省 token？** → `` （与其他模式组合）

## 组合模式

有效组合：
- `eco ralph` = 使用更便宜智能体的 Ralph 循环
- `eco ultrawork` = 使用更便宜智能体的并行执行
- `eco autopilot` = 带成本优化的全自主

无效组合：
- `autopilot team` = 互斥（两者都是独立模式）
- `` 单独 = 无用（需要一个执行模式）

## 状态管理

### 标准路径
所有模式 state 文件使用标准化位置：
- 主：`.wise/state/{name}.json`（本地，按项目）
- 全局备份：`~/.wise/state/{name}.json`（全局，会话连续性）

### 模式 State 文件
| 模式 | State 文件 |
|------|-----------|
| ralph | `ralph-state.json` |
| autopilot | `autopilot-state.json` |
| ultrawork | `ultrawork-state.json` |
|  | `-state.json` |
| ultraqa | `ultraqa-state.json` |
| pipeline | `pipeline-state.json` |

**重要：** 切勿将 WISE state 存于 `~/.claude/` — 该目录保留给 Claude Code 自身。

Legacy 位置在读取时自动迁移。
