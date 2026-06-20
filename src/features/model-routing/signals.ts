/**
 * 复杂度信号提取
 *
 * 从任务提示中提取复杂度信号以辅助路由决策。
 * 信号分为词法、结构、上下文三类。
 */

import type {
  LexicalSignals,
  StructuralSignals,
  ContextSignals,
  ComplexitySignals,
  RoutingContext,
} from './types.js';
import { COMPLEXITY_KEYWORDS } from './types.js';

/**
 * 从任务提示中提取词法信号
 * 这些是基于正则的快速提取，无需调用模型
 */
export function extractLexicalSignals(prompt: string): LexicalSignals {
  const lowerPrompt = prompt.toLowerCase();
  const words = prompt.split(/\s+/).filter(w => w.length > 0);

  return {
    wordCount: words.length,
    filePathCount: countFilePaths(prompt),
    codeBlockCount: countCodeBlocks(prompt),
    hasArchitectureKeywords: hasKeywords(lowerPrompt, COMPLEXITY_KEYWORDS.architecture),
    hasDebuggingKeywords: hasKeywords(lowerPrompt, COMPLEXITY_KEYWORDS.debugging),
    hasSimpleKeywords: hasKeywords(lowerPrompt, COMPLEXITY_KEYWORDS.simple),
    hasRiskKeywords: hasKeywords(lowerPrompt, COMPLEXITY_KEYWORDS.risk),
    questionDepth: detectQuestionDepth(lowerPrompt),
    hasImplicitRequirements: detectImplicitRequirements(lowerPrompt),
  };
}

/**
 * 从任务提示中提取结构信号
 * 这类提取需要更复杂的解析
 */
export function extractStructuralSignals(prompt: string): StructuralSignals {
  const lowerPrompt = prompt.toLowerCase();

  return {
    estimatedSubtasks: estimateSubtasks(prompt),
    crossFileDependencies: detectCrossFileDependencies(prompt),
    hasTestRequirements: detectTestRequirements(lowerPrompt),
    domainSpecificity: detectDomain(lowerPrompt),
    requiresExternalKnowledge: detectExternalKnowledge(lowerPrompt),
    reversibility: assessReversibility(lowerPrompt),
    impactScope: assessImpactScope(prompt),
  };
}

/**
 * 从路由上下文中提取上下文信号
 */
export function extractContextSignals(context: RoutingContext): ContextSignals {
  return {
    previousFailures: context.previousFailures ?? 0,
    conversationTurns: context.conversationTurns ?? 0,
    planComplexity: context.planTasks ?? 0,
    remainingTasks: context.remainingTasks ?? 0,
    agentChainDepth: context.agentChainDepth ?? 0,
  };
}

/**
 * 提取全部复杂度信号
 */
export function extractAllSignals(
  prompt: string,
  context: RoutingContext
): ComplexitySignals {
  return {
    lexical: extractLexicalSignals(prompt),
    structural: extractStructuralSignals(prompt),
    context: extractContextSignals(context),
  };
}

// ============ 辅助函数 ============

/**
 * 统计提示中的文件路径数量
 */
