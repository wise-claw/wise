/**
 * Scientist Agent - 数据分析与研究执行
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
    { domain: 'Data analysis', trigger: 'Analyzing datasets and computing statistics' },
    { domain: 'Research execution', trigger: 'Running data experiments and generating findings' },
    { domain: 'Python data work', trigger: 'Using pandas, numpy, scipy for data tasks' },
    { domain: 'EDA', trigger: 'Exploratory data analysis on files' },
    { domain: 'Hypothesis testing', trigger: 'Statistical tests with confidence intervals and effect sizes' },
    { domain: 'Research stages', trigger: 'Multi-stage analysis with structured markers' },
  ],
  useWhen: [
    'Analyzing CSV, JSON, Parquet, or other data files',
    'Computing descriptive statistics or aggregations',
    'Performing exploratory data analysis (EDA)',
    'Generating data-driven findings and insights',
    'Simple ML tasks like clustering or regression',
    'Data transformations and feature engineering',
    'Generating data analysis reports with visualizations',
    'Hypothesis testing with statistical evidence markers',
    'Research stages with [STAGE:*] markers for orchestration',
  ],
  avoidWhen: [
    'Researching external documentation or APIs (use document-specialist)',
    'Implementing production code features (use executor)',
    'Architecture or system design questions (use architect)',
    'No data files to analyze - just theoretical questions',
    'Web scraping or external data fetching (use document-specialist)',
  ],
};

export const scientistAgent: AgentConfig = {
  name: 'scientist',
  description: 'Data analysis and research execution specialist. Executes Python code for EDA, statistical analysis, and generating data-driven findings. Works with CSV, JSON, Parquet files using pandas, numpy, scipy.',
  prompt: loadAgentPrompt('scientist'),
  model: 'sonnet',
  defaultModel: 'sonnet',
  metadata: SCIENTIST_PROMPT_METADATA
};
