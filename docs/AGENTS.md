<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-01-31 | Updated: 2026-02-24 -->

# docs

wise 的用户文档与技术指南。

## 目的

本目录包含面向终端用户与开发者的文档：

- **终端用户指南**：如何使用 wise 功能
- **技术参考**：架构、兼容、迁移
- **设计文档**：功能设计规格

## 关键文件

| 文件 | 描述 |
|------|-------------|
| `CLAUDE.md` | 终端用户编排指令（安装到用户项目） |
| `FEATURES.md` | 内部功能的开发者 API 参考 |
| `参考.md` | API 参考与配置选项 |
| `架构.md` | 系统架构概览 |
| `MIGRATION.md` | 版本迁移指南 |
| `COMPATIBILITY.md` | 兼容矩阵与要求 |
| `TIERED_AGENTS_V2.md` | 模型路由与分层智能体设计 |
| `DELEGATION-ENFORCER.md` | 委派协议文档 |
| `SYNC-SYSTEM.md` | 状态同步系统 |
| `ANALYTICS-SYSTEM.md` | 关于已移除分析子系统及当前监控替代方案的历史说明 |
| `本地插件安装.md` | 插件安装指南 |

## 子目录

| 目录 | 用途 |
|-----------|---------|
| `design/` | 功能设计规格 |

## 面向 AI 智能体

### 在本目录中工作

1. **以终端用户为中心**：CLAUDE.md 会安装到用户项目——为终端用户而非开发者编写
2. **保持链接可访问**：CLAUDE.md 中的链接使用原始 GitHub URL（智能体无法导航 GitHub UI）
3. **版本一致性**：发布时跨所有文档更新版本号

### 何时更新各文件

| 触发条件 | 需更新文件 |
|---------|---------------|
| 智能体数量或列表变更 | `参考.md`（智能体章节） |
| 技能数量或列表变更 | `参考.md`（技能章节） |
| hook 数量或列表变更 | `参考.md`（Hooks 系统章节） |
| 魔法关键词变更 | `参考.md`（魔法关键词章节） |
| 智能体工具分配变更 | `CLAUDE.md`（智能体工具矩阵） |
| 技能组合或架构变更 | `架构.md` |
| 新内部 API 或功能 | `FEATURES.md` |
| 破坏性变更或迁移 | `MIGRATION.md` |
| 分层智能体设计更新 | `TIERED_AGENTS_V2.md` |
| 平台或版本支持变更 | `COMPATIBILITY.md` |
| 终端用户指令变更 | `CLAUDE.md` |
| 重大面向用户功能 | `../README.md` |

### 测试要求

- 验证 markdown 正确渲染
- 检查所有内部链接可解析
- 验证文档中的代码示例

### 常见模式

#### 链接到原始内容

使用原始 GitHub URL 以保证外部可访问性：

[迁移指南](https://raw.githubusercontent.com/wise-claw/wise/main/docs/MIGRATION.md)

#### 版本引用

使用一致的版本标题格式，标题后留空行：

```markdown
## v3.8.17 Changes

- Feature A
- Feature B
```

## 依赖

### 内部

- 引用 `agents/` 中的智能体
- 引用 `skills/` 中的技能
- 引用 `src/tools/` 中的工具

### 外部

无——纯 markdown 文件。

<!-- MANUAL:
- When documenting `plan`/`ralplan`, include consensus structured deliberation (RALPLAN-DR) and note `--deliberate` high-risk mode behavior.
-->
