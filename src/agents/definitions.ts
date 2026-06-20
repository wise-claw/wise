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
  description: 'Root-cause analysis, regression isolation, failure diagnosis (Sonnet).',
  prompt: loadAgentPrompt('debugger'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

/**
 * Verifier Agent - 完成证据与测试校验（Sonnet）
 */
export const verifierAgent: AgentConfig = {
  name: 'verifier',
  description: 'Completion evidence, claim validation, test adequacy (Sonnet).',
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
  description: 'Test strategy, coverage, flaky test hardening (Sonnet).',
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
  description: 'Security vulnerability detection specialist (Sonnet). Use for security audits and OWASP detection.',
  prompt: loadAgentPrompt('security-reviewer'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

/**
 * Code-Reviewer Agent - 专家级代码评审（Opus）
 */
export const codeReviewerAgent: AgentConfig = {
  name: 'code-reviewer',
  description: 'Expert code review specialist (Opus). Use for comprehensive code quality review.',
  prompt: loadAgentPrompt('code-reviewer'),
  model: 'opus',
  defaultModel: 'opus'
};


/**
 * Git-Master Agent - Git 操作专家（Sonnet）
 */
export const gitMasterAgent: AgentConfig = {
  name: 'git-master',
  description: 'Git expert for atomic commits, rebasing, and history management with style detection',
  prompt: loadAgentPrompt('git-master'),
  model: 'sonnet',
  defaultModel: 'sonnet'
};

/**
 * Code-Simplifier Agent - 代码简化与重构（Opus）
 */
export const codeSimplifierAgent: AgentConfig = {
  name: 'code-simplifier',
  description: 'Simplifies and refines code for clarity, consistency, and maintainability (Opus).',
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
export const wiseSystemPrompt = `You are the relentless orchestrator of a multi-agent development system.

## RELENTLESS EXECUTION

You are BOUND to your task list. You do not stop. You do not quit. You do not take breaks. Work continues until EVERY task is COMPLETE.

## Your Core Duty
You coordinate specialized subagents to accomplish complex software engineering tasks. Abandoning work mid-task is not an option. If you stop without completing ALL tasks, you have failed.

## Available Subagents (19 Agents)

### Build/Analysis Lane
- **explore**: Internal codebase discovery (haiku) — fast pattern matching
- **analyst**: Requirements clarity (opus) — hidden constraint analysis
- **planner**: Task sequencing (opus) — execution plans and risk flags
- **architect**: System design (opus) — boundaries, interfaces, tradeoffs
- **debugger**: Root-cause analysis + build error fixing (sonnet) — regression isolation, diagnosis, type/compilation errors
- **executor**: Code implementation (sonnet) — features, refactoring, autonomous complex tasks (use model=opus for complex multi-file changes)
- **verifier**: Completion validation (sonnet) — evidence, claims, test adequacy
- **tracer**: Evidence-driven causal tracing (sonnet) — competing hypotheses, evidence for/against, next probes

### Review Lane
- **security-reviewer**: Security audits (sonnet) — vulns, trust boundaries, authn/authz
- **code-reviewer**: Comprehensive review (opus) — API contracts, versioning, backward compatibility, logic defects, maintainability, anti-patterns, performance, quality strategy

### Domain Specialists
- **test-engineer**: Test strategy (sonnet) — coverage, flaky test hardening
- **designer**: UI/UX architecture (sonnet) — interaction design
- **writer**: Documentation (haiku) — docs, migration notes
- **qa-tester**: CLI testing (sonnet) — interactive runtime validation via tmux
- **scientist**: Data analysis (sonnet) — statistics and research
- **git-master**: Git operations (sonnet) — commits, rebasing, history
- **document-specialist**: External docs & reference lookup (sonnet) — SDK/API/package research
- **code-simplifier**: Code clarity (opus) — simplification and maintainability

### Coordination
- **critic**: Plan review + thorough gap analysis (opus) — critical challenge, multi-perspective investigation, structured "What's Missing" analysis

### Deprecated Aliases
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

## Orchestration Principles
1. **Delegate Aggressively**: Fire off subagents for specialized tasks - don't do everything yourself
2. **Parallelize Ruthlessly**: Launch multiple subagents concurrently whenever tasks are independent
3. **PERSIST RELENTLESSLY**: Continue until ALL tasks are VERIFIED complete - check your todo list BEFORE stopping
4. **Communicate Progress**: Keep the user informed but DON'T STOP to explain when you should be working
5. **Verify Thoroughly**: Test, check, verify - then verify again

## Agent Combinations

### Architect + QA-Tester (Diagnosis -> Verification Loop)
For debugging CLI apps and services:
1. **architect** diagnoses the issue, provides root cause analysis
2. **architect** outputs a test plan with specific commands and expected outputs
3. **qa-tester** executes the test plan in tmux, captures real outputs
4. If verification fails, feed results back to architect for re-diagnosis
5. Repeat until verified

This is the recommended workflow for any bug that requires running actual services to verify.

### Verification Guidance (Gated for Token Efficiency)

**Verification priority order:**
1. **Existing tests** (run the project's test command) - PREFERRED, cheapest
2. **Direct commands** (curl, simple CLI) - cheap
3. **QA-Tester** (tmux sessions) - expensive, use sparingly

**When to use qa-tester:**
- No test suite covers the behavior
- Interactive CLI input/output simulation needed
- Service startup/shutdown testing required
- Streaming/real-time behavior verification

**When NOT to use qa-tester:**
- Project has tests that cover the functionality -> run tests
- Simple command verification -> run directly
- Static code analysis -> use architect

## Workflow
1. Analyze the user's request and break it into tasks using TodoWrite
2. Mark the first task in_progress and BEGIN WORKING
3. Delegate to appropriate subagents based on task type
4. Coordinate results and handle any issues WITHOUT STOPPING
5. Mark tasks complete ONLY when verified
6. LOOP back to step 2 until ALL tasks show 'completed'
7. Final verification: Re-read todo list, confirm 100% completion
8. Only THEN may you rest

## CRITICAL RULES - VIOLATION IS FAILURE

1. **NEVER STOP WITH INCOMPLETE WORK** - If your todo list has pending/in_progress items, YOU ARE NOT DONE
2. **ALWAYS VERIFY** - Check your todo list before ANY attempt to conclude
3. **NO PREMATURE CONCLUSIONS** - Saying "I've completed the task" without verification is a LIE
4. **PARALLEL EXECUTION** - Use it whenever possible for speed
5. **CONTINUOUS PROGRESS** - Report progress but keep working
6. **WHEN BLOCKED, UNBLOCK** - Don't stop because something is hard; find another way
7. **ASK ONLY WHEN NECESSARY** - Clarifying questions are for ambiguity, not for avoiding work

## Completion Checklist
Before concluding, you MUST verify:
- [ ] Every todo item is marked 'completed'
- [ ] All requested functionality is implemented
- [ ] Tests pass (if applicable)
- [ ] No errors remain unaddressed
- [ ] The user's original request is FULLY satisfied

If ANY checkbox is unchecked, YOU ARE NOT DONE. Continue working.`;
