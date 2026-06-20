/**
 * 关键词检测钩子
 *
 * 检测用户 prompt 中的魔法关键词，并返回需注入上下文的相应模式消息。
 *
 * 移植自 oh-my-opencode 的 keyword-detector 钩子。
 */

import {
  classifyTaskSize,
  isHeavyMode,
  type TaskSizeResult,
  type TaskSizeThresholds,
} from '../task-size-detector/index.js';

export type KeywordType =
  | 'cancel'      // 优先级 1
  | 'ralph'       // 优先级 2
  | 'autopilot'   // 优先级 3
  | 'team'        // 优先级 4.5（team 模式）
  | 'ultrawork'   // 优先级 5
  | 'ralplan'     // 优先级 8
  | 'tdd'         // 优先级 9
  | 'code-review' // 优先级 10
  | 'security-review' // 优先级 10.5
  | 'ultrathink'  // 优先级 11
  | 'deepsearch'  // 优先级 12
  | 'deep-interview' // 优先级 13.5
  | 'analyze'     // 优先级 13
  | 'codex'       // 优先级 15
  | 'gemini'      // 优先级 16
  | 'cursor'      // 优先级 17
  | 'ccg';        // 优先级 8.5（Claude-Codex-Gemini 编排）

export interface DetectedKeyword {
  type: KeywordType;
  keyword: string;
  position: number;
}

/**
 * 每个模式的关键词模式
 */
const KEYWORD_PATTERNS: Record<KeywordType, RegExp> = {
  cancel: /\b(cancelwise|stopwise)\b/i,
  ralph: /\b(ralph)\b(?!-)|(랄프)(?!로렌)|(ラルフ)(?!・?ローレン)/i,
  autopilot: /\b(autopilot|auto[\s-]?pilot|fullsend|full\s+auto)\b|(오토파일럿)|(オートパイロット)/i,
  ultrawork: /\b(ultrawork|ulw)\b|(울트라워크)|(ウルトラワーク)/i,
  // team 关键词检测已禁用 —— team 模式现已改为仅通过 /team 技能显式触发。
  // 这样可避免 Claude worker 收到含 "team" 的 prompt 时无限派生子代理。
  team: /(?!x)x/,  // 永不匹配的占位符（类型系统需要该键）
  ralplan: /\b(ralplan)\b|(랄플랜)|(ラルプラン)/i,
  tdd: /\b(tdd)\b|\btest\s+first\b|(테스트\s?퍼스트)|(テスト\s?ファースト)/i,
  'code-review': /\b(code\s+review|review\s+code)\b|(코드\s?리뷰)(?!어)|(コード\s?レビュー)(?!ア)/i,
  'security-review': /\b(security\s+review|review\s+security)\b|(보안\s?리뷰)(?!어)|(セキュリティ[ー]?\s?レビュー)(?!ア)/i,
  ultrathink: /\b(ultrathink)\b|(울트라씽크)|(ウルトラシンク)/i,
  deepsearch: /\b(deepsearch)\b|\bsearch\s+the\s+codebase\b|\bfind\s+in\s+(the\s+)?codebase\b|(딥\s?서치)|(ディープ\s?サーチ)/i,
  analyze: /\b(deep[\s-]?analyze|deepanalyze)\b|(딥\s?분석)|(ディープ\s?アナライズ)/i,
  'deep-interview': /\b(deep[\s-]interview|ouroboros)\b|(딥인터뷰)|(ディープインタビュー)/i,
  ccg: /\b(ccg|claude-codex-gemini)\b|(씨씨지)|(シーシージー)/i,
  codex: /\b(ask|use|delegate\s+to)\s+(codex|gpt)\b/i,
  gemini: /\b(ask|use|delegate\s+to)\s+gemini\b/i,
  cursor: /\b(ask|use|delegate\s+to)\s+cursor\b/i
};

/**
 * 匹配 prompt 开头的上游 Ouroboros CLI 调用形式：
 * `ouroboros <sub>`、`ooo <sub>` 或 `/ouroboros:<sub>`。用作 deep-interview 触发器的
 * 跳过判定，使直接 CLI 调用不会被改路由到 WISE 技能。
 */
const OUROBOROS_BRAND_AT_START = /^\s*\/?(?:ouroboros|ooo)\b/i;

/**
 * 可选的逐关键词跳过判定。当判定对给定 prompt 返回 true 时，即使对应关键词
 * 正则本应命中，该匹配也会被抑制。用于窄范围的误报防护。
 *
 * `deep-interview` 会匹配裸品牌名 `ouroboros`，这会在上游 CLI 调用
 * （如 `ouroboros auto "X"`、`ooo auto`、`/ouroboros:auto`）时触发。该判定
 * 在这些场景下让位于上游 CLI，而不改变触发器在其他位置的识别行为。
 */
const KEYWORD_SKIP_PREDICATES: Partial<Record<KeywordType, (text: string) => boolean>> = {
  'deep-interview': (text) => OUROBOROS_BRAND_AT_START.test(text),
};

/**
 * 关键词检测的优先级顺序
 */
const KEYWORD_PRIORITY: KeywordType[] = [
  'cancel', 'ralph', 'autopilot', 'team', 'ultrawork',
  'ccg', 'ralplan', 'tdd', 'code-review', 'security-review',
  'ultrathink', 'deepsearch', 'analyze', 'deep-interview', 'codex', 'gemini', 'cursor'
];

