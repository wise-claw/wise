# Bug：cancel 技能未清除 skill-active-state.json

## 摘要

当调用 `/wise:cancel` 时，它会清除 ralph、ultrawork、autopilot、team 等的模式 state 文件 — 但**不会**清除 `skill-active-state.json`。这会导致 stop hook 在取消后继续触发 reinforcement，直至达到 reinforcement 上限或 stale TTL 过期。

## 复现

1. 调用一个 `medium` 保护的技能（如 `sciwise`、`skillify`、`release`）
2. 在技能完成前，调用 `/wise:cancel`
3. 观察：stop hook 继续以 `[SKILL ACTIVE: sciwise]` reinforcement 1/5 → 2/5 → ... 阻塞，直至达到上限或 15 分钟 TTL

## 根因

`skill-active-state.json` 位于：

```
.wise/state/sessions/{sessionId}/skill-active-state.json
```

cancel 技能对已知模式调用 `state_clear(mode=...)`，但 `state_clear` MCP 工具的 mode enum 不包含 `skill-active`：

```
"autopilot" | "team" | "ralph" | "ultrawork" | "ultraqa"
| "ralplan" | "wise-teams" | "deep-interview"
```

无 `skill-active` 条目 → 文件未删除 → stop hook 读取陈旧的 `active: true` 并持续阻塞。

技能保护注册表（`src/hooks/skill-state/index.ts`）将 `sciwise` 定义为 `medium`：

```typescript
sciwise: 'medium',  // 5 reinforcements, 15-min stale TTL
```

因此用户在取消后被阻塞长达 15 分钟（或 5 次 hook 触发）。

## 逃生阀（当前变通方案）

手动删除该文件：

```bash
rm .wise/state/sessions/<sessionId>/skill-active-state.json
```

或等待 15 分钟 TTL / 5 次 reinforcement 上限自动清除。

## 修复方案

### 方案 A — 将 `skill-active` 加入 `state_clear` MCP 工具

在 state 工具的 mode enum 中加入 `"skill-active"`，使 cancel 可调用：

```
state_clear(mode="skill-active", session_id=...)
```

### 方案 B — cancel 技能直接清除该文件

在 `skills/cancel/cancel.md`（"No Active Modes" / force-clear 节）中，新增一步：

```
After mode cleanup, also clear skill-active-state.json:
  state_clear(mode="skill-active", session_id)
```

或在 cancel 脚本中直接删除文件（若 state_clear 未暴露此 mode）。

### 方案 C — 在 skill-state stop hook 中检测 `/cancel`

在 `src/hooks/skill-state/index.ts` 中，在阻塞前检查 cancel-in-progress 信号，类似于 `cancelInProgress` 被传入 `checkUltrawork()` 的方式。

## 建议

方案 A 最干净：它使 `skill-active` 成为 state 工具中的一等 mode，与其他 mode 的管理方式一致。方案 B 是无需新基础设施的快速修复。

## 相关

- `src/hooks/skill-state/index.ts` — 保护注册表 + 检查逻辑
- `src/hooks/persistent-mode/index.ts:1170` — 调用技能 state 检查之处
- `skills/cancel/cancel.md` — cancel 技能清理步骤
- Issue #1033 — 原始 skill-state 保护功能
- PR #2099 — 修复 ralph/ultrawork/autopilot 的陈旧 `awaiting_confirmation`（不同系统）
