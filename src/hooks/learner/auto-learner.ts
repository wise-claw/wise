/**
 * 自动学习模块
 *
 * 在工作会话中自动检测值得沉淀为技能的模式。
 * 跟踪问题-方案对并建议提取为技能。
 */

import { createHash } from "crypto";
import type { SkillMetadata } from "./types.js";

const ABSOLUTE_PATH_PATTERN =
  /(?:^|\s)((?:[A-Z]:)?(?:\/|\\)[\w\/\\.-]+\.\w+)/gi;
const RELATIVE_PATH_PATTERN = /(?:^|\s)(\.\.?\/[\w\/.-]+\.\w+)/gi;
const SIMPLE_PATH_PATTERN = /(?:^|\s)([\w-]+(?:\/[\w-]+)+\.\w+)/gi;
const ERROR_MESSAGE_PATTERN = /(?:Error|Exception|Warning):\s*([^\n]+)/gi;
const TYPE_ERROR_PATTERN =
  /(?:Type|Reference|Syntax|Range|URI)Error:\s*([^\n]+)/gi;
const ERROR_CODE_PATTERN = /E[A-Z]+:\s*([^\n]+)/gi;
const QUOTED_STRING_PATTERN = /['"`]([^'"`]+)['"`]/g;
const PASCAL_CASE_PATTERN = /\b([A-Z][a-zA-Z0-9]{2,})\b/g;

/**
 * 检测到的、可沉淀为技能的模式。
 */
export interface PatternDetection {
  id: string;
  problem: string;
  solution: string;
  confidence: number; // 0-100 技能价值评分
  occurrences: number; // 模式出现次数
  firstSeen: number; // 时间戳
  lastSeen: number; // 时间戳
  suggestedTriggers: string[]; // 自动生成的触发器
  suggestedTags: string[]; // 自动生成的标签
}

/**
 * 自动学习会话状态。
 */
export interface AutoLearnerState {
  sessionId: string;
  patterns: Map<string, PatternDetection>;
  suggestedSkills: PatternDetection[]; // 可向用户建议
}

/**
 * 建议技能的默认阈值。
 */
const DEFAULT_SUGGESTION_THRESHOLD = 70;

/**
 * 提升技能价值评分的关键字。
 */
const HIGH_VALUE_KEYWORDS = [
  "error",
  "failed",
  "crash",
  "bug",
  "fix",
  "workaround",
  "solution",
  "resolved",
];

/**
 * 表明技术内容的常见文件扩展名。
 */
const TECHNICAL_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
];

/**
 * 降低技能价值的通用模式。
 */
const GENERIC_PATTERNS = [
  "try again",
  "restart",
  "check the docs",
  "google it",
  "look at the error",
];

/**
 * 为某会话初始化状态。
 */
export function initAutoLearner(sessionId: string): AutoLearnerState {
  return {
    sessionId,
    patterns: new Map(),
    suggestedSkills: [],
  };
}

/**
 * 生成用于去重的内容哈希。
 */
function generateContentHash(problem: string, solution: string): string {
  const normalized = `${problem.toLowerCase().trim()}::${solution.toLowerCase().trim()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * 从文本中提取文件路径。
 */
function extractFilePaths(text: string): string[] {
  const paths: string[] = [];

  // 匹配常见路径模式
  const pathPatterns = [
    ABSOLUTE_PATH_PATTERN,
    RELATIVE_PATH_PATTERN,
    SIMPLE_PATH_PATTERN,
  ];

  for (const pattern of pathPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        paths.push(match[1].trim());
      }
    }
  }

  return [...new Set(paths)];
}

/**
 * 从文本中提取错误消息。
 */
function extractErrorMessages(text: string): string[] {
  const errors: string[] = [];

  // 匹配常见错误模式
  const errorPatterns = [
    ERROR_MESSAGE_PATTERN,
    TYPE_ERROR_PATTERN,
    ERROR_CODE_PATTERN,
  ];

  for (const pattern of errorPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        errors.push(match[1].trim());
      }
    }
  }

  return [...new Set(errors)];
}

/**
 * 从文本中提取关键技术术语。
 */