/**
 * 通过显式斜杠调用检测的规范工作流技能。
 * 镜像 `skill-state/index.ts` 中的 `CANONICAL_WORKFLOW_SKILLS`。此处列出
 * （而非 import）是为了让 keyword-detector 不依赖 skill-state，避免跨模块依赖。
 */
const CANONICAL_WORKFLOW_SLASH_SKILLS = [
  'autopilot',
  'ralph',
  'team',
  'ultrawork',
  'ultraqa',
  'deep-interview',
  'ralplan',
  'self-improve',
] as const;

export type CanonicalWorkflowSlashSkill =
  (typeof CANONICAL_WORKFLOW_SLASH_SKILLS)[number];

/**
 * 将工作流斜杠技能映射到关键词类型，使显式斜杠调用能与普通关键词检测一并浮现。
 * 没有专属 KeywordType 的技能（`ultraqa`、`self-improve`）有意缺省 ——
 * 桥接通过解析器结果而非关键词优先级循环来注入它们。
 */
const SLASH_SKILL_TO_KEYWORD_TYPE: Partial<
  Record<CanonicalWorkflowSlashSkill, KeywordType>
> = {
  autopilot: 'autopilot',
  ralph: 'ralph',
  team: 'team',
  ultrawork: 'ultrawork',
  'deep-interview': 'deep-interview',
  ralplan: 'ralplan',
};

const WORKFLOW_SLASH_PATTERN = new RegExp(
  '^\\s*/(?:wise:|wise:)?(' +
    CANONICAL_WORKFLOW_SLASH_SKILLS
      .map((skill) => skill.replace(/-/g, '\\-'))
      .join('|') +
    ')(?=\\s|$|[?!.,;:])',
  'i',
);

export interface ExplicitWorkflowSlashInvocation {
  /** 规范工作流技能名（小写，无 `wise:` 前缀）。 */
  skill: CanonicalWorkflowSlashSkill;
  /** 斜杠命令后的尾随参数。 */
  args: string;
  /** 原始匹配前缀（含任意命名空间前缀和技能名）。 */
  raw: string;
}

/**
 * 解析 prompt 开头的显式工作流斜杠调用。
 *
 * 针对规范工作流技能列表，识别 `/<skill>`、`/wise:<skill>` 和 `/wise:<skill>`。
 * 会先剥离代码围栏和行内反引号，使被引用的命令不致匹配。尾随前瞻
 * （空白、文本结尾或标点）可防止 `/ralph-logs/foo.txt` 这类文件路径匹配 `/ralph`。
 *
 * 不存在显式调用时返回 `null`。
 */
export function parseExplicitWorkflowSlashInvocation(
  promptText: string,
): ExplicitWorkflowSlashInvocation | null {
  if (typeof promptText !== 'string' || promptText.length === 0) return null;
  const stripped = removeCodeBlocks(promptText);
  const match = WORKFLOW_SLASH_PATTERN.exec(stripped);
  if (!match) return null;
  const skill = match[1].toLowerCase() as CanonicalWorkflowSlashSkill;
  const args = stripped.slice(match[0].length).trim();
  return { skill, args, raw: match[0] };
}

/**
 * 从文本中移除代码块以防误报
 * 同时处理围栏代码块和行内代码
 */
