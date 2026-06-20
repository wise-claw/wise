/**
 * 技能桥接模块
 *
 * 导出聚焦的 API，供 skill-injector.mjs 经 esbuild 打包后使用。
 * 本模块将 TypeScript learner 基础设施与独立钩子脚本桥接起来。
 *
 * 打包至：dist/hooks/skill-bridge.cjs
 * 用法：const bridge = require('../dist/hooks/skill-bridge.cjs');
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { WisePaths } from "../../lib/worktree-paths.js";
import { parseYamlMetadata } from "./parser.js";
import { expandTriggers } from "./transliteration-map.js";

// 重新导出常量
export const USER_SKILLS_DIR = join(
  homedir(),
  ".claude",
  "skills",
  "wise-learned",
);
export const GLOBAL_SKILLS_DIR = join(homedir(), ".wise", "skills");
export const PROJECT_SKILLS_SUBDIR = WisePaths.SKILLS;
export const PROJECT_AGENT_SKILLS_SUBDIR = join(".agents", "skills");
export const SKILL_EXTENSION = ".md";

/** 会话 TTL：1 小时 */
const SESSION_TTL_MS = 60 * 60 * 1000;

/** 目录遍历的最大递归深度 */
const MAX_RECURSION_DEPTH = 10;

/** Levenshtein 缓存大小上限 */
const LEVENSHTEIN_CACHE_SIZE = 1000;

/** 技能元数据缓存 TTL（毫秒，30 秒） */
const SKILL_CACHE_TTL_MS = 30 * 1000;

const MAX_CACHE_ENTRIES = 50;

// =============================================================================
// 性能缓存
// =============================================================================

/** 用于 Levenshtein 距离计算的 LRU 缓存 */
const levenshteinCache = new Map<string, number>();

/**
 * 获取缓存的 Levenshtein 距离，若无则计算并缓存。
 * 使用规范化键顺序以最大化缓存命中。
 */
function getCachedLevenshtein(str1: string, str2: string): number {
  const key = str1 < str2 ? `${str1}|${str2}` : `${str2}|${str1}`;
  const cached = levenshteinCache.get(key);
  if (cached !== undefined) {
    levenshteinCache.delete(key);
    levenshteinCache.set(key, cached);
    return cached;
  }

  const result = levenshteinDistance(str1, str2);

  if (levenshteinCache.size >= LEVENSHTEIN_CACHE_SIZE) {
    const firstKey = levenshteinCache.keys().next().value;
    if (firstKey) levenshteinCache.delete(firstKey);
  }

  levenshteinCache.set(key, result);
  return result;
}

/** 缓存的技能元数据，用于加速匹配 */
interface CachedSkillData {
  path: string;
  name: string;
  triggers: string[];
  triggersLower: string[];
  matching: "exact" | "fuzzy" | undefined;
  content: string;
  description?: string;
  summary?: string;
  scope: "user" | "project";
}

interface CachedSkillEntry {
  skills: CachedSkillData[];
  timestamp: number;
}

/** 按项目根目录键控的技能元数据缓存 */
let skillMetadataCache: Map<string, CachedSkillEntry> | null = null;

/**
 * 获取缓存的技能元数据，若过期则刷新。
 */
function getSkillMetadataCache(projectRoot: string): CachedSkillData[] {
  if (!skillMetadataCache) {
    skillMetadataCache = new Map();
  }

  const cached = skillMetadataCache.get(projectRoot);
  const now = Date.now();

  if (cached && now - cached.timestamp < SKILL_CACHE_TTL_MS) {
    skillMetadataCache.delete(projectRoot);
    skillMetadataCache.set(projectRoot, cached);
    return cached.skills;
  }

  // 刷新缓存
  const candidates = findSkillFiles(projectRoot);
  const skills: CachedSkillData[] = [];

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate.path, "utf-8");
      const parsed = parseSkillFile(content);
      if (!parsed) continue;

      const triggers = (parsed.metadata.triggers ?? [])
        .map((trigger) => trigger.trim())
        .filter(Boolean);
      if (triggers.length === 0) continue;

      const name =
        parsed.metadata.name || basename(candidate.path, SKILL_EXTENSION);

      skills.push({
        path: candidate.path,
        name,
        triggers,
        triggersLower: expandTriggers(triggers.map((t) => t.toLowerCase())),
        matching: parsed.metadata.matching,
        content: parsed.content,
        description: parsed.metadata.description,
        summary: summarizeSkillContent(parsed.content),
        scope: candidate.scope,
      });
    } catch {
      // 忽略文件读取错误
    }
  }

  if (skillMetadataCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = skillMetadataCache.keys().next().value;
    if (firstKey !== undefined) skillMetadataCache.delete(firstKey);
  }

  skillMetadataCache.set(projectRoot, { skills, timestamp: now });
  return skills;
}

/**
 * 清除技能元数据缓存（用于测试）。
 */
