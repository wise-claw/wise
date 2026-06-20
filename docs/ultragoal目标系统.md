# wise ultragoal

`wise ultragoal` 是一个持久的、仓库原生的多目标工作流，与 Claude Code `/goal` 斜杠命令配合。它在 `.wise/ultragoal/` 下存储计划/账本制品，并打印面向模型的交接文本，告知活跃 Claude 智能体何时调用 `/goal <condition>`、何时清除它，以及为账本核对回传什么快照 JSON。

## 它是什么（以及不是什么）

- **它是**：一个轻量文件系统状态机，用于将 brief 拆解为有序 story、记录尝试/检查点，并将最终完成门控在 `ai-slop-cleaner` + 验证 + `$code-review` 证据之后。
- **它不是**：一种让 shell 命令变更 Claude Code `/goal` 状态的方式。Claude `/goal` 是会话级、面向模型的指令（它注册一个 stop hook 直至某条件成立，成功时自动清除）。WISE 无法替模型调用 `/goal` —— 交接文本是活跃 Claude 智能体自行读取并执行的指令。

## 制品

```
.wise/ultragoal/
  brief.md       The free-text brief used to seed the plan
  goals.json     The structured plan (version 1) with stories and mode
  ledger.jsonl   Append-only audit trail of plan/goal events
```

计划存储一个 `claudeGoalMode`：

- `aggregate`（默认）：一个 Claude `/goal` 覆盖整个 ultragoal 运行；WISE story `G001`/`G002`/… 仅是账本中的簿记。
- `per_story`：每个 ultragoal story 对应其自身的 Claude `/goal` 指令。当 story 较大且希望各自单独清除时使用。

## 命令

```
wise ultragoal create-goals  [--brief <text> | --brief-file <path> | --from-stdin]
                            [--goal <title::objective>]...
                            [--claude-goal-mode <aggregate|per-story>] [--force] [--json]
wise ultragoal complete-goals  [--retry-failed] [--json]
wise ultragoal add-goal       --title <title> --objective <text> [--evidence <text>] [--json]
wise ultragoal record-review-blockers
                            --goal-id <id> --title <title> --objective <text>
                            --evidence <review-findings>
                            --claude-goal-json <active-json-or-path> [--json]
wise ultragoal checkpoint    --goal-id <id> --status <complete|failed|blocked>
                            [--evidence <text>]
                            [--claude-goal-json <json-or-path>]
                            [--quality-gate-json <json-or-path>] [--json]
wise ultragoal status        [--claude-goal-json <json-or-path>] [--json]
```

别名：`create` → `create-goals`，`complete|next|start-next` → `complete-goals`。

## Claude `/goal` 快照

`--claude-goal-json` 接受内联 JSON 或包含模型从活跃 Claude 会话回传快照的 JSON 文件路径。接受的形状：

```json
{ "goal": { "objective": "...", "status": "active|complete|cancelled" } }
{ "objective": "...", "status": "complete" }
{ "goal": { "condition": "...", "status": "cleared" } }
```

`condition` 被接受为 `objective` 的同义词（Claude `/goal` 将该指令称为 "condition"）。`cleared` 被视作 `cancelled`。

## 最终质量门

ultragoal 运行的最终完成是强制门控的。模型必须对变更文件运行 `ai-slop-cleaner`（即便为 no-op）、重跑验证，然后运行 `$code-review`，最后通过 `--quality-gate-json` 传入如下形状：

```json
{
  "aiSlopCleaner": { "status": "passed", "evidence": "..." },
  "verification":  { "status": "passed", "commands": ["..."], "evidence": "..." },
  "codeReview":    { "recommendation": "APPROVE", "architectStatus": "CLEAR", "evidence": "..." }
}
```

若最终审查不干净，模型应调用 `wise ultragoal record-review-blockers`，而非试图标记目标完成。这会记录未解决的审查发现、追加一个 blocker story，并保持 Claude `/goal` 活跃。

## 局限

- Claude `/goal` 斜杠命令是会话级、会话内的指令。Shell 工具无法直接调用它、设置其条件或清除它。交接文本指示活跃 Claude 智能体在会话内自行完成。模型回传的快照被视作权威证明；WISE 仅验证快照、计划预期目标与所记录账本事件之间的文本一致性。
- 若未来 Claude 工具名变更（`/goal` → 其他），交接文本与快照字段名将需更新；核对逻辑本身与名称无关。
