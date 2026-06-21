# 实现任务模板

当委派代码实现、重构或修改任务时，使用此模板。

---

## 任务

[清晰、具体地描述需要实现的内容]

示例：
- 为支付处理服务添加错误处理
- 重构 UserController 以使用依赖注入
- 为博客文章 API 端点实现分页
- 为配置模块添加 TypeScript 类型定义

---

## 预期产出

[编排器期望收回的内容]

示例：
- 可运行的实现及测试
- 遵循项目模式的重构代码
- 添加了恰当错误处理的更新文件
- 新功能的文档
- 所做变更的摘要

---

## 背景

[用于引导实现的背景信息]

示例：
- 本项目使用 Express.js 与 TypeScript
- 遵循 `src/repositories` 中已有的仓库模式
- 错误处理应使用自定义的 `AppError` 类
- 所有公开 API 应有 JSDoc 注释
- 团队偏好函数式编程风格而非类

---

## 必须做

- 遵循现有代码模式与约定
- 添加恰当的错误处理
- 为所有新代码包含 TypeScript 类型
- 为修改的功能编写或更新测试
- 确保向后兼容
- 运行 linter 并修复所有警告
- [添加任务特定要求]

---

## 禁止做

- 不要修改无关文件
- 不要在未经批准的情况下引入破坏性变更
- 不要跳过类型定义
- 不要提交被注释掉的代码
- 不要删除已有测试
- [添加任务特定约束]

---

## 所需技能

- 熟练掌握 TypeScript/JavaScript
- 理解项目架构
- 能够遵循现有模式
- 测试驱动开发的思维方式
- [添加任务特定技能]

---

## 所需工具

- Read 用于查看现有代码
- Edit 用于进行修改
- Write 用于创建新文件
- Bash 用于运行测试和构建
- [添加任务特定工具]

---

## 用法示例

```typescript
import { createDelegationPrompt } from '@/features/model-routing/prompts';

const prompt = createDelegationPrompt('MEDIUM', '添加限流中间件', {
  deliverables: '集成到 Express 应用并附带测试的限流中间件',
  successCriteria: '所有测试通过，限流被正确执行，无破坏性变更',
  context: `
    使用 TypeScript 的 Express.js API
    现有中间件位于 src/middleware/
    使用 express-rate-limit 库（已安装）
    应用限流：每个 IP 每 15 分钟 100 次请求
  `,
  mustDo: [
    '在 src/middleware/rate-limit.ts 中创建中间件',
    '应用到 src/routes/index.ts 中的所有 API 路由',
    '通过环境变量添加配置选项',
    '在 src/middleware/__tests__/rate-limit.test.ts 中编写单元测试',
    '添加 JSDoc 文档',
    '更新 README 中的限流说明'
  ],
  mustNotDo: [
    '不要修改现有路由处理器',
    '不要硬编码限流值',
    '不要破坏现有测试',
    '不要在未检查的情况下添加依赖'
  ],
  requiredSkills: [
    'Express.js 中间件模式',
    'TypeScript 类型定义',
    'Jest 测试框架',
    '环境变量配置'
  ],
  requiredTools: [
    'Read 用于查看现有中间件',
    'Edit 用于修改路由配置',
    'Write 用于创建新中间件文件',
    'Bash 用于运行测试（npm test）'
  ]
});
```

---

## 验证检查清单

在将任务标记为完成前，确保：

- [ ] 代码编译无 TypeScript 错误
- [ ] 所有测试通过（包括已有测试）
- [ ] Linter 通过且无警告
- [ ] 代码遵循项目约定
- [ ] 所有新代码都有恰当的类型
- [ ] 公开 API 有文档
- [ ] 没有遗留 console.log 或调试代码
- [ ] 已审查 Git diff 以排除意外变更
