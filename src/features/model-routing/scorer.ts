/**
 * 复杂度评分器
 *
 * 根据提取的信号计算复杂度档位。
 * 使用加权评分来决定 LOW/MEDIUM/HIGH 档位。
 */

import type {
  ComplexitySignals,
  ComplexityTier,
  LexicalSignals,
  StructuralSignals,
  ContextSignals,
} from './types.js';

/**
 * 档位划分的分数阈值
 */
const TIER_THRESHOLDS = {
  HIGH: 8,    // 分数 >= 8 -> HIGH (Opus)
  MEDIUM: 4,  // 分数 >= 4 -> MEDIUM (Sonnet)
  // 分数 < 4 -> LOW (Haiku)
};

/**
 * 不同信号类别的权重配置
 * 各项之和应大致使分数范围落在 0-15+
 */
const WEIGHTS = {
  lexical: {
    wordCountHigh: 2,         // 长提示 (+2)
    wordCountVeryHigh: 1,     // 超长提示 (额外 +1)
    filePathsMultiple: 1,     // 多个文件路径 (+1)
    codeBlocksPresent: 1,     // 代码块 (+1)
    architectureKeywords: 3,  // 架构关键词 (+3)
    debuggingKeywords: 2,     // 调试关键词 (+2)
    simpleKeywords: -2,       // 简单关键词 (-2)
    riskKeywords: 2,          // 风险关键词 (+2)
    questionDepthWhy: 2,      // 'why' 类问题 (+2)
    questionDepthHow: 1,      // 'how' 类问题 (+1)
    implicitRequirements: 1,  // 模糊需求 (+1)
  },
  structural: {
    subtasksMany: 3,          // 多个子任务 (+3)
    subtasksSome: 1,          // 少量子任务 (+1)
    crossFile: 2,             // 跨文件改动 (+2)
    testRequired: 1,          // 需要测试 (+1)
    securityDomain: 2,        // 安全领域 (+2)
    infrastructureDomain: 1,  // 基础设施领域 (+1)
    externalKnowledge: 1,     // 需要外部知识 (+1)
    reversibilityDifficult: 2, // 难以回滚 (+2)
    reversibilityModerate: 1,  // 中等可回滚性 (+1)
    impactSystemWide: 3,      // 系统级影响 (+3)
    impactModule: 1,          // 模块级影响 (+1)
  },
  context: {
    previousFailure: 2,       // 每次前序失败 (+2)
    previousFailureMax: 4,    // 失败项的最大分值
    deepChain: 2,             // 深层代理链 (+2)
    complexPlan: 1,           // 复杂计划 (+1)
  },
};

/**
 * 根据词法信号计算复杂度分数
 */
function scoreLexicalSignals(signals: LexicalSignals): number {
  let score = 0;

  // 词数评分
  if (signals.wordCount > 200) {
    score += WEIGHTS.lexical.wordCountHigh;
    if (signals.wordCount > 500) {
      score += WEIGHTS.lexical.wordCountVeryHigh;
    }
  }

  // 文件路径
  if (signals.filePathCount >= 2) {
    score += WEIGHTS.lexical.filePathsMultiple;
  }

  // 代码块
  if (signals.codeBlockCount > 0) {
    score += WEIGHTS.lexical.codeBlocksPresent;
  }

  // 关键词评分
  if (signals.hasArchitectureKeywords) {
    score += WEIGHTS.lexical.architectureKeywords;
  }
  if (signals.hasDebuggingKeywords) {
    score += WEIGHTS.lexical.debuggingKeywords;
  }
  if (signals.hasSimpleKeywords) {
    score += WEIGHTS.lexical.simpleKeywords; // 负权重
  }
  if (signals.hasRiskKeywords) {
    score += WEIGHTS.lexical.riskKeywords;
  }

  // 问题深度
  switch (signals.questionDepth) {
    case 'why':
      score += WEIGHTS.lexical.questionDepthWhy;
      break;
    case 'how':
      score += WEIGHTS.lexical.questionDepthHow;
      break;
    // 'what'、'where'、'none' 不计分
  }

  // 隐式需求
  if (signals.hasImplicitRequirements) {
    score += WEIGHTS.lexical.implicitRequirements;
  }

  return score;
}

/**
 * 根据结构信号计算复杂度分数
 */