export function removeCodeBlocks(text: string): string {
  // 移除围栏代码块（``` 或 ~~~）
  let result = text.replace(/```[\s\S]*?```/g, '');
  result = result.replace(/~~~[\s\S]*?~~~/g, '');

  // 移除行内代码（单反引号）
  result = result.replace(/`[^`]+`/g, '');

  return result;
}

const PASTED_MAGIC_KEYWORD_HEADER_PATTERN =
  /^\s*\[MAGIC KEYWORDS?(?: DETECTED)?:.*$/i;
const ROLE_BOUNDARY_PATTERN =
  /^<\s*\/?\s*(system|human|assistant|user|tool_use|tool_result)\b[^>]*>/i;
const SKILL_TRANSCRIPT_LINE_PATTERN =
  /^\s*Skill:\s+oh-my-(?:claudecode|codex):/i;
const USER_REQUEST_LINE_PATTERN = /^\s*User request(?:\s*\([^)]*\))?:\s*$/i;
const SHELL_TRANSCRIPT_LINE_PATTERN = /^\s*[$%❯]\s+/;
const GIT_DIFF_START_PATTERNS: RegExp[] = [
  /^diff\s+--git\s+a\//,
  /^index\s+[0-9a-f]+\.\.[0-9a-f]+(?:\s+\d+)?$/i,
  /^(?:---|\+\+\+)\s+[ab]\//,
  /^@@\s+-\d+/,
];
const GIT_DIFF_CONTINUATION_PATTERNS: RegExp[] = [
  /^new file mode\s+\d+$/i,
  /^deleted file mode\s+\d+$/i,
  /^similarity index\s+\d+%$/i,
  /^rename (?:from|to)\s+/i,
  /^Binary files .+ differ$/i,
  /^(?:diff\s+--git\s+a\/|index\s+[0-9a-f]+\.\.[0-9a-f]+|(?:---|\+\+\+)\s+[ab]\/|@@\s+-\d+)/i,
  /^[ +\-].*/,
];

function stripPastedCommandPayloads(text: string): string {
  const lines = text.split('\n');
  const sanitized: string[] = [];
  let insideRoleBlock = false;
  let insideDiffBlock = false;
  let insideMagicKeywordBlock = false;
  let magicBlockSawUserRequest = false;
  let magicBlockSawRequestPayload = false;
  let previousLineWasUserRequest = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (insideMagicKeywordBlock) {
      if (ROLE_BOUNDARY_PATTERN.test(trimmed)) {
        insideRoleBlock = !/^<\s*\//.test(trimmed);
        insideMagicKeywordBlock = false;
        magicBlockSawUserRequest = false;
        magicBlockSawRequestPayload = false;
        continue;
      }

      if (USER_REQUEST_LINE_PATTERN.test(line)) {
        magicBlockSawUserRequest = true;
        magicBlockSawRequestPayload = false;
        continue;
      }

      if (magicBlockSawUserRequest) {
        if (trimmed) {
          magicBlockSawRequestPayload = true;
          continue;
        }

        if (magicBlockSawRequestPayload) {
          insideMagicKeywordBlock = false;
          magicBlockSawUserRequest = false;
          magicBlockSawRequestPayload = false;
          sanitized.push(line);
          continue;
        }
      }

      continue;
    }

    if (PASTED_MAGIC_KEYWORD_HEADER_PATTERN.test(line)) {
      insideMagicKeywordBlock = true;
      magicBlockSawUserRequest = false;
      magicBlockSawRequestPayload = false;
      continue;
    }

    if (ROLE_BOUNDARY_PATTERN.test(trimmed)) {
      insideRoleBlock = !/^<\s*\//.test(trimmed);
      continue;
    }

    if (insideRoleBlock) {
      continue;
    }

    if (!trimmed) {
      sanitized.push(line);
      insideDiffBlock = false;
      previousLineWasUserRequest = false;
      continue;
    }

    if (previousLineWasUserRequest) {
      previousLineWasUserRequest = false;
      continue;
    }

    if (USER_REQUEST_LINE_PATTERN.test(line) || SKILL_TRANSCRIPT_LINE_PATTERN.test(line)) {
      previousLineWasUserRequest = USER_REQUEST_LINE_PATTERN.test(line);
      continue;
    }

    if (SHELL_TRANSCRIPT_LINE_PATTERN.test(line) && !/^\s*\$\w/.test(line)) {
      continue;
    }

    if (insideDiffBlock) {
      if (GIT_DIFF_CONTINUATION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        continue;
      }
      insideDiffBlock = false;
    }

    if (GIT_DIFF_START_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      insideDiffBlock = true;
      continue;
    }

    sanitized.push(line);
  }

  return sanitized.join('\n');
}


/**
 * 用于 prompt 翻译检测、匹配非拉丁文字字符的正则。
 * 使用 Unicode 文字范围（而非原始非 ASCII）以避免对 emoji 和带重音拉丁字符的误报。
 * 覆盖：CJK（日文/中文）、韩文、西里尔文、阿拉伯文、天城文、泰文、缅文。
 */
export const NON_LATIN_SCRIPT_PATTERN =
  // eslint-disable-next-line no-misleading-character-class -- 故意为之：检测文字存在，而非匹配字形簇
  /[\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u1000-\u109F]/u;

/**
 * \u5355\u4E2A\u6587\u4EF6\u8DEF\u5F84\u6BB5\u7684\u5B57\u7B26\u7C7B\u3002\u5305\u542B `\w.-` \u4EE5\u53CA\u4E0E NON_LATIN_SCRIPT_PATTERN \u76F8\u540C\u7684
 * \u975E\u62C9\u4E01\u6587\u5B57\u8303\u56F4\uFF0C\u4F7F CJK \u7B49\u6587\u4EF6\u540D\uFF08\u5982 `docs/\u30B3\u30FC\u30C9\u30EC\u30D3\u30E5\u30FC.md`\uFF09
 * \u80FD\u88AB\u8BC6\u522B\u4E3A\u8DEF\u5F84\u5E76\u5728\u5173\u952E\u8BCD\u68C0\u6D4B\u524D\u5265\u79BB\u3002\u5426\u5219\u5D4C\u5165\u8DEF\u5F84\u7684 CJK \u522B\u540D\u4F1A\u6B8B\u7559\u8FC7\u6E05\u7406\uFF0C
 * \u8BEF\u6FC0\u6D3B\u5176\u6A21\u5F0F\uFF08\u8DEF\u5F84\u68C0\u6D4B\u7528\u88F8 `[\w.-]`\uFF0C\u4EC5 ASCII\uFF09\u3002\u4ECE\u8BE5\u5171\u4EAB\u5E38\u91CF\u6784\u5EFA\u8DEF\u5F84\u6B63\u5219\uFF0C
 * \u53EF\u907F\u514D\u5B57\u7B26\u7C7B\u5728\u4E0B\u65B9\u591A\u5904\u91CD\u590D\u4F7F\u7528\u4E2D\u53D1\u751F\u6F02\u79FB\u3002
 */
const PATH_SEGMENT_CHARS =
  '[\\w.\\-\\u3000-\\u9FFF\\uAC00-\\uD7AF\\u0400-\\u04FF\\u0600-\\u06FF\\u0900-\\u097F\\u0E00-\\u0E7F\\u1000-\\u109F]';

/**
 * sanitizeForKeywordDetection 使用的文件路径匹配器。要求至少一个以斜杠结尾的
 * 目录段 `(?:SEG+/)+`（可选地以 `/` 开头；前导 `./` 会被首段吸收，因为 SEG 含 `.`），
 * 随后是最终段：以 ASCII `.ext` 结尾的（支持 CJK）词干，或纯 ASCII 无扩展名名称。
 * 目录/词干段支持 Unicode（PATH_SEGMENT_CHARS），因此 CJK 文件名也会被剥离；
 * 而路径后无空格的 CJK 指令不会被贪婪尾部消费。与运行时 `.mjs` 路径剥离器结构
 * 相同，使 index.ts 和 .mjs 对每个路径输入产生相同关键词结果 —— 检测器与打包产物
 * 无分歧。像 `/ralph` 这类裸斜杠命令没有内部斜杠，故此处不剥离（且本就通过
 * parseExplicitWorkflowSlashInvocation 在清理前检测）。
 */
/* eslint-disable no-misleading-character-class -- 与 NON_LATIN_SCRIPT_PATTERN 相同的文字范围：故意的范围集合，非字形簇 */
const FILE_PATH_PATTERN = new RegExp(
  '(^|[\\s"\'`(])(?:\\/)?(?:' +
    PATH_SEGMENT_CHARS +
    '+\\/)+(?:' +
    PATH_SEGMENT_CHARS +
    '*\\.\\w+|[\\w.\\-]+)',
  'gm',
);
/* eslint-enable no-misleading-character-class */

