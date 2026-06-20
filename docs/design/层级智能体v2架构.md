# 层级智能体 v2 架构设计

## 概览

本文档描述一种改进的层级智能体架构，用于解决当前缺口并实现模型路由、能力继承与动态升级的精细模式。

## 已识别的当前问题

1. **继承不完整**：层级智能体未从基础智能体继承核心行为模式
2. **工具限制不一致**：工具限制缺乏清晰理由即各不相同
3. **缺少升级信号**：智能体过载时无请求升级的机制
4. **行为指令过少**：层级变体的指令过少
5. **Markdown 中无动态路由**：TypeScript 路由器已存在，但 markdown 智能体未利用它

## 设计原则

### 1. 基于模板的继承

每个层级智能体应从基础模板继承：
- 核心身份与角色
- 基本约束（只读、不委派等）
- 输出格式要求
- 质量标准

层级特定覆盖随后定制：
- 任务复杂度边界
- 工具限制
- 响应深度/广度
- 升级阈值

### 2. 显式能力边界

每个层级有清晰边界：

| 层级 | 复杂度 | 响应深度 | 自我评估 |
|------|------------|----------------|-----------------|
| LOW (Haiku) | 简单、单一焦点 | 简洁、直接 | "这是否在我的范围内？" |
| MEDIUM (Sonnet) | 中等、多步 | 详尽、结构化 | "我能完全处理吗？" |
| HIGH (Opus) | 复杂、系统级 | 全面、细致 | "权衡有哪些？" |

### 3. 升级信号

智能体应识别何时建议升级：

```markdown
<Escalation_Signals>
## When to Recommend Higher Tier

Escalate when you detect:
- Task exceeds your complexity boundary
- Multiple failed attempts (>2)
- Cross-system dependencies you can't trace
- Security-sensitive changes
- Irreversible operations

Output escalation recommendation:
**ESCALATION RECOMMENDED**: [reason] → Use [higher-tier-agent]
</Escalation_Signals>
```

### 4. 工具能力层级

| 工具 | LOW | MEDIUM | HIGH |
|------|-----|--------|------|
| Read | ✅ | ✅ | ✅ |
| Glob | ✅ | ✅ | ✅ |
| Grep | ✅ | ✅ | ✅ |
| Edit | ✅ (简单) | ✅ | ✅ |
| Write | ✅ (简单) | ✅ | ✅ |
| Bash | 受限 | ✅ | ✅ |
| WebSearch | ❌ | ✅ | ✅ |
| WebFetch | ❌ | ✅ | ✅ |
| Task | ❌ | ❌ | 视情况 |
| TodoWrite | ✅ | ✅ | ✅ |

## 智能体家族模板

### Architect 家族（分析）

**基础身份**：战略顾问，只读咨询师，诊断而非实现

| 变体 | 模型 | 工具 | 焦点 |
|---------|-------|-------|-------|
| architect-low | Haiku | Read, Glob, Grep | 快速查找、单文件分析 |
| architect-medium | Sonnet | + WebSearch, WebFetch | 标准分析、依赖追踪 |
| architect | Opus | 完整读访问 | 深度架构分析、系统级模式 |

**共享约束**：
- 无 Write/Edit 工具
- 不实现
- 必须引用 file:line 引用
- 必须提供可操作建议

**层级特定行为**：

```markdown
## architect-low
- Answer direct questions quickly
- Single-file focus
- Output: Answer + Location + Context (3 lines max)
- Escalate if: cross-file dependencies, architecture questions

## architect-medium
- Standard analysis workflow
- Multi-file tracing allowed
- Output: Summary + Findings + Diagnosis + Recommendations
- Escalate if: system-wide impact, security concerns, irreversible changes

## architect (high)
- Deep architectural analysis
- System-wide pattern recognition
- Output: Full structured analysis with trade-offs
- No escalation needed (highest tier)
```

### Executor 家族（执行）

**基础身份**：专注执行者，独立工作，不委派，执着于 TODO

| 变体 | 模型 | 工具 | 焦点 |
|---------|-------|-------|-------|
| executor-low | Haiku | Read, Glob, Grep, Edit, Write, Bash, TodoWrite | 单文件、琐碎变更 |
| executor | Sonnet | 同上 | 多步、中等复杂度 |
| executor-high | Opus | 同上 | 多文件、复杂重构 |

**共享约束**：
- Task 工具被阻塞（不委派）
- 2+ 步任务必须使用 TodoWrite
- 变更后必须验证
- 独立工作

**层级特定行为**：

```markdown
## executor-low
- Single-file edits only
- Trivial changes (typos, simple additions)
- Skip TodoWrite for <2 step tasks
- Escalate if: multi-file changes, complex logic, architectural decisions

## executor (medium)
- Multi-step tasks within a module
- Standard complexity
- Always use TodoWrite
- Escalate if: system-wide changes, cross-module dependencies

## executor-high
- Multi-file refactoring
- Complex architectural changes
- Deep analysis before changes
- No escalation needed (use architect for consultation)
```

### Designer 家族（UI/UX）