export function clearSkillMetadataCache(): void {
  skillMetadataCache = null;
}

/**
 * 清除 Levenshtein 缓存（用于测试）。
 */
export function clearLevenshteinCache(): void {
  levenshteinCache.clear();
}

function summarizeSkillContent(content: string): string {
  const firstUsefulLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.startsWith("---"));
  return (firstUsefulLine || content.replace(/\s+/g, " ").trim()).slice(0, 240);
}

/** 状态文件路径 */
const STATE_FILE = `${WisePaths.STATE}/skill-sessions.json`;

// =============================================================================
// 类型
// =============================================================================

export interface SkillFileCandidate {
  path: string;
  realPath: string;
  scope: "user" | "project";
  /** 发现该技能的根目录 */
  sourceDir: string;
}

export interface ParseResult {
  metadata: {
    id?: string;
    name?: string;
    description?: string;
    triggers?: string[];
    tags?: string[];
    matching?: "exact" | "fuzzy";
    model?: string;
    agent?: string;
  };
  content: string;
  valid: boolean;
  errors: string[];
}

export interface MatchedSkill {
  path: string;
  name: string;
  content: string;
  description?: string;
  summary?: string;
  score: number;
  scope: "user" | "project";
  triggers: string[];
  matching?: "exact" | "fuzzy";
}

interface SessionState {
  sessions: {
    [sessionId: string]: {
      injectedPaths: string[];
      timestamp: number;
    };
  };
}

// =============================================================================
// 会话缓存（基于文件）
// =============================================================================

/**
 * 获取某项目的状态文件路径。
 */
function getStateFilePath(projectRoot: string): string {
  return join(projectRoot, STATE_FILE);
}

/**
 * 从文件读取会话状态。
 */
function readSessionState(projectRoot: string): SessionState {
  const stateFile = getStateFilePath(projectRoot);
  try {
    if (existsSync(stateFile)) {
      const content = readFileSync(stateFile, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // 忽略读取/解析错误
  }
  return { sessions: {} };
}

/**
 * 将会话状态写入文件。
 */
function writeSessionState(projectRoot: string, state: SessionState): void {
  const stateFile = getStateFilePath(projectRoot);
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // 忽略写入错误（非关键）
  }
}

/**
 * 获取本会话已注入的技能路径。
 */
export function getInjectedSkillPaths(
  sessionId: string,
  projectRoot: string,
): string[] {
  const state = readSessionState(projectRoot);
  const session = state.sessions[sessionId];

  if (!session) return [];

  // 检查 TTL
  if (Date.now() - session.timestamp > SESSION_TTL_MS) {
    return [];
  }

  return session.injectedPaths;
}

/**
 * 将技能标记为本会话已注入。
 */
export function markSkillsInjected(
  sessionId: string,
  paths: string[],
  projectRoot: string,
): void {
  const state = readSessionState(projectRoot);
  const now = Date.now();

  // 清理过期会话
  for (const [id, session] of Object.entries(state.sessions)) {
    if (now - session.timestamp > SESSION_TTL_MS) {
      delete state.sessions[id];
    }
  }

  // 获取本会话已有路径
  const existing = state.sessions[sessionId]?.injectedPaths ?? [];

  // 与新路径合并（去重）
  state.sessions[sessionId] = {
    injectedPaths: [...new Set([...existing, ...paths])],
    timestamp: now,
  };

  writeSessionState(projectRoot, state);
}

// =============================================================================
// 文件发现（递归）
// =============================================================================

/**
 * 递归查找某目录下的所有技能文件。
 */
function findSkillFilesRecursive(
  dir: string,
  results: string[],
  depth: number = 0,
): void {
  if (!existsSync(dir)) return;
  if (depth > MAX_RECURSION_DEPTH) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        findSkillFilesRecursive(fullPath, results, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(SKILL_EXTENSION)) {
        results.push(fullPath);
      }
    }
  } catch {
    // 权限拒绝或其他错误 - 静默跳过
  }
}

/**
 * 安全解析符号链接，失败则兜底。
 */
function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * 检查解析后的路径是否位于边界目录内。
 */
function isWithinBoundary(realPath: string, boundary: string): boolean {
  const normalizedReal = safeRealpathSync(realPath)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  const normalizedBoundary = safeRealpathSync(boundary)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  return (
    normalizedReal === normalizedBoundary ||
    normalizedReal.startsWith(normalizedBoundary + "/")
  );
}

/**
 * 查找某项目的所有技能文件。
 * 先返回项目技能（更高优先级），再返回用户技能。
 * 现支持递归发现（含子目录）。
 */
