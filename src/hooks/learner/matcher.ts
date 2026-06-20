// 智能技能匹配器：支持模糊匹配、模式检测与置信度评分
// 无外部依赖——仅使用内置功能

export interface MatchResult {
  skillId: string;
  confidence: number; // 0-100
  matchedTriggers: string[];
  matchType: 'exact' | 'fuzzy' | 'pattern' | 'semantic';
  context: MatchContext;
}

export interface MatchContext {
  detectedErrors: string[]; // 例如 ["TypeError", "ENOENT"]
  detectedFiles: string[]; // 例如 ["src/foo.ts"]
  detectedPatterns: string[]; // 例如 ["async/await", "promise"]
}

interface SkillInput {
  id: string;
  triggers: string[];
  tags?: string[];
}

interface MatchOptions {
  threshold?: number; // 最小置信度分数（默认：30）
  maxResults?: number; // 返回结果的最大数量（默认：10）
}

/**
 * 使用多种匹配策略将技能与提示词进行匹配
 */
export function matchSkills(
  prompt: string,
  skills: SkillInput[],
  options: MatchOptions = {}
): MatchResult[] {
  const { threshold = 30, maxResults = 10 } = options;
  const trimmedPrompt = prompt.trim();

  // 对空或仅含空白字符的提示词提前返回
  if (!trimmedPrompt) {
    return [];
  }

  const normalizedPrompt = trimmedPrompt.toLowerCase();
  const context = extractContext(prompt);
  const results: MatchResult[] = [];

  for (const skill of skills) {
    const allTriggers = [...skill.triggers, ...(skill.tags || [])];
    const matches: Array<{
      trigger: string;
      score: number;
      type: MatchResult['matchType'];
    }> = [];

    for (const trigger of allTriggers) {
      const normalizedTrigger = trigger.toLowerCase();

      // 1. 精确匹配（置信度最高）
      if (normalizedPrompt.includes(normalizedTrigger)) {
        matches.push({ trigger, score: 100, type: 'exact' });
        continue;
      }

      // 2. 模式匹配（正则/glob 风格模式）
      const patternScore = patternMatch(normalizedPrompt, normalizedTrigger);
      if (patternScore > 0) {
        matches.push({ trigger, score: patternScore, type: 'pattern' });
        continue;
      }

      // 3. 模糊匹配（Levenshtein 距离）
      const fuzzyScore = fuzzyMatch(normalizedPrompt, normalizedTrigger);
      if (fuzzyScore >= 60) {
        matches.push({ trigger, score: fuzzyScore, type: 'fuzzy' });
      }
    }

    if (matches.length > 0) {
      // 基于最佳匹配计算综合置信度
      const bestMatch = matches.reduce((a, b) => (a.score > b.score ? a : b));
      const avgScore =
        matches.reduce((sum, m) => sum + m.score, 0) / matches.length;
      const confidence = Math.round(bestMatch.score * 0.7 + avgScore * 0.3);

      if (confidence >= threshold) {
        results.push({
          skillId: skill.id,
          confidence,
          matchedTriggers: matches.map((m) => m.trigger),
          matchType: bestMatch.type,
          context,
        });
      }
    }
  }

  // 按置信度降序排序并限制结果数量
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

/**
 * 使用 Levenshtein 距离进行模糊字符串匹配
 * 返回 0-100 的置信度分数
 */
export function fuzzyMatch(text: string, pattern: string): number {
  if (!text.trim() || !pattern.trim()) return 0;

  // 先检查模式是否为子串（部分匹配加成）
  const words = text.split(/\s+/).filter(w => w.length > 0);
  for (const word of words) {
    if (word === pattern) return 100;
    if (word.length > 0 && pattern.length > 0 &&
        (word.includes(pattern) || pattern.includes(word))) {
      return 80;
    }
  }

  // 为每个词计算 Levenshtein 距离
  let bestScore = 0;
  for (const word of words) {
    const distance = levenshteinDistance(word, pattern);
    const maxLen = Math.max(word.length, pattern.length);
    const similarity = maxLen > 0 ? ((maxLen - distance) / maxLen) * 100 : 0;
    bestScore = Math.max(bestScore, similarity);
  }

  return Math.round(bestScore);
}

/**
 * 计算两个字符串之间的 Levenshtein 距离
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // 创建距离矩阵
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // 初始化首行与首列
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j], // 删除
            dp[i][j - 1], // 插入
            dp[i - 1][j - 1] // 替换
          );
      }
    }
  }

  return dp[m][n];
}

/**
 * 针对类正则触发器的基于模式的匹配
 * 返回 0-100 的置信度分数
 */
function patternMatch(text: string, pattern: string): number {
  // 检查 glob 风格模式
  if (pattern.includes('*')) {
    const regexPattern = pattern.replace(/\*/g, '.*');
    try {
      const regex = new RegExp(regexPattern, 'i');
      if (regex.test(text)) {
        return 85; // 模式匹配的置信度较高
      }
    } catch {
      // 无效正则，跳过
    }
  }

  // 检查类正则模式（以 / 开头，其后某处有 /，可带可选标志）
  // 支持：/pattern/ 或 /pattern/flags（例如 /error/i）
  const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      const [, regexPattern, flags] = regexMatch;
      const regex = new RegExp(regexPattern, flags || 'i');
      if (regex.test(text)) {
        return 90; // 显式正则匹配的置信度极高
      }
    } catch {
      // 无效正则，跳过
    }
  }

  return 0;
}

