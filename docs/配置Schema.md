# 配置 Schema

本页文档化标准 WISE 配置文件中 WISE 拥有的配置键：

- 项目：`.claude/wise.jsonc`
- 用户：`~/.config/claude-wise/config.jsonc`

项目配置覆盖用户配置。

## `wise.companyContext` / `companyContext`

Issue #2692 与 PR #2694 的后续评审将该设置称为 `wise.companyContext`。
在当前 WISE 配置面中，同一块以上述 WISE 配置文件中的顶层 `companyContext` 对象写入。

```jsonc
{
  "companyContext": {
    "tool": "mcp__vendor__get_company_context",
    "onError": "warn"
  }
}
```

### 字段

| 字段 | 类型 | 必填 | 默认值 | 含义 |
|-------|------|----------|---------|---------|
| `tool` | `string` | 否 | 无 | 要调用的完整 MCP 工具名，例如 `mcp__vendor__get_company_context` |
| `onError` | `"warn" \| "silent" \| "fail"` | 否 | `"warn"` | 配置的 company-context 工具调用失败时 prompt 工作流如何反应 |

### 行为

- 若省略 `companyContext`，该功能关闭，工作流正常继续。
- 若配置了 `tool`，支持的工作流 prompt 可在其文档化阶段调用该 MCP 工具。
- `onError: "warn"` 记录失败并继续。
- `onError: "silent"` 不附加提示直接继续。
- `onError: "fail"` 停止并呈现工具调用错误。

这仍是 prompt 级工作流契约，而非运行时强制。完整接口、信任边界、触发阶段与残余风险见 [`company-context-interface.md`](./company-context-interface.md)。
