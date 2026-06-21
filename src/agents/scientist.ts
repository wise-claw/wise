/**
 * 科学家代理 - 数据分析与研究执行
 *
 * 专用 agent，使用 Python 执行数据分析工作流。
 * 执行 EDA、统计分析，并生成可执行的发现。
 *
 * 支持：
 * - 对 CSV、JSON、Parquet 文件进行探索性数据分析
 * - 统计计算与假设检验
 * - 数据转换与特征工程
 * - 生成带有证据的结构化发现
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';
import { loadAgentPrompt } from './utils.js';

export const SCIENTIST_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'CHEAP',
  promptAlias: 'scientist',
  triggers: [
    { domain: '数据分析', trigger: '分析数据集并计算统计量' },
    { domain: '研究执行', trigger: '运行数据实验并生成发现' },
    { domain: 'Python 数据工作', trigger: '使用 pandas、numpy、scipy 处理数据任务' },
    { domain: '探索性数据分析', trigger: '对文件进行探索性数据分析' },
    { domain: '假设检验', trigger: '带置信区间与效应量的统计检验' },
    { domain: '研究阶段', trigger: '带结构化标记的多阶段分析' },
  ],
  useWhen: [
    '分析 CSV、JSON、Parquet 或其他数据文件',
    '计算描述性统计或聚合',
    '执行探索性数据分析（EDA）',
    '生成数据驱动的发现与洞见',
    '聚类或回归等简单机器学习任务',
    '数据转换与特征工程',
    '生成带可视化的数据分析报告',
    '带统计证据标记的假设检验',
    '带 [STAGE:*] 标记的研究阶段用于编排',
  ],
  avoidWhen: [
    '研究外部文档或 API（使用 document-specialist）',
    '实现生产代码功能（使用 executor）',
    '架构或系统设计问题（使用 architect）',
    '无数据文件可分析——仅理论性问题',
    '网页抓取或外部数据获取（使用 document-specialist）',
  ],
};

export const scientistAgent: AgentConfig = {
  name: 'scientist',
  description: '数据分析与研究执行专家。执行 Python 代码完成 EDA、统计分析，并生成数据驱动的发现。使用 pandas、numpy、scipy 处理 CSV、JSON、Parquet 文件。',
  prompt: loadAgentPrompt('scientist'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: SCIENTIST_PROMPT_METADATA
};
