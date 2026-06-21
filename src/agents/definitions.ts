/**
 * Wise 的 Agent 定义
 *
 * 本模块提供：
 * 1. 从独立文件重新导出基础 agent
 * 2. 从 /agents/*.md 动态加载 prompt 的分层 agent 变体
 * 3. 用于 agent 注册表的 getAgentDefinitions()
 * 4. 主编排器的 wiseSystemPrompt
 */

import type { AgentConfig, PluginConfig } from '../shared/types.js';
import { loadAgentPrompt, parseDisallowedTools } from './utils.js';
import { loadConfig } from '../config/loader.js';
import { resolveInheritedModelFromEnv } from '../config/models.js';
import { appendSkininthegamebrosGuidance } from './skininthegamebros-guidance.js';

// 从独立文件重新导出基础 agent（重命名后）
export { architectAgent } from './architect.js';
export { designerAgent } from './designer.js';
export { writerAgent } from './writer.js';
export { criticAgent } from './critic.js';
export { analystAgent } from './analyst.js';
export { executorAgent } from './executor.js';
export { plannerAgent } from './planner.js';
export { qaTesterAgent } from './qa-tester.js';
export { scientistAgent } from './scientist.js';
export { exploreAgent } from './explore.js';
export { tracerAgent } from './tracer.js';

export { documentSpecialistAgent } from './document-specialist.js';

// 导入基础 agent 以供 getAgentDefinitions 使用
import { architectAgent } from './architect.js';
import { designerAgent } from './designer.js';
import { writerAgent } from './writer.js';
import { criticAgent } from './critic.js';
import { analystAgent } from './analyst.js';
import { executorAgent } from './executor.js';
import { plannerAgent } from './planner.js';
import { qaTesterAgent } from './qa-tester.js';
import { scientistAgent } from './scientist.js';
import { exploreAgent } from './explore.js';
import { tracerAgent } from './tracer.js';
import { documentSpecialistAgent } from './document-specialist.js';

// 重新导出 loadAgentPrompt（亦从 index.ts 导出）
export { loadAgentPrompt };

// ============================================================
// 改良后的 agent（构建/分析通道）
// ============================================================

/**
 * Debugger Agent - 根因分析与调试（Sonnet）
 */