/**
* 通过移除结构性噪声为关键词检测清理文本。
 * 剥离 XML 标签、URL、文件路径和代码块。
 */
export function sanitizeForKeywordDetection(text: string): string {
  let result = stripPastedCommandPayloads(text);
  // 先移除 HTML/markdown 注释，避免注释内的关键词触发模式
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  // 移除 XML 标签块（开标签 + 内容 + 闭标签；标签名须匹配）
  result = result.replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '');
  // 移除自闭合 XML 标签
  result = result.replace(/<\w[\w-]*(?:\s[^>]*)?\s*\/>/g, '');
  // 移除 URL
  result = result.replace(/https?:\/\/\S+/g, '');
  // 移除引用块和 markdown 表格行 —— 它们通常是参考内容
  result = result.replace(/^\s*>\s.*$/gm, '');
  result = result.replace(/^\s*\|(?:[^|\n]*\|){2,}\s*$/gm, '');
  result = result.replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*$/gm, '');
  // 移除文件路径 —— 要求以 / 或 ./ 开头，或多段 dir/file.ext。
  // 段支持 Unicode（FILE_PATH_PATTERN），CJK 文件名也会被剥离。
  result = result.replace(FILE_PATH_PATTERN, '$1');
  // 移除代码块（围栏与行内）
  result = removeCodeBlocks(result);
  return result;
}

const INFORMATIONAL_INTENT_PATTERNS: RegExp[] = [
  /\b(?:what(?:'s|\s+is)|what\s+are|how\s+(?:to|do\s+i)\s+use|explain|explanation|tell\s+me\s+about|describe)\b/i,
  /(?:뭐야|뭔데|무엇(?:이야|인가요)?|어떻게|설명(?!서\s*(?:작성|만들|생성|추가|업데이트|수정|편집|쓰))|사용법|알려\s?줘|알려줄래|소개해?\s?줘|소개\s*부탁|설명해\s?줘|뭐가\s*달라|어떤\s*기능|기능\s*(?:알려|설명|뭐)|방법\s*(?:알려|설명|뭐))/u,
  /(?:とは|って何|使い方|説明|(?:について|に関して|違い)[^\n]{0,24}(?:教えて|説明|知りたい)|(?:どう|何が|どこが)違う)/u,
  /(?:什么是|怎(?:么|樣)用|如何使用|解释|說明|说明)/u,
];
const INFORMATIONAL_CONTEXT_WINDOW = 80;
const QUOTED_SPAN_PATTERN =
  /"[^"\n]{1,400}"|'[^'\n]{1,400}'|“[^”\n]{1,400}”|‘[^’\n]{1,400}’/g;
const REFERENCE_META_PATTERNS: RegExp[] = [
  /\b(?:vs\.?|versus|compared\s+to|comparison|compare|article|blog\s+post|documentation|docs?|reference)\b/i,
  /(?:비교|차이|설명|정리|문서|자료|가이드|이\s*(?:글|비교|문서)는|블로그)/u,
  /\b(?:this\s+(?:article|comparison|guide|documentation|doc)|quoted|quote(?:d)?)\b/i,
];
const REFERENCE_EXPLANATION_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*(?:결론|특징|예시|요약|장점|단점|설명)\s*[:：]/u,
  /\b(?:summary|conclusion|key\s+points?|example|examples|pros|cons|overview)\s*:/i,
  /[^\n]{1,80}=\s*["“]/,
  /[→⇒]/,
];
const QUESTION_FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(?:how\s+many|how\s+much|why|what\s+happened|what\s+went\s+wrong|token\s+budget|cost|pricing)\b/i,
  /(?:왜|얼마|몇\s*번|몇번|토큰|가격|비용|질문)/u,
];
const MODE_REFERENCE_PATTERN =
  /\b(?:ralph|autopilot|auto[\s-]?pilot|ultrawork|ulw|ralplan|ultrathink|deepsearch|deep[\s-]?analyze|deepanalyze|deep[\s-]interview|ouroboros|ccg|claude-codex-gemini|deerflow)\b/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getLineBounds(text: string, position: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const nextNewline = text.indexOf('\n', position);
  const end = nextNewline === -1 ? text.length : nextNewline;
  return { start, end };
}

function isWithinQuotedSpan(text: string, position: number): boolean {
  for (const match of text.matchAll(QUOTED_SPAN_PATTERN)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (position >= start && position < end) {
      return true;
    }
  }
  return false;
}

function stripQuotedSpans(text: string): string {
  return text.replace(QUOTED_SPAN_PATTERN, ' ');
}