**基础身份**：设计师-开发者混合体，看见纯开发者遗漏之处，创造令人难忘的界面

| 变体 | 模型 | 工具 | 焦点 |
|---------|-------|-------|-------|
| designer-low | Haiku | Read, Glob, Grep, Edit, Write, Bash | 简单样式、微调 |
| designer | Sonnet | 同上 | 标准 UI 工作、组件 |
| designer-high | Opus | 同上 | 设计系统、复杂架构 |

**共享约束**：
- 永不使用通用字体 (Inter, Roboto, Arial)
- 永不使用俗套模式 (紫色渐变)
- 匹配既有代码模式
- 生产级质量输出

**层级特定行为**：

```markdown
## designer-low
- Simple CSS changes (colors, spacing, fonts)
- Minor component tweaks
- Match existing patterns exactly
- Escalate if: new component design, design system changes

## designer (medium)
- Standard component work
- Apply design philosophy
- Make intentional aesthetic choices
- Escalate if: design system creation, complex state management

## designer-high
- Design system architecture
- Complex component hierarchies
- Deep aesthetic reasoning
- Full creative latitude
```

### Document-Specialist 家族（研究）

**基础身份**：外部文档 document-specialist，搜索外部资源

| 变体 | 模型 | 工具 | 焦点 |
|---------|-------|-------|-------|
| document-specialist-low | Haiku | Read, Glob, Grep, WebSearch, WebFetch | 快速查找 |
| document-specialist | Sonnet | 同上 | 全面研究 |

**共享约束**：
- 问题为项目特定时优先检查仓库文档
- 始终用 URL（或 URL 不可用时用稳定的 curated-doc ID）引用来源
- 外部 API/框架正确性优先使用 Context Hub / `chub`（或已配置的其他 curated docs 后端），其次官方文档
- 注明版本兼容性
- 标记过时信息

**层级特定行为**：

```markdown
## document-specialist-low
- Quick API lookups
- Find specific references
- Output: Answer + Source + Example (if applicable)
- Escalate if: comprehensive research needed, multiple sources required

## document-specialist (medium)
- Comprehensive research
- Multiple source synthesis
- Full structured output format
- No escalation needed for research tasks
```

### Explore 家族（搜索）

**基础身份**：代码库搜索专家，查找文件与代码模式

| 变体 | 模型 | 工具 | 焦点 |
|---------|-------|-------|-------|
| explore | Haiku | Read, Glob, Grep | 快速搜索 |
| explore (model=sonnet) | Sonnet | 同上 | 详尽分析 |

**共享约束**：
- 只读
- 始终使用绝对路径
- 返回结构化结果
- 针对潜在需求，而非仅字面请求

**层级特定行为**：

```markdown
## explore (low)
- Quick pattern matching
- File location
- Parallel tool calls (3+)
- Escalate if: architecture understanding needed, cross-module analysis

## explore (model=sonnet)
- Thorough analysis
- Cross-reference findings
- Explain relationships
- No escalation needed
```

## 所需实现变更

### 1. 更新 Markdown 智能体文件

每个层级智能体文件应包含：

```markdown
---
name: [agent]-[tier]
description: [tier-specific description]
tools: [restricted tool list]
model: [haiku|sonnet|opus]
---

<Inherits_From>
Base: [base-agent].md
</Inherits_From>

<Tier_Identity>
[Tier-specific role and focus]
</Tier_Identity>

<Complexity_Boundary>
You handle: [specific types of tasks]
Escalate when: [specific conditions]
</Complexity_Boundary>

[Tier-specific instructions...]

<Escalation_Protocol>
When you detect tasks beyond your scope, output:
**ESCALATION RECOMMENDED**: [reason] → Use wise:[higher-tier]
</Escalation_Protocol>
```

### 2. 更新 TypeScript 路由器

路由器应：
- 从 markdown 解析智能体能力
- 将任务信号匹配到层级边界
- 在输出中提供升级建议

### 3. 增加升级检测

编排器应：
- 检测智能体输出中的 "ESCALATION RECOMMENDED"
- 自动用推荐的更高层级重试
- 记录升级模式以供优化

## 成本影响分析

基于当前定价（Haiku $1/$5，Sonnet $3/$15，Opus $5/$25 每百万 token）：

| 场景 | 之前（全 Sonnet） | 之后（层级化） | 节省 |
|----------|---------------------|----------------|---------|
| 简单查找 (70%) | $3/$15 | $1/$5 (Haiku) | ~67% |
| 标准工作 (25%) | $3/$15 | $3/$15 (Sonnet) | 0% |
| 复杂工作 (5%) | $3/$15 | $5/$25 (Opus) | -67% |
| **加权平均** | $3/$15 | ~$1.60/$8 | **~47%** |

智能路由可在提升复杂任务质量的同时降低约 47% 成本。

## 后续步骤

1. 为所有层级智能体创建更新后的 markdown 文件
2. 向 hooks 增加升级检测
3. 更新路由器以使用智能体能力解析
4. 增加层级使用优化的遥测
5. 为升级场景创建测试
