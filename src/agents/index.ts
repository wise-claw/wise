/**
 * Agents 模块导出
 *
 * 新的模块化 agent 系统，含独立文件与元数据。
 * 与 definitions.ts 导出保持向后兼容。
 */

// 类型
export * from './types.js';

// 工具函数
export {
  createAgentToolRestrictions,
  mergeAgentConfig,
  buildDelegationTable,
  buildUseAvoidSection,
  createEnvContext,
  getAvailableAgents,
  buildKeyTriggersSection,
  validateAgentConfig,
  deepMerge,
  loadAgentPrompt,
  formatOpenQuestions,
  OPEN_QUESTIONS_PATH
} from './utils.js';

// 各 agent 单独导出
export { architectAgent, ARCHITECT_PROMPT_METADATA } from './architect.js';
export { exploreAgent, EXPLORE_PROMPT_METADATA } from './explore.js';
export { executorAgent, EXECUTOR_PROMPT_METADATA } from './executor.js';
export { designerAgent, FRONTEND_ENGINEER_PROMPT_METADATA } from './designer.js';
export { writerAgent, DOCUMENT_WRITER_PROMPT_METADATA } from './writer.js';
export { criticAgent, CRITIC_PROMPT_METADATA } from './critic.js';
export { analystAgent, ANALYST_PROMPT_METADATA } from './analyst.js';
export { plannerAgent, PLANNER_PROMPT_METADATA } from './planner.js';
export { qaTesterAgent, QA_TESTER_PROMPT_METADATA } from './qa-tester.js';
export { scientistAgent, SCIENTIST_PROMPT_METADATA } from './scientist.js';
export { tracerAgent, TRACER_PROMPT_METADATA } from './tracer.js';
export { documentSpecialistAgent, DOCUMENT_SPECIALIST_PROMPT_METADATA } from './document-specialist.js';
// 改良后的 agent（构建/分析通道）
export {
  debuggerAgent,
  verifierAgent
} from './definitions.js';

// 改良后的 agent（领域专家）
export {
  testEngineerAgent
} from './definitions.js';

// 专用 agent（安全、代码评审、Git、代码简化器）
export {
  securityReviewerAgent,
  codeReviewerAgent,
  gitMasterAgent,
  codeSimplifierAgent
} from './definitions.js';

// 核心导出（getAgentDefinitions 与 wiseSystemPrompt）
export {
  getAgentDefinitions,
  wiseSystemPrompt
} from './definitions.js';
