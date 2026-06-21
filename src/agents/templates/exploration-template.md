# 探索任务模板

当委派探索、研究或搜索任务时，使用此模板。

---

## 任务

[清晰、具体地描述需要探索或研究的内容]

示例：
- 查找 `UserService` 类的所有实现
- 研究代码库中身份验证是如何处理的
- 探索数据库模式与迁移历史

---

## 预期产出

[编排器期望收回的内容]

示例：
- 带行号的文件路径列表
- 发现的模式摘要
- 包含代码片段的结构化发现报告
- 基于发现给出的建议

---

## 背景

[用于引导探索的背景信息]

示例：
- 这是一个使用 pnpm workspaces 的 TypeScript monorepo
- 我们正在排查一个用户身份验证的 bug
- 团队此前使用基于类的服务，但正在迁移到函数式模式
- 重点关注 `src/auth` 和 `src/services` 目录下的文件

---

## 必须做

- 高效使用合适的搜索工具（Grep、Glob）
- 返回结构化、可操作的结果
- 包含文件路径和行号
- 标注发现的任何模式或异常
- [添加任务特定要求]

---

## 禁止做

- 不要修改任何文件
- 不要在无证据的情况下做假设
- 不要搜索 node_modules 或构建目录
- 不要返回未经分析的原始转储
- [添加任务特定约束]

---

## 所需技能

- 高效搜索与模式匹配
- 代码理解与分析
- 识别架构模式的能力
- [添加任务特定技能]

---

## 所需工具

- Grep 用于内容搜索
- Glob 用于文件模式匹配
- Read 用于查看具体文件
- [添加任务特定工具]

---

## 用法示例

```typescript
import { createDelegationPrompt } from '@/features/model-routing/prompts';

const prompt = createDelegationPrompt('LOW', '查找已弃用 API 的所有用法', {
  deliverables: '使用已弃用 API 的文件及行号列表',
  successCriteria: '完整列表，无误报',
  context: '我们正从 v1 迁移到 v2 API',
  mustDo: [
    '同时搜索新旧两种 API 模式',
    '按目录分组结果',
    '标注任何迁移进行中的模式'
  ],
  mustNotDo: [
    '不要搜索测试文件',
    '不要包含被注释掉的代码'
  ],
  requiredSkills: [
    '正则表达式模式匹配',
    '理解 API 版本化模式'
  ],
  requiredTools: [
    '支持正则的 Grep',
    '用于 TypeScript 文件的 Glob'
  ]
});
```