function extractKeyTerms(text: string): string[] {
  const terms: string[] = [];

  // 提取引号字符串（可能是命令名或技术术语）
  const quotedMatches = text.matchAll(QUOTED_STRING_PATTERN);
  for (const match of quotedMatches) {
    if (match[1] && match[1].length > 2 && match[1].length < 30) {
      terms.push(match[1]);
    }
  }

  // 提取首字母大写的技术术语（如 React、TypeScript 等）
  const capitalizedMatches = text.matchAll(PASCAL_CASE_PATTERN);
  for (const match of capitalizedMatches) {
    if (match[1] && !["The", "This", "That", "There"].includes(match[1])) {
      terms.push(match[1]);
    }
  }

  return [...new Set(terms)];
}

/**
 * 从问题与方案文本中提取触发器。
 */
export function extractTriggers(problem: string, solution: string): string[] {
  const triggers = new Set<string>();

  // 将错误消息加入触发器
  const errors = extractErrorMessages(problem);
  for (const error of errors.slice(0, 3)) {
    // 限制为 3 条错误
    // 取错误消息前 5 个词
    const words = error.split(/\s+/).slice(0, 5).join(" ");
    if (words.length > 5) {
      triggers.add(words);
    }
  }

  // 加入文件路径（仅基名）
  const paths = extractFilePaths(problem + " " + solution);
  for (const path of paths.slice(0, 3)) {
    // 限制为 3 个路径
    const basename = path.split(/[/\\]/).pop();
    if (basename && basename.length > 3) {
      triggers.add(basename);
    }
  }

  // 加入关键术语
  const terms = extractKeyTerms(problem + " " + solution);
  for (const term of terms.slice(0, 5)) {
    // 限制为 5 个术语
    if (term.length > 3 && term.length < 30) {
      triggers.add(term.toLowerCase());
    }
  }

  // 若存在则加入高价值关键字
  const combinedText = (problem + " " + solution).toLowerCase();
  for (const keyword of HIGH_VALUE_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      triggers.add(keyword);
    }
  }

  return Array.from(triggers).slice(0, 10); // 最多 10 个触发器
}

/**
 * 基于内容分析生成标签。
 */
function generateTags(problem: string, solution: string): string[] {
  const tags = new Set<string>();
  const combinedText = (problem + " " + solution).toLowerCase();

  // 语言/框架检测
  const langMap: Record<string, string> = {
    typescript: "typescript",
    javascript: "javascript",
    python: "python",
    react: "react",
    vue: "vue",
    angular: "angular",
    node: "nodejs",
    "node.js": "nodejs",
    rust: "rust",
    go: "golang",
  };

  for (const [keyword, tag] of Object.entries(langMap)) {
    if (combinedText.includes(keyword)) {
      tags.add(tag);
    }
  }

  // 问题类别检测
  if (combinedText.includes("error") || combinedText.includes("bug")) {
    tags.add("debugging");
  }
  if (combinedText.includes("test") || combinedText.includes("spec")) {
    tags.add("testing");
  }
  if (combinedText.includes("build") || combinedText.includes("compile")) {
    tags.add("build");
  }
  if (combinedText.includes("performance") || combinedText.includes("slow")) {
    tags.add("performance");
  }
  if (
    combinedText.includes("security") ||
    combinedText.includes("vulnerability")
  ) {
    tags.add("security");
  }

  // 文件类型检测
  const paths = extractFilePaths(problem + " " + solution);
  for (const path of paths) {
    for (const ext of TECHNICAL_EXTENSIONS) {
      if (path.endsWith(ext)) {
        tags.add("code");
        break;
      }
    }
  }

  return Array.from(tags).slice(0, 5); // 最多 5 个标签
}

/**
 * 计算技能价值评分（0-100）。
 */
