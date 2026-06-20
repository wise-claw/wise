/**
 * Magic Keywords 特性
 *
 * 检测 prompt 中的特殊关键词并激活增强行为。
 * 模式从 oh-my-opencode 移植而来。
 */

import type { MagicKeyword, PluginConfig } from '../shared/types.js';
import { getUltraworkMessage } from '../hooks/keyword-detector/ultrawork/index.js';

/**
 * 用于在检测前从文本中剥离的代码块模式
 */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

/**
 * 从文本中移除代码块，以便进行关键词检测
 */
function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, '').replace(INLINE_CODE_PATTERN, '');
}

const INFORMATIONAL_INTENT_PATTERNS: RegExp[] = [
  /\b(?:what(?:'s|\s+is)|what\s+are|how\s+(?:to|do\s+i)\s+use|explain|explanation|tell\s+me\s+about|describe)\b/i,
  /(?:뭐야|무엇(?:이야|인가요)?|어떻게|설명|사용법)/u,
  /(?:とは|って何|使い方|説明)/u,
  /(?:什么是|什麼是|怎(?:么|樣)用|如何使用|解释|說明|说明)/u,
];
const INFORMATIONAL_CONTEXT_WINDOW = 80;

function isInformationalKeywordContext(text: string, position: number, keywordLength: number): boolean {
  const start = Math.max(0, position - INFORMATIONAL_CONTEXT_WINDOW);
  const end = Math.min(text.length, position + keywordLength + INFORMATIONAL_CONTEXT_WINDOW);
  const context = text.slice(start, end);
  return INFORMATIONAL_INTENT_PATTERNS.some(pattern => pattern.test(context));
}

/**
 * 转义正则元字符，使字符串在 new RegExp() 中按字面量匹配。
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasActionableTrigger(text: string, trigger: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, 'gi');

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    if (isInformationalKeywordContext(text, match.index, match[0].length)) {
      continue;
    }

    return true;
  }

  return false;
}

/**
 * Ultrawork 模式增强
 * 激活并行 agent 编排的最高性能
 */
const ultraworkEnhancement: MagicKeyword = {
  triggers: ['ultrawork', 'ulw', 'uw'],
  description: 'Activates maximum performance mode with parallel agent orchestration',
  action: (prompt: string, agentName?: string, modelId?: string) => {
    // 移除触发词并添加增强指令
    const cleanPrompt = removeTriggerWords(prompt, ['ultrawork', 'ulw', 'uw']);
    return getUltraworkMessage(agentName, modelId) + cleanPrompt;
  }
};

/**
 * Search 模式增强 - 多语言支持
 * 最大化搜索力度与彻底性
 */
const searchEnhancement: MagicKeyword = {
  triggers: ['search', 'find', 'locate', 'lookup', 'explore', 'discover', 'scan', 'grep', 'query', 'browse', 'detect', 'trace', 'seek', 'track', 'pinpoint', 'hunt'],
  description: 'Maximizes search effort and thoroughness',
  action: (prompt: string) => {
    // 多语言搜索模式
    const searchPattern = /\b(search|find|locate|lookup|look\s*up|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all|검색|찾아|탐색|조회|스캔|서치|뒤져|찾기|어디|추적|탐지|찾아봐|찾아내|보여줘|목록|検索|探して|見つけて|サーチ|探索|スキャン|どこ|発見|捜索|見つけ出す|一覧|搜索|查找|寻找|查询|检索|定位|扫描|发现|在哪里|找出来|列出|tìm kiếm|tra cứu|định vị|quét|phát hiện|truy tìm|tìm ra|ở đâu|liệt kê/i;

    const hasSearchCommand = searchPattern.test(removeCodeBlocks(prompt));

    if (!hasSearchCommand) {
      return prompt;
    }

    return `${prompt}

[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
- explore agents (codebase patterns, file structures, ast-grep)
- document-specialist agents (remote repos, official docs, GitHub examples)
Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)
NEVER stop at first result - be exhaustive.`;
  }
};

/**
 * Analyze 模式增强 - 多语言支持
 * 激活深度分析与调查模式
 */
const analyzeEnhancement: MagicKeyword = {
  triggers: ['analyze', 'analyse', 'investigate', 'examine', 'study', 'deep-dive', 'inspect', 'audit', 'evaluate', 'assess', 'review', 'diagnose', 'scrutinize', 'dissect', 'debug', 'comprehend', 'interpret', 'breakdown', 'understand'],
  description: 'Activates deep analysis and investigation mode',
  action: (prompt: string) => {
    // 多语言分析模式
    const analyzePattern = /\b(analyze|analyse|investigate|examine|study|deep[\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to|분석|조사|파악|연구|검토|진단|이해|설명|원인|이유|뜯어봐|따져봐|평가|해석|디버깅|디버그|어떻게|왜|살펴|分析|調査|解析|検討|研究|診断|理解|説明|検証|精査|究明|デバッグ|なぜ|どう|仕組み|调查|检查|剖析|深入|诊断|解释|调试|为什么|原理|搞清楚|弄明白|phân tích|điều tra|nghiên cứu|kiểm tra|xem xét|chẩn đoán|giải thích|tìm hiểu|gỡ lỗi|tại sao/i;

    const hasAnalyzeCommand = analyzePattern.test(removeCodeBlocks(prompt));

    if (!hasAnalyzeCommand) {
      return prompt;
    }

    return `${prompt}

[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- 1-2 explore agents (codebase patterns, implementations)
- 1-2 document-specialist agents (if external library involved)
- Direct tools: Grep, AST-grep, LSP for targeted searches

IF COMPLEX (architecture, multi-system, debugging after 2+ failures):
- Consult architect for strategic guidance

SYNTHESIZE findings before proceeding.`;
  }
};

/**
 * Ultrathink 模式增强
 * 激活扩展思考与深度推理
 */
const ultrathinkEnhancement: MagicKeyword = {
  triggers: ['ultrathink', 'think', 'reason', 'ponder'],
  description: 'Activates extended thinking mode for deep reasoning',
  action: (prompt: string) => {
    // 检查是否存在 ultrathink 相关触发词
    const hasThinkCommand = /\b(ultrathink|think|reason|ponder)\b/i.test(removeCodeBlocks(prompt));

    if (!hasThinkCommand) {
      return prompt;
    }

    const cleanPrompt = removeTriggerWords(prompt, ['ultrathink', 'think', 'reason', 'ponder']);

    return `[ULTRATHINK MODE - EXTENDED REASONING ACTIVATED]

${cleanPrompt}

## Deep Thinking Instructions
- Take your time to think through this problem thoroughly
- Consider multiple approaches before settling on a solution
- Identify edge cases, risks, and potential issues
- Think step-by-step through complex logic
- Question your assumptions
- Consider what could go wrong
- Evaluate trade-offs between different solutions
- Look for patterns from similar problems

IMPORTANT: Do not rush. Quality of reasoning matters more than speed.
Use maximum cognitive effort before responding.`;
  }
};

/**
 * 从 prompt 中移除触发词
 */
function removeTriggerWords(prompt: string, triggers: string[]): string {
  let result = prompt;
  for (const trigger of triggers) {
    const regex = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, 'gi');
    result = result.replace(regex, '');
  }
  return result.trim();
}

/**
 * 所有内置 magic keyword 定义
 */
export const builtInMagicKeywords: MagicKeyword[] = [
  ultraworkEnhancement,
  searchEnhancement,
  analyzeEnhancement,
  ultrathinkEnhancement
];

/**
 * 创建带有自定义触发词的 magic keyword 处理器
 */
export function createMagicKeywordProcessor(config?: PluginConfig['magicKeywords']): (prompt: string, agentName?: string, modelId?: string) => string {
  const keywords = builtInMagicKeywords.map(k => ({ ...k, triggers: [...k.triggers] }));

  // 从配置中覆盖触发词
  if (config) {
    if (config.ultrawork) {
      const ultrawork = keywords.find(k => k.triggers.includes('ultrawork'));
      if (ultrawork) {
        ultrawork.triggers = config.ultrawork;
      }
    }
    if (config.search) {
      const search = keywords.find(k => k.triggers.includes('search'));
      if (search) {
        search.triggers = config.search;
      }
    }
    if (config.analyze) {
      const analyze = keywords.find(k => k.triggers.includes('analyze'));
      if (analyze) {
        analyze.triggers = config.analyze;
      }
    }
    if (config.ultrathink) {
      const ultrathink = keywords.find(k => k.triggers.includes('ultrathink'));
      if (ultrathink) {
        ultrathink.triggers = config.ultrathink;
      }
    }
  }

  return (prompt: string, agentName?: string, modelId?: string): string => {
    let result = prompt;

    for (const keyword of keywords) {
      const hasKeyword = keyword.triggers.some(trigger => {
        return hasActionableTrigger(removeCodeBlocks(result), trigger);
      });

      if (hasKeyword) {
        result = keyword.action(result, agentName, modelId);
      }
    }

    return result;
  };
}

/**
 * 检查 prompt 是否包含任意 magic keyword
 */
export function detectMagicKeywords(prompt: string, config?: PluginConfig['magicKeywords']): string[] {
  const detected: string[] = [];
  const keywords = builtInMagicKeywords.map(k => ({ ...k, triggers: [...k.triggers] }));
  const cleanedPrompt = removeCodeBlocks(prompt);

  // 应用配置覆盖
  if (config) {
    if (config.ultrawork) {
      const ultrawork = keywords.find(k => k.triggers.includes('ultrawork'));
      if (ultrawork) ultrawork.triggers = config.ultrawork;
    }
    if (config.search) {
      const search = keywords.find(k => k.triggers.includes('search'));
      if (search) search.triggers = config.search;
    }
    if (config.analyze) {
      const analyze = keywords.find(k => k.triggers.includes('analyze'));
      if (analyze) analyze.triggers = config.analyze;
    }
    if (config.ultrathink) {
      const ultrathink = keywords.find(k => k.triggers.includes('ultrathink'));
      if (ultrathink) ultrathink.triggers = config.ultrathink;
    }
  }

  for (const keyword of keywords) {
    for (const trigger of keyword.triggers) {
      if (hasActionableTrigger(cleanedPrompt, trigger)) {
        detected.push(trigger);
        break;
      }
    }
  }

  return detected;
}

/**
 * 从消息 parts 中提取 prompt 文本（供 hook 使用）
 */
export function extractPromptText(parts: Array<{ type: string; text?: string; [key: string]: unknown }>): string {
  return parts
    .filter(p => p.type === 'text')
    .map(p => p.text ?? '')
    .join('\n');
}
