# 原生团队 Worktree 模式

原生团队 worktree 模式是 `wise team` worker 在专用 git worktree 中运行的 opt-in 推进路径，同时保留一个由 leader 拥有的、团队专属的协调根。它面向 runtime-v2 团队会话，旨在使 worker 编辑隔离而不分散任务、mailbox、status 或 manifest 状态。

## 可用性

- 首批切片为 **opt-in / 配置门控**推进。不要假设 worktree 模式为默认行为。
- 目标运行时为 `runtime-v2`。Legacy `runtime.ts` 仍仅限于读取/status 与清理兼容，除非后续计划明确扩展。
- 无需新依赖；生命周期操作使用 git worktree 加现有团队 CLI/API 面。

## 工作区契约

worktree 模式激活时，WISE 使用如下稳定布局：

| 字段 | 契约 |
| --- | --- |
| Worktree 根 | `<repo>/.wise/team/<team-name>/worktrees/<worker-name>` |
| 团队专属协调根 | leader 工作区中的 `<repo>/.wise/state/team/<team-name>` |
| Worker cwd | 该 worker 的 `worktree_path` |
| Worker 协调 | `WISE_TEAM_STATE_ROOT` 指回团队专属、leader 拥有的协调根 |
| Worker 指令 | 安装 worktree 根 `AGENTS.md`，带备份/恢复保护 |

Worker 必须继续通过 `wise team api ...` 生命周期与 mailbox 操作访问团队专属协调根。当 `WISE_TEAM_STATE_ROOT` 可用时，它们不得在自身 worker worktree 内创建或修改独立的本地 `.wise/state`；对 worktree 支持的 worker，它应指向 `<repo>/.wise/state/team/<team-name>`。

## 持久化字段

配置、manifest、worker 身份与 status 面应暴露同一锁定字段集，使恢复/status/引导路径能推理 worker 位置而无需推断：

- `workspace_mode`
- `worktree_mode`
- `team_state_root`
- `working_dir`
- `worktree_repo_root`
- `worktree_path`
- `worktree_branch`
- `worktree_detached`
- `worktree_created`

`workspace_mode` 对 worktree 支持的会话应为 `worktree`，对现有共享工作区行为应为 `single`。`team_state_root` 指团队专属协调根（`<repo>/.wise/state/team/<team-name>`）；若未来功能需要更宽的 `.wise/state` 基路径，请使用单独命名的字段，如 `state_base_root`。

## 安全规则

- WISE 必须在 provision worktree 之前检查 leader 工作区。若 leader 仓库为 dirty，启动应拒绝 worktree provision，而非复制不安全的基础状态。
- 现有兼容的干净 worker worktree 可被复用。
- Dirty worker worktree 必须保留并以警告/事件形式暴露。清理不得强制移除 dirty worker 编辑。
- 分支/路径不匹配应失败，而非复用错误的工作区。
- 回滚可在安全时移除新建的干净 worktree 与运行时创建的分支；被复用的 worktree 保留。
- `orphan-cleanup` 是一个破坏性逃生舱口，可能删除 worktree 恢复元数据与根 `AGENTS.md` 备份。当此类证据存在时，调用方必须在手动保留或有意丢弃受影响的 worker worktree/备份之后，才传 `acknowledge_lost_worktree_recovery: true`。

## CLI 与 status 预期

`wise team status <team-name> --json` 应使工作区契约可观察。JSON 消费者应能在不直接读取私有文件的情况下找到 `workspace_mode`、`worktree_mode`、`team_state_root` 及各 worker 的 worktree 元数据。

人类可读 status 输出也应暴露模式与 worktree 路径/分支细节，足以让用户了解 worker 变更位于何处，以及清理是否保留了 dirty worktree。

## 变更验证清单

修改本区域时使用源 PRD/测试规格清单。变更至少应覆盖：

1. Worktree 规划禁用/no-op 与活跃路径模式。
2. 全新、复用、dirty 与不匹配的 worktree 生命周期情形。
3. runtime-v2 启动/派生状态：worker cwd、env、配置、manifest 与身份全部一致。
4. 引导提示与触发路径对 worktree 支持的 worker 使用 `$WISE_TEAM_STATE_ROOT`。
5. 扩容 worker 继承同一团队专属协调根与 worktree 指令策略。
6. 关闭/清理移除安全的干净 worktree、保留 dirty 的，并报告警告。
7. CLI 帮助/status 测试覆盖 opt-in 推进与锁定 status 字段集。

推荐的聚焦命令：

```bash
npm test -- --run src/team/__tests__/git-worktree.test.ts
npm test -- --run src/team/__tests__/worker-bootstrap.test.ts
npm test -- --run src/team/__tests__/runtime-v2.dispatch.test.ts
npm test -- --run src/team/__tests__/runtime-v2.shutdown.test.ts
npm test -- --run src/team/__tests__/api-interop.dispatch.test.ts
npm test -- --run src/team/__tests__/api-interop.cwd-resolution.test.ts
npm test -- --run src/team/__tests__/scaling-launch-config.test.ts
npm test -- --run src/cli/__tests__/team-runtime-boundary.test.ts
npm run build
```

## 评审说明

- 保持首批切片范围窄：runtime-v2 启动/派生/调度/扩容/恢复/status/关闭/清理加 legacy 读取/清理兼容。
- 不要通过省略 status 可见性、dirty-worktree 保留或团队专属协调根行为来缩小范围；这些是锁定契约的一部分。
- 优先使用显式持久化字段，而非从路径或分支名重建 worktree 状态。