function countFilePaths(prompt: string): number {
  // 匹配常见的文件路径模式
  const patterns = [
    /(?:^|\s)[.\/~]?(?:[\w-]+\/)+[\w.-]+\.\w+/gm,  // Unix 风格路径
    /`[^`]+\.\w+`/g,  // 反引号包裹的文件
    /['"][^'"]+\.\w+['"]/g,  // 引号包裹的文件
  ];

  let count = 0;
  for (const pattern of patterns) {
    const matches = prompt.match(pattern);
    if (matches) count += matches.length;
  }

  return Math.min(count, 20); // 限制在合理上限内
}

/**
 * 统计提示中的代码块数量
 */
function countCodeBlocks(prompt: string): number {
  const fencedBlocks = (prompt.match(/```[\s\S]*?```/g) || []).length;
  const indentedBlocks = (prompt.match(/(?:^|\n)(?:\s{4}|\t)[^\n]+(?:\n(?:\s{4}|\t)[^\n]+)*/g) || []).length;
  return fencedBlocks + Math.floor(indentedBlocks / 2);
}

/**
 * 检查提示是否包含任一关键词
 */
function hasKeywords(prompt: string, keywords: string[]): boolean {
  return keywords.some(kw => prompt.includes(kw));
}

/**
 * 检测问题深度
 * 'why' 类问题比 'what' 或 'where' 需要更深入的推理
 */
function detectQuestionDepth(prompt: string): 'why' | 'how' | 'what' | 'where' | 'none' {
  if (/\bwhy\b.*\?|\bwhy\s+(is|are|does|do|did|would|should|can)/i.test(prompt)) {
    return 'why';
  }
  if (/\bhow\b.*\?|\bhow\s+(do|does|can|should|would|to)/i.test(prompt)) {
    return 'how';
  }
  if (/\bwhat\b.*\?|\bwhat\s+(is|are|does|do)/i.test(prompt)) {
    return 'what';
  }
  if (/\bwhere\b.*\?|\bwhere\s+(is|are|does|do|can)/i.test(prompt)) {
    return 'where';
  }
  return 'none';
}

/**
 * 检测隐式需求（缺乏明确交付物的模糊表述）
 */
function detectImplicitRequirements(prompt: string): boolean {
  const vaguePatterns = [
    /\bmake it better\b/,
    /\bimprove\b(?!.*(?:by|to|so that))/,
    /\bfix\b(?!.*(?:the|this|that|in|at))/,
    /\boptimize\b(?!.*(?:by|for|to))/,
    /\bclean up\b/,
    /\brefactor\b(?!.*(?:to|by|into))/,
  ];
  return vaguePatterns.some(p => p.test(prompt));
}

/**
 * 估算子任务数量
 */
function estimateSubtasks(prompt: string): number {
  let count = 1;

  // 统计显式列表项
  const bulletPoints = (prompt.match(/^[\s]*[-*•]\s/gm) || []).length;
  const numberedItems = (prompt.match(/^[\s]*\d+[.)]\s/gm) || []).length;
  count += bulletPoints + numberedItems;

  // 统计 'and' 连词，可能表示存在多个任务
  const andCount = (prompt.match(/\band\b/gi) || []).length;
  count += Math.floor(andCount / 2);

  // 统计 'then' 标志词
  const thenCount = (prompt.match(/\bthen\b/gi) || []).length;
  count += thenCount;

  return Math.min(count, 10);
}

/**
 * 检测任务是否涉及跨多文件改动
 */
function detectCrossFileDependencies(prompt: string): boolean {
  const fileCount = countFilePaths(prompt);
  if (fileCount >= 2) return true;

  const crossFileIndicators = [
    /multiple files/i,
    /across.*files/i,
    /several.*files/i,
    /all.*files/i,
    /throughout.*codebase/i,
    /entire.*project/i,
    /whole.*system/i,
  ];

  return crossFileIndicators.some(p => p.test(prompt));
}

/**
 * 检测测试要求
 */
function detectTestRequirements(prompt: string): boolean {
  const testIndicators = [
    /\btests?\b/i,
    /\bspec\b/i,
    /make sure.*work/i,
    /verify/i,
    /ensure.*pass/i,
    /\bTDD\b/,
    /unit test/i,
    /integration test/i,
  ];
  return testIndicators.some(p => p.test(prompt));
}

/**
 * 检测领域专属性
 */
function detectDomain(
  prompt: string
): 'generic' | 'frontend' | 'backend' | 'infrastructure' | 'security' {
  const domains: Record<string, RegExp[]> = {
    frontend: [
      /\b(react|vue|angular|svelte|css|html|jsx|tsx|component|ui|ux|styling|tailwind|sass|scss)\b/i,
      /\b(button|modal|form|input|layout|responsive|animation)\b/i,
    ],
    backend: [
      /\b(api|endpoint|database|query|sql|graphql|rest|server|auth|middleware)\b/i,
      /\b(node|express|fastify|nest|django|flask|rails)\b/i,
    ],
    infrastructure: [
      /\b(docker|kubernetes|k8s|terraform|aws|gcp|azure|ci|cd|deploy|container)\b/i,
      /\b(nginx|load.?balancer|scaling|monitoring|logging)\b/i,
    ],
    security: [
      /\b(security|auth|oauth|jwt|encryption|vulnerability|xss|csrf|injection)\b/i,
      /\b(password|credential|secret|token|permission)\b/i,
    ],
  };

  for (const [domain, patterns] of Object.entries(domains)) {
    if (patterns.some(p => p.test(prompt))) {
      return domain as 'frontend' | 'backend' | 'infrastructure' | 'security';
    }
  }

  return 'generic';
}

/**
 * 检测是否需要外部知识
 */
function detectExternalKnowledge(prompt: string): boolean {
  const externalIndicators = [
    /\bdocs?\b/i,
    /\bdocumentation\b/i,
    /\bofficial\b/i,
    /\blibrary\b/i,
    /\bpackage\b/i,
    /\bframework\b/i,
    /\bhow does.*work\b/i,
    /\bbest practice/i,
  ];
  return externalIndicators.some(p => p.test(prompt));
}

/**
 * 评估改动的可回滚性
 */
function assessReversibility(prompt: string): 'easy' | 'moderate' | 'difficult' {
  const difficultIndicators = [
    /\bmigrat/i,
    /\bproduction\b/i,
    /\bdata.*loss/i,
    /\bdelete.*all/i,
    /\bdrop.*table/i,
    /\birreversible/i,
    /\bpermanent/i,
  ];

  const moderateIndicators = [
    /\brefactor/i,
    /\brestructure/i,
    /\brename.*across/i,
    /\bmove.*files/i,
    /\bchange.*schema/i,
  ];

  if (difficultIndicators.some(p => p.test(prompt))) return 'difficult';
  if (moderateIndicators.some(p => p.test(prompt))) return 'moderate';
  return 'easy';
}

/**
 * 评估改动的影响范围
 */
function assessImpactScope(prompt: string): 'local' | 'module' | 'system-wide' {
  const systemWideIndicators = [
    /\bentire\b/i,
    /\ball\s+(?:files|components|modules)/i,
    /\bwhole\s+(?:project|codebase|system)/i,
    /\bsystem.?wide/i,
    /\bglobal/i,
    /\beverywhere/i,
    /\bthroughout/i,
  ];

  const moduleIndicators = [
    /\bmodule/i,
    /\bpackage/i,
    /\bservice/i,
    /\bfeature/i,
    /\bcomponent/i,
    /\blayer/i,
  ];

  if (systemWideIndicators.some(p => p.test(prompt))) return 'system-wide';

  // 检查是否涉及多个文件（至少表示模块级影响）
  if (countFilePaths(prompt) >= 3) return 'module';
  if (moduleIndicators.some(p => p.test(prompt))) return 'module';

  return 'local';
}