export const debuggerAgent: AgentConfig = {
  name: 'debugger',
  description: '根因分析、回归隔离、故障诊断（Sonnet）。',
  prompt: loadAgentPrompt('debugger'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

/**
 * Verifier Agent - 完成证据与测试校验（Sonnet）
 */
export const verifierAgent: AgentConfig = {
  name: 'verifier',
  description: '完成证据、声明校验、测试充分性（Sonnet）。',
  prompt: loadAgentPrompt('verifier'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

// ============================================================
// 改良后的 agent（评审通道）
// ============================================================

// ============================================================
// 改良后的 agent（领域专家）
// ============================================================

/**
 * Test-Engineer Agent - 测试策略与覆盖率（Sonnet）
 * 替代：tdd-guide agent
 */
export const testEngineerAgent: AgentConfig = {
  name: 'test-engineer',
  description: '测试策略、覆盖率、不稳定测试加固（Sonnet）。',
  prompt: loadAgentPrompt('test-engineer'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

// ============================================================
// 专用 agent（安全、构建、TDD、代码评审）
// ============================================================

/**
 * Security-Reviewer Agent - 安全漏洞检测（Sonnet）
 */
export const securityReviewerAgent: AgentConfig = {
  name: 'security-reviewer',
  description: '安全漏洞检测专家（Sonnet）。用于安全审计与 OWASP 检测。',
  prompt: loadAgentPrompt('security-reviewer'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

/**
 * Code-Reviewer Agent - 专家级代码评审（Opus）
 */
export const codeReviewerAgent: AgentConfig = {
  name: 'code-reviewer',
  description: '专家级代码评审专家（Opus）。用于全面的代码质量评审。',
  prompt: loadAgentPrompt('code-reviewer'),
  model: 'opus',
  defaultModel: 'opus'
};


/**
 * Git-Master Agent - Git 操作专家（Sonnet）
 */
export const gitMasterAgent: AgentConfig = {
  name: 'git-master',
  description: 'Git 专家，负责原子化提交、变基、历史管理及风格检测',
  prompt: loadAgentPrompt('git-master'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

/**
 * Code-Simplifier Agent - 代码简化与重构（Opus）
 */
export const codeSimplifierAgent: AgentConfig = {
  name: 'code-simplifier',
  description: '为清晰度、一致性与可维护性而简化与精炼代码（Opus）。',
  prompt: loadAgentPrompt('code-simplifier'),
  model: 'opus',
  defaultModel: 'opus'
};

// ============================================================
// 已废弃别名（向后兼容）
// ============================================================

/**
 * @deprecated 改用 test-engineer agent
 */
export const tddGuideAgentAlias = testEngineerAgent;

const AGENT_CONFIG_KEY_MAP = {
  explore: 'explore',
  analyst: 'analyst',
  planner: 'planner',
  architect: 'architect',
  debugger: 'debugger',
  executor: 'executor',
  verifier: 'verifier',
  'security-reviewer': 'securityReviewer',
  'code-reviewer': 'codeReviewer',
  'test-engineer': 'testEngineer',
  designer: 'designer',
  writer: 'writer',
  'qa-tester': 'qaTester',
  scientist: 'scientist',
  tracer: 'tracer',
  'git-master': 'gitMaster',
  'code-simplifier': 'codeSimplifier',
  critic: 'critic',
  'document-specialist': 'documentSpecialist',
} as const satisfies Partial<Record<string, keyof NonNullable<PluginConfig['agents']>>>;

function getConfiguredAgentModel(name: string, config: PluginConfig): string | undefined {
  const key = AGENT_CONFIG_KEY_MAP[name as keyof typeof AGENT_CONFIG_KEY_MAP];
  return key ? config.agents?.[key]?.model : undefined;
}

// ============================================================
// AGENT 注册表
// ============================================================

/**
 * Agent 角色消歧
 *
 * HIGH 档位的评审/规划 agent 拥有各自独立、不重叠的角色：
 *
 * | Agent | 角色 | 职责 | 不负责 |
 * |-------|------|--------------|-------------------|
 * | architect | 代码分析 | 分析代码、调试、校验 | 需求、计划创建、计划评审 |
 * | analyst | 需求分析 | 发现需求缺口 | 代码分析、规划、计划评审 |
 * | planner | 计划创建 | 创建工作计划 | 需求、代码分析、计划评审 |
 * | critic | 计划评审 | 评审计划质量 | 需求、代码分析、计划创建 |
 *
 * 工作流：explore → analyst → planner → critic → executor → architect（校验）
 */

/**
 * 以 record 形式获取全部 agent 定义，供 Claude Agent SDK 使用
 */
export function getAgentDefinitions(options?: {
  overrides?: Partial<Record<string, Partial<AgentConfig>>>;
  config?: PluginConfig;
}): Record<string, {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  defaultModel?: string;
}> {
  const agents: Record<string, AgentConfig> = {
    // ============================================================
    // 构建/分析通道
    // ============================================================
    explore: exploreAgent,
    analyst: analystAgent,
    planner: plannerAgent,
    architect: architectAgent,
    debugger: debuggerAgent,
    executor: executorAgent,
    verifier: verifierAgent,

    // ============================================================
    // 评审通道
    // ============================================================
    'security-reviewer': securityReviewerAgent,
    'code-reviewer': codeReviewerAgent,

    // ============================================================
    // 领域专家
    // ============================================================
    'test-engineer': testEngineerAgent,
    designer: designerAgent,
    writer: writerAgent,
    'qa-tester': qaTesterAgent,
    scientist: scientistAgent,
    tracer: tracerAgent,
    'git-master': gitMasterAgent,
    'code-simplifier': codeSimplifierAgent,

    // ============================================================
    // 协调
    // ============================================================
    critic: criticAgent,

    // ============================================================
    // 向后兼容（已废弃）
    // ============================================================
    'document-specialist': documentSpecialistAgent
  };

  const resolvedConfig = options?.config ?? loadConfig();
  const inheritModel = resolvedConfig.routing?.forceInherit
    ? resolveInheritedModelFromEnv()
    : undefined;
  const result: Record<string, { description: string; prompt: string; tools?: string[]; disallowedTools?: string[]; model?: string; defaultModel?: string }> = {};

  for (const [name, agentConfig] of Object.entries(agents)) {
    const override = options?.overrides?.[name];
    const configuredModel = getConfiguredAgentModel(name, resolvedConfig);
    const disallowedTools = agentConfig.disallowedTools ?? parseDisallowedTools(name);
    const resolvedModel = override?.model ?? inheritModel ?? configuredModel ?? agentConfig.model;
    const resolvedDefaultModel = override?.defaultModel ?? agentConfig.defaultModel;

    result[name] = {
      description: override?.description ?? agentConfig.description,
      prompt: appendSkininthegamebrosGuidance(
        override?.prompt ?? agentConfig.prompt,
        'agent',
      ),
      tools: override?.tools ?? agentConfig.tools,
      disallowedTools,
      model: resolvedModel,
      defaultModel: resolvedDefaultModel,
    };
  }

  return result;
}

// ============================================================
// WISE 系统 PROMPT
// ============================================================

/**
 * WISE 系统 Prompt - 主编排器
 */
export const wiseSystemPrompt = `你是一个多 agent 开发系统的不懈编排器。

## 不懈执行

你被任务列表所约束。你不停止。你不放弃。你不休息。工作持续进行，直到每一项任务都完成。

## 你的核心职责
你协调专门的子 agent 来完成复杂的软件工程任务。中途放弃工作不是选项。如果你在没有完成所有任务的情况下停止，你就失败了。

## 可用子 agent（19 个 agent）

### 构建/分析通道
- **explore**: 内部代码库发现（haiku）— 快速模式匹配
- **analyst**: 需求清晰度（opus）— 隐藏约束分析
- **planner**: 任务排序（opus）— 执行计划与风险标记
- **architect**: 系统设计（opus）— 边界、接口、权衡
- **debugger**: 根因分析 + 构建错误修复（sonnet）— 回归隔离、诊断、类型/编译错误
- **executor**: 代码实现（sonnet）— 功能、重构、自主复杂任务（复杂的多文件变更使用 model=opus）
- **verifier**: 完成校验（sonnet）— 证据、声明、测试充分性
- **tracer**: 证据驱动的因果追踪（sonnet）— 竞争假设、支持/反对证据、下一步探查

### 评审通道
- **security-reviewer**: 安全审计（sonnet）— 漏洞、信任边界、authn/authz
- **code-reviewer**: 全面评审（opus）— API 契约、版本管理、向后兼容、逻辑缺陷、可维护性、反模式、性能、质量策略

### 领域专家
- **test-engineer**: 测试策略（sonnet）— 覆盖率、不稳定测试加固
- **designer**: UI/UX 架构（sonnet）— 交互设计
- **writer**: 文档（haiku）— 文档、迁移说明
- **qa-tester**: CLI 测试（sonnet）— 通过 tmux 进行交互式运行时校验
- **scientist**: 数据分析（sonnet）— 统计与研究
- **git-master**: Git 操作（sonnet）— 提交、变基、历史
- **document-specialist**: 外部文档与参考查找（sonnet）— SDK/API/包研究
- **code-simplifier**: 代码清晰度（opus）— 简化与可维护性

### 协调
- **critic**: 计划评审 + 彻底的缺口分析（opus）— 关键挑战、多视角调查、结构化的"缺失什么"分析

### 已废弃别名
- **api-reviewer** → code-reviewer
- **performance-reviewer** → code-reviewer
- **quality-reviewer** → code-reviewer
- **quality-strategist** → code-reviewer
- **dependency-expert** → document-specialist
- **researcher** → document-specialist
- **tdd-guide** → test-engineer
- **deep-executor** → executor
- **build-fixer** → debugger
- **harsh-critic** → critic

## 编排原则
1. **积极委派**: 为专门任务派出子 agent — 不要什么都自己做
2. **无情并行**: 只要任务相互独立，就并发启动多个子 agent
3. **坚持不懈地持续**: 持续到所有任务被校验完成 — 停止前检查你的待办列表
4. **沟通进展**: 让用户知情，但不要在该工作时停下来解释
5. **彻底校验**: 测试、检查、校验 — 然后再校验一次

## agent 组合

### architect + qa-tester（诊断 -> 校验循环）
用于调试 CLI 应用与服务：
1. **architect** 诊断问题，提供根因分析
2. **architect** 输出测试计划，包含具体命令与预期输出
3. **qa-tester** 在 tmux 中执行测试计划，捕获真实输出
4. 若校验失败，将结果反馈给 architect 重新诊断
5. 重复直到校验通过

这是任何需要运行实际服务来校验的 bug 的推荐工作流。

### 校验指引（为 token 效率设门控）

**校验优先级顺序：**
1. **现有测试**（运行项目的测试命令）— 首选，最便宜
2. **直接命令**（curl、简单 CLI）— 便宜
3. **qa-tester**（tmux 会话）— 昂贵，谨慎使用

**何时使用 qa-tester：**
- 没有测试套件覆盖该行为
- 需要交互式 CLI 输入/输出模拟
- 需要服务启动/关闭测试
- 流式/实时行为校验

**何时不要使用 qa-tester：**
- 项目有覆盖该功能的测试 -> 运行测试
- 简单命令校验 -> 直接运行
- 静态代码分析 -> 使用 architect

## 工作流
1. 分析用户请求，并使用 TodoWrite 将其拆解为任务
2. 将第一个任务标记为 in_progress 并开始工作
3. 根据任务类型委派给合适的子 agent
4. 协调结果并处理任何问题，不停止
5. 仅在校验通过后才将任务标记为完成
6. 循环回到第 2 步，直到所有任务显示为 'completed'
7. 最终校验：重新读取待办列表，确认 100% 完成
8. 只有那时你才可以休息

## 关键规则 — 违规即失败

1. **绝不带着未完成的工作停止** — 如果你的待办列表有 pending/in_progress 项，你还没完成
2. **总是校验** — 在任何尝试结束之前检查你的待办列表
3. **不做过早结论** — 没有校验就说"我已完成任务"是谎言
4. **并行执行** — 尽可能使用以提升速度
5. **持续进展** — 报告进展但继续工作
6. **遇阻时解阻** — 不要因为某事困难就停止；寻找另一条路
7. **仅必要时询问** — 澄清问题用于消除歧义，而非用于逃避工作

## 完成清单
在结束之前，你必须校验：
- [ ] 每一项待办都标记为 'completed'
- [ ] 所有请求的功能都已实现
- [ ] 测试通过（如适用）
- [ ] 没有未解决的错误残留
- [ ] 用户的原始请求被完全满足

如果任何复选框未勾选，你还没完成。继续工作。`;
