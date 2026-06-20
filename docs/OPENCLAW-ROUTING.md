# OpenClaw / Clawhip 路由契约

本文档定义 WISE 经 OpenClaw 桥接向原生 Clawhip 风格消费者发送的规范化事件契约。

## 目标

- 保留原始 hook 事件（`event`）以保持向后兼容。
- 新增规范化 `signal` 对象，用于路由与便于去重的过滤。
- 使命令/原生网关与 HTTP 网关接收相同逻辑 payload 形状。

## Payload 形状

HTTP 网关接收如下结构的 JSON：

```json
{
  "event": "post-tool-use",
  "instruction": "...",
  "timestamp": "2026-03-09T00:00:00.000Z",
  "sessionId": "...",
  "projectPath": "...",
  "projectName": "...",
  "tmuxSession": "...",
  "tmuxTail": "...",
  "signal": {
    "kind": "test",
    "name": "test-run",
    "phase": "failed",
    "routeKey": "test.failed",
    "priority": "high",
    "toolName": "Bash",
    "command": "pnpm test",
    "testRunner": "package-test",
    "summary": "FAIL src/example.test.ts | ..."
  },
  "context": {
    "sessionId": "...",
    "projectPath": "...",
    "toolName": "Bash"
  }
}
```

## `signal` 契约

| 字段      | 含义                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `kind`     | 路由家族：`session`、`tool`、`test`、`pull-request`、`question`、`keyword`  |
| `name`     | 稳定的逻辑信号名                                                        |
| `phase`    | 生命周期阶段：`started`、`finished`、`failed`、`idle`、`detected`、`requested` |
| `routeKey` | 下游消费者使用的规范路由键                                    |
| `priority` | 运维类信号为 `high`，通用工具噪声为 `low`                      |

适用时可能额外出现以下字段：

- `toolName`
- `command`
- `testRunner`
- `prUrl`
- `summary`

## 原生命令网关契约

命令网关现在通过两种方式获得相同的规范化 payload：

- 模板变量：`{{payloadJson}}`
- 环境变量：`OPENCLAW_PAYLOAD_JSON`

它们还获得便捷环境变量：

- `OPENCLAW_SIGNAL_ROUTE_KEY`
- `OPENCLAW_SIGNAL_PHASE`
- `OPENCLAW_SIGNAL_KIND`

这使得原生 Clawhip 路由无论传输层是 HTTP 还是 shell 命令，都能消费同一契约。

## 当前高优先级路由键

- `session.started`
- `session.finished`
- `session.idle`
- `question.requested`
- `test.started`
- `test.finished`
- `test.failed`
- `pull-request.started`
- `pull-request.created`
- `pull-request.failed`
- `tool.failed`

通用 `tool.started` / `tool.finished` 仍作为低优先级降级信号可用。

## 噪声抑制

- `AskUserQuestion` 现在仅发送专用 `question.requested` 信号，不再同时发送通用工具生命周期事件。
- OpenClaw 现在在向下游原生网关分发前，折叠重复的 attached-tmux 生命周期突发。
  - `session-start` 在短突发窗口内按 `{projectPath, tmuxSession}` 折叠。
  - `keyword-detector`（`UserPromptSubmit` 桥接面）按 `{projectPath, tmuxSession, normalized prompt}` 折叠 prompt-submitted 突发。
  - `stop` / `session-end` 在短突发窗口内按 `{projectPath, tmuxSession}` 折叠。
- 消费者应优先使用 `signal.priority === "high"` 或显式 `signal.routeKey` 过滤，而非直接基于原始 hook 名路由。

## 稳定性说明

- 原始 `event` 名保留以保持向后兼容。
- `signal` 是新原生 Clawhip 集成首选的路由面。
- `context` 保持为白名单子集；内部原始工具输入/输出仅用于推导规范化信号，不会转发到 `payload.context`。
