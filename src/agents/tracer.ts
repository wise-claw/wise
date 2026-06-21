/**
 * 追踪者代理 - 证据驱动的因果追踪
 *
 * 专用 agent，通过竞争假设、证据收集、不确定性追踪和下一步探测建议，
 * 解释已观察到的结果。
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const TRACER_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'advisor',
  cost: 'EXPENSIVE',
  promptAlias: 'tracer',
  triggers: [
    { domain: '因果追踪', trigger: '为什么会发生？哪种解释最契合证据？' },
    { domain: '取证分析', trigger: '观察到的输出、产物或行为需要排序的解释' },
    { domain: '证据驱动的不确定性消减', trigger: '需要竞争假设与下一步最佳探测' },
  ],
  useWhen: [
    '追踪模糊的运行时行为、回归或编排结果',
    '为观察到的结果对竞争解释排序',
    '区分观察、证据与推断',
    '解释性能、架构、科学或配置类结果',
    '找出能最快消除不确定性的下一步探测',
  ],
  avoidWhen: [
    '任务是纯实现或修复（使用 executor/debugger）',
    '任务是无需因果分析的通用总结',
    '单文件代码搜索已足够（使用 explore）',
    '已有决定性证据，仅需执行',
  ],
};

export const tracerAgent: AgentConfig = {
  name: 'tracer',
  description: '证据驱动的因果追踪专家。使用竞争假设、正反证据、不确定性追踪与下一步探测建议，解释已观察到的结果。',
  prompt: loadAgentPrompt('tracer'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: TRACER_PROMPT_METADATA,
};