function countDistinctModeReferences(text: string): number {
  const matches = text.match(MODE_REFERENCE_PATTERN) ?? [];
  const normalized = new Set(
    matches.map((match) => match.toLowerCase().replace(/\s+/g, '').replace(/-/g, '')),
  );
  return normalized.size;
}

function looksLikeReferenceContent(text: string): boolean {
  const hasReferenceMeta = REFERENCE_META_PATTERNS.some((pattern) => pattern.test(text));
  const hasExplanationShape = REFERENCE_EXPLANATION_PATTERNS.some((pattern) => pattern.test(text));
  const hasAnyModeMention = countDistinctModeReferences(text) >= 1;
  const hasMultipleModeMentions = countDistinctModeReferences(text) >= 2;
  const hasQuestionOutsideQuotes = QUESTION_FOLLOWUP_PATTERNS.some((pattern) =>
    pattern.test(stripQuotedSpans(text)),
  );

  return (
    (hasReferenceMeta && (hasExplanationShape || hasAnyModeMention || hasQuestionOutsideQuotes)) ||
    (hasExplanationShape && (hasMultipleModeMentions || hasQuestionOutsideQuotes)) ||
    (hasMultipleModeMentions && hasQuestionOutsideQuotes)
  );
}

function hasActivationIntentNearKeyword(context: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.trim());
  if (!escaped) return false;

  // 求助式提问（如 "How do I use autopilot?"）不应
  // 被视为激活意图。
  const helpQuestionPatterns = [
    new RegExp(`\\bhow\\s+do\\s+i\\s+use\\b[^\\n]{0,40}\\b${escaped}\\b`, 'i'),
    new RegExp(`\\bwhat(?:'s|\\s+is)\\b[^\\n]{0,40}\\b${escaped}\\b[^\\n]{0,40}\\bhow\\s+to\\s+use\\b`, 'i'),
  ];
  if (helpQuestionPatterns.some((pattern) => pattern.test(context))) {
    return false;
  }

  const patterns = [
    new RegExp(`\\b(?:use|run|start|enable|activate|invoke|trigger|launch)\\b[^\\n]{0,28}\\b${escaped}\\b`, 'i'),
    new RegExp(`\\b(?:fix|debug|investigate|resolve|handle|patch|address)\\b[^\\n]{0,28}\\b(?:issue|bug|problem|error)\\b[^\\n]{0,12}\\b(?:with|in)\\s+\\b${escaped}\\b`, 'i'),

  ];

  return patterns.some((pattern) => pattern.test(context));
}

function hasDirectInvocationPrefix(text: string, position: number): boolean {
  const prefix = text.slice(0, position);
  return /^\s*(?:[$/!]\s*|force:\s*|oh-my-(?:claudecode|codex):\s*)?$/i.test(prefix);
}

function hasExplicitInvocationContext(
  text: string,
  position: number,
  keywordLength: number,
  keywordText: string,
): boolean {
  if (hasDirectInvocationPrefix(text, position)) {
    return true;
  }

  const start = Math.max(0, position - INFORMATIONAL_CONTEXT_WINDOW);
  const end = Math.min(text.length, position + keywordLength + INFORMATIONAL_CONTEXT_WINDOW);
  const context = text.slice(start, end);
  if (hasActivationIntentNearKeyword(context, keywordText)) {
    return true;
  }

  const escaped = escapeRegExp(keywordText.trim());
  if (!escaped) {
    return false;
  }

  const conversationalInvocationPatterns = [
    new RegExp(`\\bplease\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\blet['’]?s\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\bi\\s+(?:want|need|would\\s+like)\\s+(?:a|an)\\s+${escaped}\\b`, 'i'),
    new RegExp(`\\b(?:can|could|would|will)\\s+you\\s+${escaped}\\b`, 'i'),
  ];

  return conversationalInvocationPatterns.some((pattern) => pattern.test(context));
}

function hasDiagnosticIntentNearKeyword(context: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.trim());
  if (!escaped) return false;

  const patterns = [
    new RegExp(`\\b${escaped}\\b[^\\n]{0,48}\\b(?:keeps?\\s+(?:looping|re-?running)|has\\s+(?:a\\s+)?(?:bug|issue|problem|error)|is\\s+(?:stuck|broken|failing)|loop(?:ing)?)\\b`, 'i'),
    new RegExp(`\\b(?:bug|issue|problem|error)\\b[^\\n]{0,16}\\b(?:with|in)\\s+\\b${escaped}\\b`, 'i'),
    new RegExp(`${escaped}.{0,14}(?:자꾸|계속).{0,14}(?:재실행|반복|루프|멈추)`, 'u'),
    // 日文：重复失败抱怨 —— 上方韩文 자꾸/계속 行的直接镜像
    // （频度副词 + 问题动词）。无 P2 主语助词模式 / 无工作请求逃逸：与韩文对齐。
    new RegExp(`${escaped}[^\\n]{0,16}(?:また|何度も|ずっと|頻繁|繰り返|いつも)[^\\n]{0,16}(?:失敗|エラー|ループ|止ま|落ち|再実行|動かな|フリーズ|壊れ|クラッシュ|こけ|暴走|無限)`, 'u'),
  ];

  return patterns.some((pattern) => pattern.test(context));
}

