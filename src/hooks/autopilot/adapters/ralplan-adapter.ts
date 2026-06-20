/**
 * RALPLAN 阶段适配器
 *
 * 将现有的 ralplan（共识规划）与直接规划模块
 * 封装为流水线阶段适配器接口。
 *
 * 本阶段负责：规格说明创建 + 实施计划创建。
 * planning='ralplan' 时，使用 Planner/Architect/Critic 的共识驱动规划。
 * planning='direct' 时，使用更简单的 Architect+Critic 方式。
 */

import type {
  PipelineStageAdapter,
  PipelineConfig,
  PipelineContext,
} from "../pipeline-types.js";
import { resolveAutopilotPlanPath } from "../../../config/plan-output.js";
import { getExpansionPrompt, getDirectPlanningPrompt } from "../prompts.js";

export const RALPLAN_COMPLETION_SIGNAL = "PIPELINE_RALPLAN_COMPLETE";

export const ralplanAdapter: PipelineStageAdapter = {
  id: "ralplan",
  name: "Planning (RALPLAN)",
  completionSignal: RALPLAN_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return config.planning === false;
  },

  getPrompt(context: PipelineContext): string {
    const specPath = context.specPath || ".wise/autopilot/spec.md";
    const planPath = context.planPath || resolveAutopilotPlanPath();

    if (context.config.planning === "ralplan") {
      return `## PIPELINE STAGE: RALPLAN (Consensus Planning)

Your task: Expand the idea into a detailed spec and implementation plan using consensus-driven planning.

**Original Idea:** "${context.idea}"

### Part 1: Idea Expansion (Spec Creation)

${getExpansionPrompt(context.idea)}

### Part 2: Consensus Planning

After the spec is created at \`${specPath}\`, invoke the RALPLAN consensus workflow:

Use the \`/wise:ralplan\` skill to create a consensus-driven implementation plan.
The plan should be saved to: \`${planPath}\`

The RALPLAN process will:
1. **Planner** creates initial implementation plan from the spec
2. **Architect** reviews for technical feasibility and design quality
3. **Critic** challenges assumptions and identifies gaps
4. Iterate until consensus is reached

### Completion

When both the spec AND the consensus plan are complete and approved:

Signal: ${RALPLAN_COMPLETION_SIGNAL}
`;
    }

    // 直接规划模式（更简单的方式）
    return `## PIPELINE STAGE: PLANNING (Direct)

Your task: Expand the idea into a spec and create an implementation plan.

**Original Idea:** "${context.idea}"

### Part 1: Idea Expansion

${getExpansionPrompt(context.idea)}

### Part 2: Direct Planning

After the spec is saved, create the implementation plan:

${getDirectPlanningPrompt(specPath)}

Save the plan to: \`${planPath}\`

### Completion

When both the spec AND the plan are complete:

Signal: ${RALPLAN_COMPLETION_SIGNAL}
`;
  },
};