export function calculateSkillWorthiness(pattern: PatternDetection): number {
  let score = 50; // 基础分

  const combinedText = (pattern.problem + " " + pattern.solution).toLowerCase();

  // 具体性加分
  const hasFilePaths =
    extractFilePaths(pattern.problem + " " + pattern.solution).length > 0;
  if (hasFilePaths) {
    score += 15;
  }

  const hasErrorMessages = extractErrorMessages(pattern.problem).length > 0;
  if (hasErrorMessages) {
    score += 15;
  }

  // 高价值关键字加分
  let keywordCount = 0;
  for (const keyword of HIGH_VALUE_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      keywordCount++;
    }
  }
  score += Math.min(keywordCount * 5, 20); // 关键字最多加 20 分

  // 多次出现加分
  if (pattern.occurrences > 1) {
    score += Math.min((pattern.occurrences - 1) * 10, 30); // 最多 30 分
  }

  // 详细方案加分（在限度内越长越好）
  const solutionLength = pattern.solution.length;
  if (solutionLength > 100) {
    score += 10;
  }
  if (solutionLength > 300) {
    score += 10;
  }

  // 通用模式扣分
  for (const generic of GENERIC_PATTERNS) {
    if (combinedText.includes(generic)) {
      score -= 15;
    }
  }

  // 内容过短扣分
  if (pattern.problem.length < 20 || pattern.solution.length < 30) {
    score -= 20;
  }

  // 缺少触发器扣分
  if (pattern.suggestedTriggers.length === 0) {
    score -= 25;
  }

  // 确保评分在合法范围内
  return Math.max(0, Math.min(100, score));
}

/**
 * 记录一个问题-方案对。
 * 若模式为新建或已更新则返回该模式，被忽略则返回 null。
 */
export function recordPattern(
  state: AutoLearnerState,
  problem: string,
  solution: string,
): PatternDetection | null {
  // 基本校验
  if (!problem || !solution) {
    return null;
  }

  const trimmedProblem = problem.trim();
  const trimmedSolution = solution.trim();

  if (trimmedProblem.length < 10 || trimmedSolution.length < 20) {
    return null;
  }

  // 生成用于去重的哈希
  const hash = generateContentHash(trimmedProblem, trimmedSolution);

  // 检查模式是否已存在
  const existingPattern = state.patterns.get(hash);

  if (existingPattern) {
    // 更新已存在模式
    existingPattern.occurrences++;
    existingPattern.lastSeen = Date.now();
    existingPattern.confidence = calculateSkillWorthiness(existingPattern);

    // 重新评估是否建议
    if (
      existingPattern.confidence >= DEFAULT_SUGGESTION_THRESHOLD &&
      !state.suggestedSkills.find((p) => p.id === existingPattern.id)
    ) {
      state.suggestedSkills.push(existingPattern);
    }

    return existingPattern;
  }

  // 创建新模式
  const triggers = extractTriggers(trimmedProblem, trimmedSolution);
  const tags = generateTags(trimmedProblem, trimmedSolution);

  const newPattern: PatternDetection = {
    id: hash,
    problem: trimmedProblem,
    solution: trimmedSolution,
    occurrences: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    suggestedTriggers: triggers,
    suggestedTags: tags,
    confidence: 0, // 将在下方计算
  };

  // 计算初始置信度
  newPattern.confidence = calculateSkillWorthiness(newPattern);

  // 存储模式
  state.patterns.set(hash, newPattern);

  // 若有价值则加入建议
  if (newPattern.confidence >= DEFAULT_SUGGESTION_THRESHOLD) {
    state.suggestedSkills.push(newPattern);
  }

  return newPattern;
}

/**
 * 获取可建议的技能（置信度高于阈值）。
 */
export function getSuggestedSkills(
  state: AutoLearnerState,
  threshold: number = DEFAULT_SUGGESTION_THRESHOLD,
): PatternDetection[] {
  return state.suggestedSkills
    .filter((p) => p.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * 将模式转换为技能元数据（部分）。
 */
export function patternToSkillMetadata(
  pattern: PatternDetection,
): Partial<SkillMetadata> {
  // 从问题生成描述性名称
  const problemWords = pattern.problem.split(/\s+/).slice(0, 6).join(" ");
  const name =
    problemWords.length > 50 ? problemWords.slice(0, 50) + "..." : problemWords;

  return {
    name,
    description: pattern.problem.slice(0, 200),
    triggers: pattern.suggestedTriggers,
    tags: pattern.suggestedTags,
    source: "extracted" as const,
    quality: pattern.confidence,
    usageCount: 0,
  };
}