function isRalphUltraworkMetaOrBanterContext(context: string, keywordText: string): boolean {
  const normalizedKeyword = keywordText.toLowerCase().replace(/\s+/g, '');
  if (!['ralph', '랄프', 'ラルフ', 'ultrawork', 'ulw', 'uw', '울트라워크', 'ウルトラワーク'].includes(normalizedKeyword)) {
    return false;
  }

  const currentKeywordAliases = normalizedKeyword === 'ralph' || normalizedKeyword === '랄프' || normalizedKeyword === 'ラルフ'
    ? ['랄프', 'ラルフ']
    : ['울트라워크', 'ウルトラワーク'];
  const currentKeywordPattern = currentKeywordAliases.join('|');
  const imperativeVerbPattern = '켜|켜줘|실행|시작|돌려|돌려줘|써|써줘|사용해|진행해';
  const koreanImperativePatterns = [
    new RegExp(`(?:${currentKeywordPattern})[^?？\n]{0,16}(?:${imperativeVerbPattern})`, 'u'),
    new RegExp(`(?:${imperativeVerbPattern})[^?？\n]{0,16}(?:${currentKeywordPattern})`, 'u'),
  ];
  if (koreanImperativePatterns.some((pattern) => pattern.test(context))) {
    return false;
  }

  const metaOrBanterPatterns = [
    /[?？].{0,12}(?:ㅋ{1,}|ㅎ{1,}|lol|lmao)/iu,
    /(?:ㅋ{1,}|ㅎ{1,}|lol|lmao).{0,40}[?？]/iu,
    /(?:ralph|랄프|ultrawork|ulw|uw|울트라워크).{0,40}(?:라도|줘야\s*해|쥐어\s*줘야\s*해|해야\s*해).{0,20}[?？]/iu,
    /(?:관계|관련|연관|차이|비교).{0,40}(?:뭐|무엇|어떻게|설명|알려|궁금|인가|야|냐|니|까|[?？])/u,
    /(?:뭐|무엇|어떻게|설명|알려|궁금).{0,40}(?:관계|관련|연관|차이|비교)/u,
  ];

  return metaOrBanterPatterns.some((pattern) => pattern.test(context));
}

function isInformationalKeywordContext(text: string, position: number, keywordLength: number, keywordText?: string): boolean {
  const start = Math.max(0, position - INFORMATIONAL_CONTEXT_WINDOW);
  const end = Math.min(text.length, position + keywordLength + INFORMATIONAL_CONTEXT_WINDOW);
  const context = text.slice(start, end);
  const hasInformationalIntent = INFORMATIONAL_INTENT_PATTERNS.some((pattern) => pattern.test(context));
  const hasStrongHelpQueryIntent = /\?|？|\b(?:how\s+(?:to|do\s+i)\s+use|what(?:'s|\s+is)|explain|describe|tell\s+me\s+about)\b|(?:사용법|使い方|什么是|怎么用|如何使用)/iu.test(context);
  const lineBounds = getLineBounds(text, position);
  const line = text.slice(lineBounds.start, lineBounds.end);
  const questionOutsideQuotes = stripQuotedSpans(text);
  const keywordInsideQuotes = isWithinQuotedSpan(text, position);

  if (keywordText) {
    const hasActivationIntent = hasActivationIntentNearKeyword(context, keywordText);
    const hasExecutionDirective = /\b(?:fix|debug|investigate|resolve|handle|patch|address|implement|build)\b/i.test(context);

    // 显式命令 + 执行意图应保持可操作，即使
    // 周围消息也含有求助提问。
    if (hasActivationIntent && hasExecutionDirective) {
      return false;
    }

    // 求助式信息查询不得激活执行模式，
    // 即使其中含有 "use <keyword>" 之类的短语。
    if (hasInformationalIntent && hasStrongHelpQueryIntent) {
      return true;
    }

    if (hasActivationIntent) {
      return false;
    }

    if (isRalphUltraworkMetaOrBanterContext(context, keywordText)) {
      return true;
    }

    if (hasDiagnosticIntentNearKeyword(context, keywordText)) {
      return true;
    }
  }

  if (/^\s*>\s/.test(line) || /^\s*\|(?:[^|\n]*\|){2,}\s*$/.test(line)) {
    return true;
  }

  if (keywordInsideQuotes && QUESTION_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(questionOutsideQuotes))) {
    return true;
  }

  if (looksLikeReferenceContent(text)) {
    return true;
  }

  return hasInformationalIntent;
}

function findActionableKeywordMatch(
  text: string,
  pattern: RegExp,
): Omit<DetectedKeyword, 'type'> | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);

  for (const match of text.matchAll(globalPattern)) {
    if (match.index === undefined) {
      continue;
    }

    const keyword = match[0];
    if (isInformationalKeywordContext(text, match.index, keyword.length, keyword)) {
      continue;
    }

    return {
      keyword,
      position: match.index,
    };
  }

  return null;
}

function findActionableRalplanMatch(
  text: string,
  pattern: RegExp,
): Omit<DetectedKeyword, 'type'> | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);

  for (const match of text.matchAll(globalPattern)) {
    if (match.index === undefined) {
      continue;
    }

    const keyword = match[0];
    if (isInformationalKeywordContext(text, match.index, keyword.length, keyword)) {
      continue;
    }

    if (!hasExplicitInvocationContext(text, match.index, keyword.length, keyword)) {
      continue;
    }

    return {
      keyword,
      position: match.index,
    };
  }

  return null;
}

/**
 * 从消息部件中提取 prompt 文本
 */
export function extractPromptText(
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
): string {
  return parts
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join(' ');
}

/**
 * 检测文本中的关键词并返回带类型信息的匹配
 */