/**
 * 从提示词中提取上下文信息
 */
export function extractContext(prompt: string): MatchContext {
  const detectedErrors: string[] = [];
  const detectedFiles: string[] = [];
  const detectedPatterns: string[] = [];

  // 错误检测
  const errorPatterns = [
    /\b(error|exception|failed|failure|crash|bug)\b/gi,
    /\b([A-Z][a-z]+Error)\b/g, // TypeError、ReferenceError 等
    /\b(ENOENT|EACCES|ECONNREFUSED)\b/g, // Node.js 错误码
    /at\s+.*\(.*:\d+:\d+\)/g, // 堆栈跟踪行
  ];

  for (const pattern of errorPatterns) {
    const matches = prompt.match(pattern);
    if (matches) {
      detectedErrors.push(
        ...matches.map((m) => m.trim()).filter((m) => m.length > 0)
      );
    }
  }

  // 文件检测
  const filePatterns = [
    /\b([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-z]{2,4}\b/g, // 相对路径
    /\b\/[a-zA-Z0-9_\/-]+\.[a-z]{2,4}\b/g, // 绝对路径
    /\bsrc\/[a-zA-Z0-9_\/-]+/g, // src/ 路径
  ];

  for (const pattern of filePatterns) {
    const matches = prompt.match(pattern);
    if (matches) {
      detectedFiles.push(
        ...matches.map((m) => m.trim()).filter((m) => m.length > 0)
      );
    }
  }

  // 模式检测
  const codePatterns = [
    { pattern: /\basync\b.*\bawait\b/gi, name: 'async/await' },
    { pattern: /\bpromise\b/gi, name: 'promise' },
    { pattern: /\bcallback\b/gi, name: 'callback' },
    { pattern: /\bregex\b|\bregular expression\b/gi, name: 'regex' },
    { pattern: /\bapi\b/gi, name: 'api' },
    { pattern: /\btest\b.*\b(unit|integration|e2e)\b/gi, name: 'testing' },
    { pattern: /\b(typescript|ts)\b/gi, name: 'typescript' },
    { pattern: /\b(javascript|js)\b/gi, name: 'javascript' },
    { pattern: /\breact\b/gi, name: 'react' },
    { pattern: /\bgit\b/gi, name: 'git' },
  ];

  for (const { pattern, name } of codePatterns) {
    if (pattern.test(prompt)) {
      detectedPatterns.push(name);
    }
  }

  // 去重并归一化
  return {
    detectedErrors: [...new Set(detectedErrors)],
    detectedFiles: [...new Set(detectedFiles)],
    detectedPatterns: [...new Set(detectedPatterns)],
  };
}

/**
 * 基于匹配指标计算置信度分数
 */
export function calculateConfidence(
  matches: number,
  total: number,
  matchType: string
): number {
  if (total === 0) return 0;

  const matchRatio = matches / total;
  const baseScore = matchRatio * 100;

  // 根据匹配类型应用乘数
  const multipliers: Record<string, number> = {
    exact: 1.0,
    pattern: 0.9,
    fuzzy: 0.7,
    semantic: 0.8,
  };

  const multiplier = multipliers[matchType] || 0.5;
  const confidence = Math.round(baseScore * multiplier);

  return Math.min(100, Math.max(0, confidence));
}
