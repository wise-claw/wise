/**
 * 文档专家代理 - 文档与外部参考查找器
 *
 * 搜索外部资源：官方文档、GitHub、Stack Overflow。
 * 内部代码库搜索请改用 explore agent。
 *
 * 从 oh-my-opencode 的 document specialist agent 移植。
 */

import type { AgentConfig, AgentPromptMetadata } from "./types.js";
import { loadAgentPrompt } from "./utils.js";

export const DOCUMENT_SPECIALIST_PROMPT_METADATA: AgentPromptMetadata = {
  category: "exploration",
  cost: "CHEAP",
  promptAlias: "document-specialist",
  triggers: [
    {
      domain: "项目文档",
      trigger: "README、docs/、迁移指南、本地参考资料",
    },
    {
      domain: "外部文档",
      trigger: "API 参考、官方文档",
    },
    {
      domain: "API/框架正确性",
      trigger:
        "可用时优先使用 Context Hub / chub；否则回退到精选后端",
    },
    {
      domain: "开源实现",
      trigger: "GitHub 示例、包源码",
    },
    {
      domain: "最佳实践",
      trigger: "社区模式、推荐做法",
    },
    {
      domain: "文献与参考资料研究",
      trigger: "学术论文、手册、参考数据库",
    },
  ],
  useWhen: [
    "在更大范围研究之前先查阅 README/docs/本地参考文件",
    "查阅官方文档",
    "可用时使用 Context Hub / chub（或其他精选文档后端）确保外部 API/框架正确性",
    "查找 GitHub 示例",
    "研究 npm/pip 包",
    "Stack Overflow 解决方案",
    "外部 API 参考",
    "搜索外部文献或学术论文",
    "查阅当前项目之外的手册、数据库或参考资料",
  ],
  avoidWhen: [
    "内部代码库实现搜索（使用 explore）",
    "任务是代码发现而非文档查阅时的当前项目源文件（使用 explore）",
    "已有信息时",
  ],
};

export const documentSpecialistAgent: AgentConfig = {
  name: "document-specialist",
  description:
    "文档专家，用于文档研究与参考资料查找。适用于：本地仓库文档、官方文档、Context Hub / chub 或其他精选文档后端以确保 API/框架正确性、GitHub 示例、开源实现、外部文献、学术论文，以及参考/数据库查阅。避免用于内部实现搜索；代码发现请使用 explore。",
  prompt: loadAgentPrompt("document-specialist"),
  model: "sonnet",
  defaultModel: "sonnet",
  metadata: DOCUMENT_SPECIALIST_PROMPT_METADATA,
};