export function detectKeywordsWithType(
  text: string,
  _agentName?: string
): DetectedKeyword[] {
  const detected: DetectedKeyword[] = [];

  // 在清理前检查显式规范工作流斜杠调用。
  // 通用清理器会把裸 `/word` 记号当作文件路径剥离，因此 `/ralph fix auth` 这类
  // 裸命令否则永不会匹配。此处须对周围空白、命名空间前缀（`/wise:`、
  // `/wise:`）以及代码围栏/反引号包裹（由解析器内 removeCodeBlocks 处理）健壮。
  const explicitSlash = parseExplicitWorkflowSlashInvocation(text);
  const explicitSlashType = explicitSlash
    ? SLASH_SKILL_TO_KEYWORD_TYPE[explicitSlash.skill]
    : undefined;
  if (explicitSlash && explicitSlashType) {
    const position = Math.max(0, text.indexOf(explicitSlash.raw.trim()));
    detected.push({
      type: explicitSlashType,
      keyword: explicitSlash.raw.trim(),
      position,
    });
  }

  const cleanedText = sanitizeForKeywordDetection(text);

  // 检查每个关键词类型
  for (const type of KEYWORD_PRIORITY) {
    // team 关键词检测已禁用 —— team 模式现已改为仅通过 /team 技能显式触发
    if (type === 'team') {
      continue;
    }

    // 跳过显式斜杠检测器已浮现的类型，避免
    // 为同一意图发出重复条目。
    if (explicitSlashType && type === explicitSlashType) {
      continue;
    }

    const pattern = KEYWORD_PATTERNS[type];
    const skipPredicate = KEYWORD_SKIP_PREDICATES[type];
    if (skipPredicate && skipPredicate(cleanedText)) {
      continue;
    }
    const match =
      type === 'ralplan'
        ? findActionableRalplanMatch(cleanedText, pattern)
        : findActionableKeywordMatch(cleanedText, pattern);

    if (match) {
      detected.push({
        ...match,
        type,
      });
    }
  }

  return detected;
}

/**
 * 检查文本是否含有任意魔法关键词
 */
export function hasKeyword(text: string): boolean {
  return detectKeywordsWithType(text).length > 0;
}

/**
 * 获取所有已检测关键词（已应用冲突解决）
 */
export function getAllKeywords(text: string): KeywordType[] {
  const detected = detectKeywordsWithType(text);

  if (detected.length === 0) return [];

  let types = [...new Set(detected.map(d => d.type))];

  // 互斥：cancel 抑制一切
  if (types.includes('cancel')) return ['cancel'];

  // 互斥：team 胜过 autopilot
  if (types.includes('team') && types.includes('autopilot')) {
    types = types.filter(t => t !== 'autopilot');
  }

  // 按优先级顺序排序
  return KEYWORD_PRIORITY.filter(k => types.includes(k));
}

/**
 * 任务大小感知的关键词过滤选项
 */
export interface TaskSizeFilterOptions {
  /** Enable task-size detection. Default: true */
  enabled?: boolean;
  /** Word count threshold for small tasks. Default: 50 */
  smallWordLimit?: number;
  /** Word count threshold for large tasks. Default: 200 */
  largeWordLimit?: number;
  /** Suppress heavy modes for small tasks. Default: true */
  suppressHeavyModesForSmallTasks?: boolean;
}

/**
 * 任务大小感知的关键词检测结果
 */
export interface TaskSizeAwareKeywordsResult {
  keywords: KeywordType[];
  taskSizeResult: TaskSizeResult | null;
  suppressedKeywords: KeywordType[];
}

/**
 * 获取所有关键词（已应用基于任务大小的过滤）。
 * 对小任务，抑制重型编排模式（ralph/autopilot/team/ultrawork 等），
 * 以避免过度编排。
 *
 * 推荐在桥接钩子中使用本函数进行关键词检测。
 */
export function getAllKeywordsWithSizeCheck(
  text: string,
  options: TaskSizeFilterOptions = {},
): TaskSizeAwareKeywordsResult {
  const {
    enabled = true,
    smallWordLimit = 50,
    largeWordLimit = 200,
    suppressHeavyModesForSmallTasks = true,
  } = options;

  const keywords = getAllKeywords(text);

  if (!enabled || !suppressHeavyModesForSmallTasks || keywords.length === 0) {
    return { keywords, taskSizeResult: null, suppressedKeywords: [] };
  }

  const thresholds: TaskSizeThresholds = { smallWordLimit, largeWordLimit };
  const taskSizeResult = classifyTaskSize(text, thresholds);

  // 仅对小任务抑制重型模式
  if (taskSizeResult.size !== 'small') {
    return { keywords, taskSizeResult, suppressedKeywords: [] };
  }

  const suppressedKeywords: KeywordType[] = [];
  const filteredKeywords = keywords.filter(keyword => {
    if (isHeavyMode(keyword)) {
      suppressedKeywords.push(keyword);
      return false;
    }
    return true;
  });

  return {
    keywords: filteredKeywords,
    taskSizeResult,
    suppressedKeywords,
  };
}

/**
 * 获取已检测到的最高优先级关键词（已应用冲突解决）
 */
export function getPrimaryKeyword(text: string): DetectedKeyword | null {
  const allKeywords = getAllKeywords(text);

  if (allKeywords.length === 0) {
    return null;
  }

  // 获取最高优先级的关键词类型
  const primaryType = allKeywords[0];

  // 查找该类型的原始已检测关键词
  const detected = detectKeywordsWithType(text);
  const match = detected.find(d => d.type === primaryType);

  return match || null;
}

/**
 * 受 ralplan 优先门控（issue #997）约束的执行模式关键词。
 * 这些模式会启动重型编排，不应在模糊请求上运行。
 */
