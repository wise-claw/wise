# 委派强制器

**为 Task/Agent 调用自动注入 model 参数**

## 问题

Claude Code **不会**自动应用 agent 定义中的 model 参数。当你调用 `Task` 工具（或 `Agent` 工具）时，必须每次手动指定 `model` 参数，即使每个 agent 都在其配置中定义了默认 model。

这会导致：

- 冗长的委派代码
- 遗漏 model 参数时回退到父 model
- 代码库中 model 使用不一致

## 解决方案

**委派强制器**是一个中间件，当未显式指定时，会基于 agent 定义自动注入 model 参数。

## 工作原理

### 1. Pre-Tool-Use Hook

强制器作为 pre-tool-use hook 运行，拦截 `Task` 与 `Agent` 工具调用：

```typescript
// Before enforcement
Task(
  subagent_type="wise:executor",
  prompt="Implement feature X"
)

// After enforcement (automatic)
Task(
  subagent_type="wise:executor",
  model="sonnet",  // ← Automatically injected
  prompt="Implement feature X"
)
```

### 2. Agent 定义查找

每个 agent 在其定义中有一个默认 model：

```typescript
export const executorAgent: AgentConfig = {
  name: 'executor',
  description: '...',
  prompt: '...',
  tools: [...],
  model: 'sonnet'  // ← Default model
};
```

强制器读取该定义，并在未指定时注入 model。

### 3. 保留显式 model

若你显式指定 model，它始终被保留：

```typescript
// Explicit model is never overridden
Task(
  subagent_type="wise:executor",
  model="haiku",  // ← Explicitly using haiku instead of default sonnet
  prompt="Quick lookup"
)
```

## API

### 核心函数

#### `enforceModel(agentInput: AgentInput): EnforcementResult`

为单次 agent 委派调用强制 model 参数。

```typescript
import { enforceModel } from 'wise';

const input = {
  description: 'Implement feature',
  prompt: 'Add validation',
  subagent_type: 'executor'
};

const result = enforceModel(input);
console.log(result.modifiedInput.model); // 'sonnet'
console.log(result.injected); // true
```

#### `getModelForAgent(agentType: string): ModelType`

获取某 agent 类型的默认 model。

```typescript
import { getModelForAgent } from 'wise';

getModelForAgent('executor'); // 'sonnet'
getModelForAgent('executor-low'); // 'haiku'
getModelForAgent('executor-high'); // 'opus'
```

#### `isAgentCall(toolName: string, toolInput: unknown): boolean`

检查某次工具调用是否为 agent 委派调用。

```typescript
import { isAgentCall } from 'wise';

isAgentCall('Task', { subagent_type: 'executor', ... }); // true
isAgentCall('Bash', { command: 'ls' }); // false
```

### Hook 集成

强制器自动与 pre-tool-use hook 集成：

```typescript
import { processHook } from 'wise';

const hookInput = {
  toolName: 'Task',
  toolInput: {
    description: 'Test',
    prompt: 'Test',
    subagent_type: 'executor'
  }
};

const result = await processHook('pre-tool-use', hookInput);
console.log(result.modifiedInput.model); // 'sonnet'
```

## Agent Model 映射

| Agent 类型            | 默认 model | 用途              |
| --------------------- | ---------- | ----------------- |
| `architect`           | opus       | 复杂分析、调试    |
| `architect-medium`    | sonnet     | 标准分析          |
| `architect-low`       | haiku      | 快速问题          |
| `executor`            | sonnet     | 标准实现          |
| `executor-high`       | opus       | 复杂重构          |
| `executor-low`        | haiku      | 简单变更          |
| `explore`             | haiku      | 快速代码搜索      |
| `designer`            | sonnet     | UI 实现           |
| `designer-high`       | opus       | 复杂 UI 架构      |
| `designer-low`        | haiku      | 简单样式          |
| `document-specialist` | sonnet     | 文档查找          |
| `writer`              | haiku      | 文档编写          |
| `vision`              | sonnet     | 图像分析          |
| `planner`             | opus       | 战略规划          |
| `critic`              | opus       | 计划审查          |
| `analyst`             | opus       | 规划前分析        |
| `qa-tester`           | sonnet     | CLI 测试          |
| `scientist`           | sonnet     | 数据分析          |
| `scientist-high`      | opus       | 复杂研究          |

## 调试模式

启用调试日志以查看 model 何时被自动注入：

```bash
export WISE_DEBUG=true
```

启用后，你将看到类似如下警告：

```
[WISE] Auto-injecting model: sonnet for executor
```

**重要：** 警告**仅**在 `WISE_DEBUG=true` 时显示。无此 flag 时，强制静默进行。

## 使用示例

### 之前（手动）

```typescript
// Every delegation needs explicit model
Task(
  subagent_type="wise:executor",
  model="sonnet",
  prompt="Implement X"
)

Task(
  subagent_type="wise:executor-low",
  model="haiku",
  prompt="Quick lookup"
)
```

### 之后（自动）

```typescript
// Model automatically injected from definition
Task(
  subagent_type="wise:executor",
  prompt="Implement X"
)

Task(
  subagent_type="wise:executor-low",
  prompt="Quick lookup"
)
```

### 需要时覆盖

```typescript
// Use haiku for a simple executor task
Task(
  subagent_type="wise:executor",
  model="haiku",  // Override default sonnet
  prompt="Find definition of X"
)
```

## 实现细节

### Hook 集成

强制器在 `pre-tool-use` hook 中运行：

1. Hook 接收工具调用
2. 检查工具是否为 `Task` 或 `Agent`
3. 检查 `model` 参数是否缺失
4. 查找 agent 定义
5. 注入默认 model
6. 返回修改后的输入

### 错误处理

- 未知 agent 类型抛出错误
- 无默认 model 的 agent 抛出错误
- 无效输入结构原样透传
- 非 agent 工具被忽略

### 性能

- O(1) 查找：对 agent 定义直接哈希表查找
- 无异步操作：同步强制
- 最小开销：仅作用于 Task/Agent 调用

## 测试

运行测试：

```bash
npm test -- delegation-enforcer
```

运行 demo：

```bash
npx tsx examples/delegation-enforcer-demo.ts
```

## 优势

1. **更干净的代码**：无需每次手动指定 model
2. **一致性**：始终为每个 agent 使用正确的 model 层级
3. **安全**：显式 model 始终保留
4. **透明**：调试模式显示 model 何时注入
5. **零配置**：与既有 agent 定义自动协同

## 迁移

无需迁移！强制器向后兼容：

- 带显式 model 的既有代码继续工作
- 新代码可省略 model 参数
- 无破坏性变更

## 相关

- [Agent 定义](./AGENTS.md) - 完整 agent 参考
- [功能参考](./FEATURES.md) - Model 路由与委派类别
