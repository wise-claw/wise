# 智能体提示词模板

本目录包含用于创建智能体提示词的可复用模板，减少跨层级的重复。

## 文件

- **base-agent.md**：带注入点的核心模板结构
- **tier-instructions.md**：层级特定行为指令（LOW/MEDIUM/HIGH）
- **README.md**：本文件 — 使用指南

## 模板系统

### 注入点

模板使用以下占位符：

| 占位符 | 说明 | 示例 |
|-------------|-------------|---------|
| `{{AGENT_NAME}}` | 智能体标识符 | `executor-low`, `architect-medium` |
| `{{ROLE_DESCRIPTION}}` | 此智能体的职责 | "You execute simple code changes..." |
| `{{TIER_INSTRUCTIONS}}` | 层级特定行为 | LOW/MEDIUM/HIGH 指令 |
| `{{TASK_SPECIFIC_INSTRUCTIONS}}` | 智能体特定协议 | "When fixing bugs, always add tests" |
| `{{EXPECTED_DELIVERABLES}}` | 输出内容 | "Modified files + test results" |

### 用法

1. **复制基础模板**：
   ```bash
   cp agents/templates/base-agent.md agents/my-new-agent.md
   ```

2. **替换占位符**：
   - 将 `{{AGENT_NAME}}` 设为你的智能体名
   - 编写特定于你智能体的 `{{ROLE_DESCRIPTION}}`
   - 从 `tier-instructions.md` 复制合适的层级指令
   - 添加此智能体独有的 `{{TASK_SPECIFIC_INSTRUCTIONS}}`
   - 定义 `{{EXPECTED_DELIVERABLES}}`

3. **审查通用协议**：
   - 基础模板包含共享的验证与工具使用协议
   - 这些适用于所有智能体，无需修改
   - 仅当你的智能体需要额外协议时才扩展

### 示例：创建 executor-low

```markdown
# executor-low

## Role
You execute simple, well-defined code changes quickly and efficiently. Handle single-file modifications, small bug fixes, and straightforward feature additions.

## Tier-Specific Instructions
**Tier: LOW (Haiku) - Speed-Focused Execution**

- Focus on speed and direct execution
- Handle simple, well-defined tasks only
- Limit exploration to 5 files maximum
- Escalate to executor (MEDIUM) if:
  - Task requires analyzing more than 5 files
  - Complexity is higher than expected
  - Architectural decisions needed
- Prefer straightforward solutions over clever ones
- Skip deep investigation - implement what's asked

## Common Protocol
[... standard protocol from base-agent.md ...]

## Task Execution
- Read the target file first
- Make the requested changes
- Run lsp_diagnostics on changed files
- Verify changes compile/pass basic checks

## Deliverables
- Modified file(s)
- lsp_diagnostics output showing no new errors
- Brief summary of changes made
```

## 收益

1. **一致性**：所有智能体遵循相同的验证协议
2. **可维护性**：在一处更新通用协议
3. **清晰性**：层级与角色特定指令明确分离
4. **可扩展性**：易于新增智能体或层级

## 最佳实践

- **除非绝对必要，不要覆盖通用协议**
- **角色描述要具体** — 避免使用「处理任务」等模糊措辞
- **记录上报路径** — 此智能体何时应调用另一个？
- **有帮助时在任务特定指令中包含示例**
- **保持层级指令纯粹** — 仅能力/范围指引，不含角色特定行为

## 层级选择指南

| 层级 | 模型 | Token 成本 | 何时使用 |
|------|-------|------------|----------|
| LOW | Haiku | $ | 任务简单、定义明确、<5 文件 |
| MEDIUM | Sonnet | $$ | 任务需要调研、<20 文件 |
| HIGH | Opus | $$$ | 任务复杂、架构性、不限文件数 |

## 未来增强

模板系统的潜在补充：

- 领域特定模板（前端、后端、数据等）
- 专用智能体的组合模板
- 自动化模板校验
- 模板生成 CLI 工具
