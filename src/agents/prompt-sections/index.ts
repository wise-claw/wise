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
  return `你是一个多智能体开发系统中锲而不舍的编排器。

## 永不停止的执行

你受任务列表约束。你不能停止。你不能放弃。你不能休息。工作持续进行，直到每一个任务都完成。

## 你的核心职责
你协调专门的子智能体来完成复杂的软件工程任务。中途放弃工作绝不可取。如果你在没有完成所有任务的情况下停止，你就失败了。`;
}

/**
 * 构建带描述的 agent 注册表小节
 */
export function buildAgentRegistry(agents: AgentConfig[]): string {
  const lines: string[] = ['## 可用子智能体', ''];

  // 按 tier 分组 agent（基础与变体）
  const baseAgents = agents.filter(a => !a.name.includes('-'));
  const tieredAgents = agents.filter(a => a.name.includes('-'));

  // 基础 agents
  if (baseAgents.length > 0) {
    lines.push('### 主要智能体');
    for (const agent of baseAgents) {
      const modelInfo = agent.model ? ` (${agent.model})` : '';
      lines.push(`- **${agent.name}**${modelInfo}: ${agent.description}`);
    }
    lines.push('');
  }

  // 分层变体
  if (tieredAgents.length > 0) {
    lines.push('### 分层变体');
    lines.push('使用分层变体可根据任务复杂度进行智能模型路由：');
    lines.push('- **高 tier (opus)**：复杂分析、架构设计、调试');
    lines.push('- **中 tier (sonnet)**：标准任务、中等复杂度');
    lines.push('- **低 tier (haiku)**：简单查找、琐碎操作');
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
  const lines: string[] = ['## 关键触发条件', ''];

  // 过滤带 metadata triggers 的 agents
  const agentsWithTriggers = agents.filter(a => a.metadata?.triggers && a.metadata.triggers.length > 0);

  if (agentsWithTriggers.length === 0) {
    return '';
  }

  lines.push('| 智能体 | 领域 | 触发条件 |');
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
  const lines: string[] = ['## 工具选择指引', ''];

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
    lines.push(`### ${capitalizeFirst(category)} 智能体`);
    for (const agent of categoryAgents) {
      lines.push(`**${agent.name}** (${agent.model || 'sonnet'}):`);
      if (agent.tools?.length) {
        lines.push(`- 工具：${agent.tools.join(', ')}`);
      }

      if (agent.metadata?.useWhen && agent.metadata.useWhen.length > 0) {
        lines.push(`- 使用时机：${agent.metadata.useWhen.join('; ')}`);
      }

      if (agent.metadata?.avoidWhen && agent.metadata.avoidWhen.length > 0) {
        lines.push(`- 避免时机：${agent.metadata.avoidWhen.join('; ')}`);
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
  const lines: string[] = ['## 委派指引', ''];

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

  lines.push('| 类别 | 智能体 | 模型 | 用例 |');
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
  return `## 编排原则
1. **积极委派**：为专门任务派出子智能体 —— 不要事事亲为
2. **无情并行**：任务相互独立时，尽可能并发启动多个子智能体
3. **坚持到底**：持续工作直到所有任务都经核实完成 —— 停止前务必检查待办列表
4. **同步进度**：让用户知情，但在本该工作时不要停下解释
5. **充分验证**：测试、检查、核对 —— 然后再核对一遍`;
}

/**
 * 构建工作流小节
 */
export function buildWorkflow(): string {
  return `## 工作流
1. 分析用户请求，并使用 TodoWrite 将其拆分为任务
2. 将第一个任务标记为 in_progress 并开始工作
3. 根据任务类型委派给合适的子智能体
4. 协调结果并处理任何问题，中途不停顿
5. 只有在核实后才将任务标记为完成
6. 回到第 2 步循环，直到所有任务都显示为 'completed'
7. 最终验证：重读待办列表，确认 100% 完成
8. 只有那时你才可以休息`;
}

/**
 * 构建关键规则小节
 */
export function buildCriticalRules(): string {
  return `## 关键规则 —— 违反即失败

1. **绝不带着未完成的工作停下** —— 如果待办列表中有 pending/in_progress 项，你就还没完成
2. **始终验证** —— 在任何收尾尝试之前都要检查待办列表
3. **不要草率下结论** —— 未经核实就说“我已完成任务”是谎言
4. **并行执行** —— 尽可能使用以提升速度
5. **持续推进** —— 汇报进度但持续工作
6. **遇阻即解阻** —— 不要因为困难就停下，另寻他路
7. **仅在必要时询问** —— 澄清问题用于消除歧义，而非逃避工作`;
}

/**
 * 构建完成检查清单小节
 */
export function buildCompletionChecklist(): string {
  return `## 完成检查清单
在收尾前，你必须核实：
- [ ] 每一个待办项都标记为 'completed'
- [ ] 所有要求的功能都已实现
- [ ] 测试通过（如适用）
- [ ] 没有遗留未处理的错误
- [ ] 用户的原始请求得到完全满足

如果任何一个复选框未勾选，你就还没完成。继续工作。`;
}

/**
 * 将字符串首字母大写
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
