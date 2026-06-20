/**
 * Prompt 分节构建器 —— 动态生成编排器 Prompt
 *
 * 本模块提供函数，从 agent 元数据动态构建编排器 prompt 的各个分节。
 * 新增 agent 会自动更新编排器。
 */

import type { AgentConfig, AgentCategory } from '../types.js';

/**
 * 构建包含编排器核心身份的头部小节
 */
export function buildHeader(): string {
  return `You are the relentless orchestrator of a multi-agent development system.

## RELENTLESS EXECUTION

You are BOUND to your task list. You do not stop. You do not quit. You do not take breaks. Work continues until EVERY task is COMPLETE.

## Your Core Duty
You coordinate specialized subagents to accomplish complex software engineering tasks. Abandoning work mid-task is not an option. If you stop without completing ALL tasks, you have failed.`;
}

/**
 * 构建带描述的 agent 注册表小节
 */
export function buildAgentRegistry(agents: AgentConfig[]): string {
  const lines: string[] = ['## Available Subagents', ''];

  // 按 tier 分组 agent（基础与变体）
  const baseAgents = agents.filter(a => !a.name.includes('-'));
  const tieredAgents = agents.filter(a => a.name.includes('-'));

  // 基础 agents
  if (baseAgents.length > 0) {
    lines.push('### Primary Agents');
    for (const agent of baseAgents) {
      const modelInfo = agent.model ? ` (${agent.model})` : '';
      lines.push(`- **${agent.name}**${modelInfo}: ${agent.description}`);
    }
    lines.push('');
  }

  // 分层变体
  if (tieredAgents.length > 0) {
    lines.push('### Tiered Variants');
    lines.push('Use tiered variants for smart model routing based on task complexity:');
    lines.push('- **HIGH tier (opus)**: Complex analysis, architecture, debugging');
    lines.push('- **MEDIUM tier (sonnet)**: Standard tasks, moderate complexity');
    lines.push('- **LOW tier (haiku)**: Simple lookups, trivial operations');
    lines.push('');

    for (const agent of tieredAgents) {
      const modelInfo = agent.model ? ` (${agent.model})` : '';
      lines.push(`- **${agent.name}**${modelInfo}: ${agent.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 构建触发条件表，展示每个 agent 的使用时机
 */
export function buildTriggerTable(agents: AgentConfig[]): string {
  const lines: string[] = ['## Key Triggers', ''];

  // 过滤带 metadata triggers 的 agents
  const agentsWithTriggers = agents.filter(a => a.metadata?.triggers && a.metadata.triggers.length > 0);

  if (agentsWithTriggers.length === 0) {
    return '';
  }

  lines.push('| Agent | Domain | Trigger Condition |');
  lines.push('|-------|--------|------------------|');

  for (const agent of agentsWithTriggers) {
    const triggers = agent.metadata?.triggers ?? [];
    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      const agentName = i === 0 ? `**${agent.name}**` : '';
      lines.push(`| ${agentName} | ${trigger.domain} | ${trigger.trigger} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 构建工具选择指引小节
 */
export function buildToolSelectionSection(agents: AgentConfig[]): string {
  const lines: string[] = ['## Tool Selection Guidance', ''];

  // 按类别分组
  const categorizedAgents = new Map<AgentCategory, AgentConfig[]>();
  for (const agent of agents) {
    const category = agent.metadata?.category || 'utility';
    if (!categorizedAgents.has(category)) {
      categorizedAgents.set(category, []);
    }
    const arr = categorizedAgents.get(category);
    if (arr) arr.push(agent);
  }

  for (const [category, categoryAgents] of categorizedAgents) {
    lines.push(`### ${capitalizeFirst(category)} Agents`);
    for (const agent of categoryAgents) {
      lines.push(`**${agent.name}** (${agent.model || 'sonnet'}):`);
      if (agent.tools?.length) {
        lines.push(`- Tools: ${agent.tools.join(', ')}`);
      }

      if (agent.metadata?.useWhen && agent.metadata.useWhen.length > 0) {
        lines.push(`- Use when: ${agent.metadata.useWhen.join('; ')}`);
      }

      if (agent.metadata?.avoidWhen && agent.metadata.avoidWhen.length > 0) {
        lines.push(`- Avoid when: ${agent.metadata.avoidWhen.join('; ')}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 构建委派矩阵/指引表
 */
export function buildDelegationMatrix(agents: AgentConfig[]): string {
  const lines: string[] = ['## Delegation Guide', ''];

  // 按类别分组
  const categorizedAgents = new Map<AgentCategory, AgentConfig[]>();
  for (const agent of agents) {
    const category = agent.metadata?.category || 'utility';
    if (!categorizedAgents.has(category)) {
      categorizedAgents.set(category, []);
    }
    const arr = categorizedAgents.get(category);
    if (arr) arr.push(agent);
  }

  lines.push('| Category | Agent | Model | Use Case |');
  lines.push('|----------|-------|-------|----------|');

  for (const [category, categoryAgents] of categorizedAgents) {
    const categoryName = capitalizeFirst(category);
    for (let i = 0; i < categoryAgents.length; i++) {
      const agent = categoryAgents[i];
      const catDisplay = i === 0 ? categoryName : '';
      const model = agent.model || 'sonnet';
      const useCase = agent.metadata?.useWhen?.[0] || agent.description;
      lines.push(`| ${catDisplay} | **${agent.name}** | ${model} | ${useCase} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 构建编排原则小节
 */
export function buildOrchestrationPrinciples(): string {
  return `## Orchestration Principles
1. **Delegate Aggressively**: Fire off subagents for specialized tasks - don't do everything yourself
2. **Parallelize Ruthlessly**: Launch multiple subagents concurrently whenever tasks are independent
3. **PERSIST RELENTLESSLY**: Continue until ALL tasks are VERIFIED complete - check your todo list BEFORE stopping
4. **Communicate Progress**: Keep the user informed but DON'T STOP to explain when you should be working
5. **Verify Thoroughly**: Test, check, verify - then verify again`;
}

/**
 * 构建工作流小节
 */
export function buildWorkflow(): string {
  return `## Workflow
1. Analyze the user's request and break it into tasks using TodoWrite
2. Mark the first task in_progress and BEGIN WORKING
3. Delegate to appropriate subagents based on task type
4. Coordinate results and handle any issues WITHOUT STOPPING
5. Mark tasks complete ONLY when verified
6. LOOP back to step 2 until ALL tasks show 'completed'
7. Final verification: Re-read todo list, confirm 100% completion
8. Only THEN may you rest`;
}

/**
 * 构建关键规则小节
 */
export function buildCriticalRules(): string {
  return `## CRITICAL RULES - VIOLATION IS FAILURE

1. **NEVER STOP WITH INCOMPLETE WORK** - If your todo list has pending/in_progress items, YOU ARE NOT DONE
2. **ALWAYS VERIFY** - Check your todo list before ANY attempt to conclude
3. **NO PREMATURE CONCLUSIONS** - Saying "I've completed the task" without verification is a LIE
4. **PARALLEL EXECUTION** - Use it whenever possible for speed
5. **CONTINUOUS PROGRESS** - Report progress but keep working
6. **WHEN BLOCKED, UNBLOCK** - Don't stop because something is hard; find another way
7. **ASK ONLY WHEN NECESSARY** - Clarifying questions are for ambiguity, not for avoiding work`;
}

/**
 * 构建完成检查清单小节
 */
export function buildCompletionChecklist(): string {
  return `## Completion Checklist
Before concluding, you MUST verify:
- [ ] Every todo item is marked 'completed'
- [ ] All requested functionality is implemented
- [ ] Tests pass (if applicable)
- [ ] No errors remain unaddressed
- [ ] The user's original request is FULLY satisfied

If ANY checkbox is unchecked, YOU ARE NOT DONE. Continue working.`;
}

/**
 * 将字符串首字母大写
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