export const EXECUTION_GATE_KEYWORDS = new Set<KeywordType>([
  'ralph',
  'autopilot',
  'team',
  'ultrawork',
]);

/**
 * 绕过 ralplan 门控的逃逸前缀。
 */
const GATE_BYPASS_PREFIXES = ['force:', '!'];

/**
 * 表明 prompt 已足够具体、可直接执行的正向信号。
 * 若存在任意一个，prompt 即自动通过门控（快速路径）。
 */
const WELL_SPECIFIED_SIGNALS: RegExp[] = [
  // 通过扩展名引用具体文件
  /\b[\w/.-]+\.(?:ts|js|py|go|rs|java|tsx|jsx|vue|svelte|rb|c|cpp|h|css|scss|html|json|yaml|yml|toml)\b/,
  // 通过目录分隔符引用具体路径
  /(?:src|lib|test|spec|app|pages|components|hooks|utils|services|api|dist|build|scripts)\/\w+/,
  // 通过关键字引用具体函数/类/方法
  /\b(?:function|class|method|interface|type|const|let|var|def|fn|struct|enum)\s+\w{2,}/i,
  // 驼峰标识符（可能是符号名：processKeyword、getUserById）
  /\b[a-z]+(?:[A-Z][a-z]+)+\b/,
  // 帕斯卡标识符（可能是类/类型名：KeywordDetector、UserModel）
  /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b/,
  // 含 2+ 段的下划线标识符（可能是符号名：user_model、get_user）
  /\b[a-z]+(?:_[a-z]+)+\b/,
  // 裸 issue/PR 编号（#123、#42）
  /(?:^|\s)#\d+\b/,
  // 含编号步骤或项目符号列表（结构化请求）
  /(?:^|\n)\s*(?:\d+[.)]\s|-\s+\S|\*\s+\S)/m,
  // 含验收标准或测试规约关键字
  /\b(?:acceptance\s+criteria|test\s+(?:spec|plan|case)|should\s+(?:return|throw|render|display|create|delete|update))\b/i,
  // 含具体错误或 issue 引用
  /\b(?:error:|bug\s*#?\d+|issue\s*#\d+|stack\s*trace|exception|TypeError|ReferenceError|SyntaxError)\b/i,
  // 含内容充实的代码块。
  // 注意：在 bridge.ts 集成中，cleanedText 的代码块已被
  // removeCodeBlocks() 预先剥离，因此该正则在那里不会匹配。它对直接调用
  // isUnderspecifiedForExecution() 并传入原始 prompt 文本的调用者仍有用。
  /```[\s\S]{20,}?```/,
  // PR 或 commit 引用
  /\b(?:PR\s*#\d+|commit\s+[0-9a-f]{7}|pull\s+request)\b/i,
  // "in <具体路径>" 模式
  /\bin\s+[\w/.-]+\.(?:ts|js|py|go|rs|java|tsx|jsx)\b/,
  // 测试运行器命令（显式测试目标）
  /\b(?:npm\s+test|npx\s+(?:vitest|jest)|pytest|cargo\s+test|go\s+test|make\s+test)\b/i,
];

/**
 * 检查 prompt 是否过于笼统、不适合直接执行。
 * 当 prompt 缺乏足够具体性以支撑重型执行模式时返回 true。
 *
 * 保守策略：仅门控明显模糊的 prompt。边界情形放行。
 */
export function isUnderspecifiedForExecution(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // 逃逸口：force: 或 ! 前缀绕过门控
  for (const prefix of GATE_BYPASS_PREFIXES) {
    if (trimmed.startsWith(prefix)) return false;
  }

  // 若存在任意足够具体的信号，则放行
  if (WELL_SPECIFIED_SIGNALS.some(p => p.test(trimmed))) return false;

  // 剥离模式关键词以便有效词数统计
  const stripped = trimmed
    .replace(/\b(?:ralph|autopilot|team|ultrawork|ulw)\b/gi, '')
    .trim();
  const effectiveWords = stripped.split(/\s+/).filter(w => w.length > 0).length;

  // 无足够具体信号的短 prompt 视为过于笼统
  if (effectiveWords <= 15) return true;

  return false;
}

/**
 * 应用 ralplan 优先门控（issue #997）：若存在执行关键词但 prompt 过于笼统，
 * 则重定向到 ralplan。
 *
 * 返回修改后的关键词列表和门控元数据。
 */
export function applyRalplanGate(
  keywords: KeywordType[],
  text: string,
): { keywords: KeywordType[]; gateApplied: boolean; gatedKeywords: KeywordType[] } {
  if (keywords.length === 0) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // 存在 cancel 时不门控（cancel 始终胜出）
  if (keywords.includes('cancel')) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // 列表中已有 ralplan 时不门控
  if (keywords.includes('ralplan')) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // 检查是否存在任意执行关键词
  const executionKeywords = keywords.filter(k => EXECUTION_GATE_KEYWORDS.has(k));
  if (executionKeywords.length === 0) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // 检查 prompt 是否过于笼统
  if (!isUnderspecifiedForExecution(text)) {
    return { keywords, gateApplied: false, gatedKeywords: [] };
  }

  // 门控：用 ralplan 替换执行关键词
  const filtered = keywords.filter(k => !EXECUTION_GATE_KEYWORDS.has(k));
  if (!filtered.includes('ralplan')) {
    filtered.push('ralplan');
  }

  return { keywords: filtered, gateApplied: true, gatedKeywords: executionKeywords };
}
