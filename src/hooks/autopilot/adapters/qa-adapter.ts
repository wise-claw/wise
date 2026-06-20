/**
 * QA 阶段适配器
 *
 * 将已有的 UltraQA 模块封装到流水线阶段适配器接口中。
 *
 * QA 阶段循环运行 build/lint/test，直到所有检查通过
 * 或达到最大循环次数。
 */

import type { PipelineStageAdapter, PipelineConfig, PipelineContext } from '../pipeline-types.js';
import { getQAPrompt } from '../prompts.js';

export const QA_COMPLETION_SIGNAL = 'PIPELINE_QA_COMPLETE';

export const qaAdapter: PipelineStageAdapter = {
  id: 'qa',
  name: 'Quality Assurance',
  completionSignal: QA_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return !config.qa;
  },

  getPrompt(_context: PipelineContext): string {
    return `## PIPELINE STAGE: QA (Quality Assurance)

Run build/lint/test cycling until all checks pass.

${getQAPrompt()}

### Completion

When all QA checks pass:

Signal: ${QA_COMPLETION_SIGNAL}
`;
  },
};