function scoreStructuralSignals(signals: StructuralSignals): number {
  let score = 0;

  // 子任务评分
  if (signals.estimatedSubtasks > 3) {
    score += WEIGHTS.structural.subtasksMany;
  } else if (signals.estimatedSubtasks > 1) {
    score += WEIGHTS.structural.subtasksSome;
  }

  // 跨文件依赖
  if (signals.crossFileDependencies) {
    score += WEIGHTS.structural.crossFile;
  }

  // 测试要求
  if (signals.hasTestRequirements) {
    score += WEIGHTS.structural.testRequired;
  }

  // 领域专属性
  switch (signals.domainSpecificity) {
    case 'security':
      score += WEIGHTS.structural.securityDomain;
      break;
    case 'infrastructure':
      score += WEIGHTS.structural.infrastructureDomain;
      break;
    // 其他领域不计分
  }

  // 外部知识
  if (signals.requiresExternalKnowledge) {
    score += WEIGHTS.structural.externalKnowledge;
  }

  // 可回滚性
  switch (signals.reversibility) {
    case 'difficult':
      score += WEIGHTS.structural.reversibilityDifficult;
      break;
    case 'moderate':
      score += WEIGHTS.structural.reversibilityModerate;
      break;
  }

  // 影响范围
  switch (signals.impactScope) {
    case 'system-wide':
      score += WEIGHTS.structural.impactSystemWide;
      break;
    case 'module':
      score += WEIGHTS.structural.impactModule;
      break;
  }

  return score;
}

/**
 * 根据上下文信号计算复杂度分数
 */
function scoreContextSignals(signals: ContextSignals): number {
  let score = 0;

  // 前序失败次数（有上限）
  const failureScore = Math.min(
    signals.previousFailures * WEIGHTS.context.previousFailure,
    WEIGHTS.context.previousFailureMax
  );
  score += failureScore;

  // 深层代理链（3 层及以上）
  if (signals.agentChainDepth >= 3) {
    score += WEIGHTS.context.deepChain;
  }

  // 复杂计划（5 个及以上任务）
  if (signals.planComplexity >= 5) {
    score += WEIGHTS.context.complexPlan;
  }

  return score;
}

/**
 * 计算总复杂度分数
 */
export function calculateComplexityScore(signals: ComplexitySignals): number {
  const lexicalScore = scoreLexicalSignals(signals.lexical);
  const structuralScore = scoreStructuralSignals(signals.structural);
  const contextScore = scoreContextSignals(signals.context);

  return lexicalScore + structuralScore + contextScore;
}

/**
 * 根据分数判定复杂度档位
 */
export function scoreToTier(score: number): ComplexityTier {
  if (score >= TIER_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= TIER_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * 根据信号计算复杂度档位
 */
export function calculateComplexityTier(signals: ComplexitySignals): ComplexityTier {
  const score = calculateComplexityScore(signals);
  return scoreToTier(score);
}

/**
 * 获取详细分数明细，用于调试/日志
 */
export function getScoreBreakdown(signals: ComplexitySignals): {
  lexical: number;
  structural: number;
  context: number;
  total: number;
  tier: ComplexityTier;
} {
  const lexical = scoreLexicalSignals(signals.lexical);
  const structural = scoreStructuralSignals(signals.structural);
  const context = scoreContextSignals(signals.context);
  const total = lexical + structural + context;

  return {
    lexical,
    structural,
    context,
    total,
    tier: scoreToTier(total),
  };
}

/**
 * 计算档位判定的置信度
 * 分数离阈值越远，置信度越高
 */
export function calculateConfidence(score: number, tier: ComplexityTier): number {
  const distanceFromLow = Math.abs(score - TIER_THRESHOLDS.MEDIUM);
  const distanceFromHigh = Math.abs(score - TIER_THRESHOLDS.HIGH);

  // 距任意阈值的最小距离
  let minDistance: number;
  switch (tier) {
    case 'LOW':
      minDistance = TIER_THRESHOLDS.MEDIUM - score;
      break;
    case 'MEDIUM':
      minDistance = Math.min(distanceFromLow, distanceFromHigh);
      break;
    case 'HIGH':
      minDistance = score - TIER_THRESHOLDS.HIGH;
      break;
  }

  // 将距离转换为置信度（0-1）
  // 距离为 0 = 置信度 0.5，距离为 4+ = 置信度 0.9+
  const confidence = 0.5 + (Math.min(minDistance, 4) / 4) * 0.4;
  return Math.round(confidence * 100) / 100;
}
