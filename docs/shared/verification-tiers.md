# 验证层级

验证随任务复杂度伸缩，以在保持质量的同时优化成本。

## 层级定义

| 层级 | 标准 | 智能体 | 模型 | 所需证据 |
|------|----------|-------|-------|-------------------|
| **LIGHT** | <5 文件，<100 行，完整测试覆盖 | architect-low | haiku | lsp_diagnostics 无问题 |
| **STANDARD** | 默认（非 LIGHT 或 THOROUGH） | architect-medium | sonnet | 诊断 + build 通过 |
| **THOROUGH** | >20 文件或架构/安全变更 | architect | opus | 完整审查 + 全部测试 |

## 选择接口

```typescript
interface ChangeMetadata {
  filesChanged: number;
  linesChanged: number;
  hasArchitecturalChanges: boolean;
  hasSecurityImplications: boolean;
  testCoverage: 'none' | 'partial' | 'full';
}

type VerificationTier = 'LIGHT' | 'STANDARD' | 'THOROUGH';
```

## 选择逻辑

```
IF hasSecurityImplications OR hasArchitecturalChanges:
  → THOROUGH（安全/架构始终如此）
ELIF filesChanged > 20:
  → THOROUGH（大范围）
ELIF filesChanged < 5 AND linesChanged < 100 AND testCoverage === 'full':
  → LIGHT（小而充分测试）
ELSE:
  → STANDARD（默认）
```

## 覆盖触发器

覆盖自动检测的用户关键词：

| 关键词 | 强制层级 |
|---------|-------------|
| "thorough", "careful", "important", "critical" | THOROUGH |
| "quick", "simple", "trivial", "minor" | LIGHT |
| 安全相关文件变更 | THOROUGH（始终） |

## 架构变更检测

触发 `hasArchitecturalChanges` 的文件：
- `**/config.{ts,js,json}`
- `**/schema.{ts,prisma,sql}`
- `**/definitions.ts`
- `**/types.ts`
- `package.json`
- `tsconfig.json`

## 安全影响检测

触发 `hasSecurityImplications` 的路径模式：
- `**/auth/**`
- `**/security/**`
- `**/permissions?.{ts,js}`
- `**/credentials?.{ts,js,json}`
- `**/secrets?.{ts,js,json,yml,yaml}`
- `**/tokens?.{ts,js,json}`
- `**/passwords?.{ts,js,json}`
- `**/oauth*`
- `**/jwt*`
- `**/.env*`

## 证据类型

不同声明类型所需的证据：

| 声明 | 所需证据 |
|-------|-------------------|
| 「已修复」 | 显示现在通过的测试 |
| 「已实现」 | lsp_diagnostics 无问题 + build 通过 |
| 「已重构」 | 所有测试仍通过 |
| 「已调试」 | 以 file:line 定位根因 |

## 成本对比

| 层级 | 相对成本 | 用例 |
|------|---------------|----------|
| LIGHT | 1x | 带测试的单文件 bug 修复 |
| STANDARD | 5x | 多文件功能新增 |
| THOROUGH | 20x | 重大重构、安全变更 |

预估节约：使用层级系统相比始终使用 THOROUGH，验证成本降低约 40%。

## 在模式中使用

所有持久化模式（ralph、autopilot）在派生验证智能体前应使用 tier-selector：

```typescript
import { selectVerificationTier, getVerificationAgent } from '../verification/tier-selector';

const tier = selectVerificationTier(changeMetadata);
const { agent, model } = getVerificationAgent(tier);

// Spawn appropriate verification agent
Task(subagent_type=`wise:${agent}`, model, prompt="Verify...")
```
