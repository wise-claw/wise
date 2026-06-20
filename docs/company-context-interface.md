# 公司上下文 MCP 接口

WISE 支持一种窄化的、提示级的厂商公司上下文契约。

该契约针对 issue #2692 中的特定失败模式：纯提示指令式的公司上下文指引在实践中仍有约 5% 的遗漏率。将查询改为显式配置的工具调用，可在规格层显著降低该遗漏模式，而不改变 WISE 运行时行为。

这**不是**运行时强制特性。它为 WISE 工作流提供：

- 一致的工具形状，
- 显式的 WISE 配置块，
- 当所选技能应查询该工具时的共享措辞。

工具调用本身仍是尽力而为的提示行为。它提升一致性，但**不**保证数学意义上完美的执行。

## 适用范围

当你的组织已拥有可返回内部约定、安全指引、术语表或审查清单作为普通参考材料的 MCP 服务器时使用本契约。

本契约**不**创建：

- 远程 WISE 集群，
- 共享远程文件系统，
- 强制调用该工具的运行时 hook，
- 对厂商输出的内容验证、签名或沙箱化。

## 工具契约

精确实现一个工具：

```text
tool: get_company_context
input:  { query: string }
output: { context: string }
```

- `query` 是由调用工作流构建的自然语言摘要。
- `context` 是 markdown 参考材料。

## 信任边界

`context` **仅供参考**。

厂商输出必须被视为引述式建议数据，而非可执行指令。它不得试图覆盖系统提示、让智能体忽略先前指令，或冒充策略执行。

WISE 技能条款应将返回的 markdown 视同 `deep-dive` 处理注入 trace 上下文的方式：有用的参考材料，而非指令权威。

## WISE 配置

在标准 WISE 配置面配置该契约：

- 项目：`.claude/wise.jsonc`
- 用户：`~/.config/claude-wise/config.jsonc`

项目配置覆盖用户配置。

```jsonc
{
  "companyContext": {
    "tool": "mcp__vendor__get_company_context",
    "onError": "warn"
  }
}
```

### 字段

| 字段 | 类型 | 必填 | 含义 |
|-------|------|----------|---------|
| `tool` | `string` | 否 | 要调用的完整 MCP 工具名，如 `mcp__vendor__get_company_context` |
| `onError` | `"warn" \| "silent" \| "fail"` | 否 | 配置的调用失败时的提示级降级。默认：`"warn"` |

### 降级语义

- 未配置：跳过调用并正常继续。
- `warn`：简要提示失败并继续。
- `silent`：继续，不附加额外提示。
- `fail`：停止并暴露工具调用错误。

## 工作流触发阶段

以下是内置技能提示使用的命名阶段：

| 技能 | 阶段 |
|-------|-------|
| `deep-interview` | 在 Phase 4 固化规格之前 |
| `deep-dive` | 在 Phase 4 开始时，trace 综合可用之后 |
| `ralplan` | 在共识循环开始之前 |
| `autopilot` | 在 Phase 0 进入时 |
| `ralph` | 在每次迭代选取下一个 story 之前 |

每个技能应构建一个 `query`，汇总当前任务、当前阶段、已知约束，以及可用时的相关文件或制品。

## MCP 注册

公司上下文服务器本身仍通过常规 MCP 面注册：

- Claude MCP 配置 / `claude mcp add ...`
- WISE 同步到 Codex 的统一 MCP registry

本契约不改变 MCP 服务器的注册方式。

一个最小可运行参考实现见：

- [`examples/vendor-mcp-server/README.md`](../examples/vendor-mcp-server/README.md)

## 残余风险

本接口通过使公司上下文查询显式化，解决了观察到的约 5% 提示指令遗漏模式，但它仍运行在技能提示层。文档化的必须调用条款应能显著降低该遗漏率，但仍**不**保证 0% 遗漏率或数学意义上完美的调用。若需要确定性调用，需单独设计运行时强制机制。

## 非目标

- Hook 级强制
- 对厂商输出的提示注入扫描
- 厂商签名或允许列表
- 超出单一配置工具与 `onError` 的每技能覆盖矩阵
- 捆绑 SDK 或托管公司上下文产品