export function findSkillFiles(
  projectRoot: string,
  options?: { scope?: "project" | "user" | "all" },
): SkillFileCandidate[] {
  const candidates: SkillFileCandidate[] = [];
  const seenRealPaths = new Set<string>();
  const scope = options?.scope ?? "all";

  // 1. 搜索项目级技能（更高优先级）
  if (scope === "project" || scope === "all") {
    const projectSkillDirs = [
      join(projectRoot, PROJECT_SKILLS_SUBDIR),
      join(projectRoot, PROJECT_AGENT_SKILLS_SUBDIR),
    ];

    for (const projectSkillsDir of projectSkillDirs) {
      const projectFiles: string[] = [];
      findSkillFilesRecursive(projectSkillsDir, projectFiles);

      for (const filePath of projectFiles) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        if (!isWithinBoundary(realPath, projectSkillsDir)) continue;
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          scope: "project",
          sourceDir: projectSkillsDir,
        });
      }
    }
  }

  // 2. 从两个目录搜索用户级技能（更低优先级）
  if (scope === "user" || scope === "all") {
    const userDirs = [GLOBAL_SKILLS_DIR, USER_SKILLS_DIR];
    for (const userDir of userDirs) {
      const userFiles: string[] = [];
      findSkillFilesRecursive(userDir, userFiles);

      for (const filePath of userFiles) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        if (!isWithinBoundary(realPath, userDir)) continue;
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          scope: "user",
          sourceDir: userDir,
        });
      }
    }
  }

  return candidates;
}

// =============================================================================
// 解析
// =============================================================================

/**
 * 从技能文件解析 YAML frontmatter 与内容。
 */
export function parseSkillFile(content: string): ParseResult | null {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    // 无 frontmatter - 仍有效，用文件名作为名称
    return {
      metadata: {},
      content: content.trim(),
      valid: true,
      errors: [],
    };
  }

  const yamlContent = match[1];
  const body = match[2].trim();
  const errors: string[] = [];

  try {
    const metadata = parseYamlMetadata(yamlContent) as ParseResult["metadata"];
    return {
      metadata,
      content: body,
      valid: true,
      errors,
    };
  } catch (e) {
    return {
      metadata: {},
      content: body,
      valid: false,
      errors: [`YAML parse error: ${e}`],
    };
  }
}

// =============================================================================
// 匹配
// =============================================================================

/**
 * 使用两行、O(n) 空间计算 Levenshtein 距离。
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // 优化：让 n 为较小维度
  if (m < n) {
    return levenshteinDistance(str2, str1);
  }

  // 用两行而非完整矩阵，实现 O(n) 空间
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * 将触发器与 prompt 文本进行模糊匹配。
 * 返回 0-100 的置信度评分。
 */
function fuzzyMatchTrigger(prompt: string, trigger: string): number {
  const words = prompt.split(/\s+/).filter((w) => w.length > 0);

  // 精确单词匹配
  for (const word of words) {
    if (word === trigger) return 100;
    if (word.includes(trigger) || trigger.includes(word)) {
      return 80;
    }
  }

  let bestScore = 0;
  for (const word of words) {
    const distance = getCachedLevenshtein(word, trigger);
    const maxLen = Math.max(word.length, trigger.length);
    const similarity = maxLen > 0 ? ((maxLen - distance) / maxLen) * 100 : 0;
    bestScore = Math.max(bestScore, similarity);
  }

  return Math.round(bestScore);
}

/**
 * 基于 prompt 触发器查找可注入的匹配技能。
 *
 * 选项：
 * - fuzzyThreshold：模糊匹配的最低评分（默认：60）
 * - maxResults：返回技能的最大数量（默认：5）
 */
export function matchSkillsForInjection(
  prompt: string,
  projectRoot: string,
  sessionId: string,
  options: { fuzzyThreshold?: number; maxResults?: number } = {},
): MatchedSkill[] {
  const { fuzzyThreshold = 60, maxResults = 5 } = options;
  const promptLower = prompt.toLowerCase();

  const alreadyInjected = new Set(
    getInjectedSkillPaths(sessionId, projectRoot),
  );

  // 使用缓存的技能元数据，而非每次重新读取文件
  const cachedSkills = getSkillMetadataCache(projectRoot);
  const matches: MatchedSkill[] = [];

  for (const skill of cachedSkills) {
    if (alreadyInjected.has(skill.path)) continue;

    const useFuzzy = skill.matching === "fuzzy";
    let totalScore = 0;

    for (const triggerLower of skill.triggersLower) {
      if (promptLower.includes(triggerLower)) {
        totalScore += 10;
        continue;
      }

      if (useFuzzy) {
        const fuzzyScore = fuzzyMatchTrigger(promptLower, triggerLower);
        if (fuzzyScore >= fuzzyThreshold) {
          totalScore += Math.round(fuzzyScore / 10);
        }
      }
    }

    if (totalScore > 0) {
      matches.push({
        path: skill.path,
        name: skill.name,
        content: skill.content,
        description: skill.description,
        summary: skill.summary,
        score: totalScore,
        scope: skill.scope,
        triggers: skill.triggers,
        matching: skill.matching,
      });
    }
  }

  // 按评分降序排序并限制数量
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, maxResults);
}
