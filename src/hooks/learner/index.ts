/**
 * 已学习技能钩子
 *
 * 根据消息内容触发器，自动将相关已学习技能注入上下文。
 */

import { contextCollector } from "../../features/context-injector/index.js";
import { loadAllSkills, findMatchingSkills } from "./loader.js";
import { MAX_SKILLS_PER_SESSION } from "./constants.js";
import { loadConfig } from "./config.js";
import type { LearnedSkill } from "./types.js";

// 重新导出子模块
export * from "./types.js";
export * from "./constants.js";
export * from "./finder.js";
export * from "./parser.js";
export * from "./loader.js";
export * from "./validator.js";
export * from "./writer.js";
export * from "./detector.js";
export * from "./detection-hook.js";
export * from "./promotion.js";
export * from "./config.js";
export * from "./matcher.js";
export * from "./auto-invoke.js";
// 注意：auto-learner 的导出已重命名，以避免与 ralph 的 recordPattern 冲突
export {
  type PatternDetection,
  type AutoLearnerState,
  initAutoLearner,
  calculateSkillWorthiness,
  extractTriggers,
  getSuggestedSkills,
  patternToSkillMetadata,
  recordPattern as recordSkillPattern,
} from "./auto-learner.js";

/**
 * 用于跟踪已注入技能的会话缓存。
 */
const sessionCaches = new Map<string, Set<string>>();
const MAX_SESSIONS = 100;

/**
 * 检查该功能是否启用。
 */
export function isLearnerEnabled(): boolean {
  return loadConfig().enabled;
}

const MAX_LEARNED_SKILL_DESCRIPTOR_CHARS = 1000;
const MAX_LEARNED_SKILLS_CONTEXT_CHARS = 3000;

function compactText(text: string, maxChars: number): string {
  if (!text || maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function summarizeSkillContent(content: string): string {
  const firstUsefulLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.startsWith("---"));
  return compactText(firstUsefulLine || content.replace(/\s+/g, " ").trim(), 240);
}

function formatSkillDescriptor(skill: LearnedSkill): string {
  const summary = skill.metadata.description || summarizeSkillContent(skill.content);
  const lines = [
    `### ${skill.metadata.name}`,
    `**Path:** ${skill.path}`,
    `**Triggers:** ${skill.metadata.triggers.join(", ")}`,
    skill.metadata.tags && skill.metadata.tags.length > 0
      ? `**Tags:** ${skill.metadata.tags.join(", ")}`
      : "",
    `**Summary:** ${summary}`,
    `**Load instructions:** If this skill is needed, read ${skill.path} and follow the full instructions there.`,
  ].filter(Boolean);
  return compactText(lines.join("\n"), MAX_LEARNED_SKILL_DESCRIPTOR_CHARS);
}

/**
 * 将技能格式化为可注入上下文的形式。
 */
function formatSkillsForContext(skills: LearnedSkill[]): string {
  if (skills.length === 0) return "";

  const header = [
    "<learner>",
    "",
    "## Relevant Learned Skills",
    "",
    "Compact descriptors only; full learned skill bodies stay on disk to avoid prompt bloat.",
    "",
  ].join("\n");
  const footer = "\n</learner>";
  const budget = MAX_LEARNED_SKILLS_CONTEXT_CHARS - header.length - footer.length;
  const descriptors: string[] = [];
  let used = 0;

  for (const skill of skills) {
    const descriptor = formatSkillDescriptor(skill);
    const separator = descriptors.length > 0 ? "\n\n---\n\n" : "";
    if (used + separator.length + descriptor.length > budget) {
      const omission = `${separator}[Additional learned skills omitted due to ${MAX_LEARNED_SKILLS_CONTEXT_CHARS}-character context budget; use skill metadata paths if needed.]`;
      const remainingBudget = budget - used;
      if (remainingBudget > 0) {
        descriptors.push(compactText(omission, remainingBudget));
      }
      break;
    }
    descriptors.push(`${separator}${descriptor}`);
    used += separator.length + descriptor.length;
  }

  return `${header}${descriptors.join("")}${footer}`;
}

/**
 * 处理用户消息并注入匹配的技能。
 */
export function processMessageForSkills(
  message: string,
  sessionId: string,
  projectRoot: string | null,
): { injected: number; skills: LearnedSkill[] } {
  if (!isLearnerEnabled()) {
    return { injected: 0, skills: [] };
  }

  // 获取或创建会话缓存
  if (!sessionCaches.has(sessionId)) {
    if (sessionCaches.size >= MAX_SESSIONS) {
      const firstKey = sessionCaches.keys().next().value;
      if (firstKey !== undefined) sessionCaches.delete(firstKey);
    }
    sessionCaches.set(sessionId, new Set());
  }
  const injectedHashes = sessionCaches.get(sessionId)!;

  // 查找尚未注入的匹配技能
  const matchingSkills = findMatchingSkills(
    message,
    projectRoot,
    MAX_SKILLS_PER_SESSION,
  );
  const newSkills = matchingSkills.filter(
    (s) => !injectedHashes.has(s.contentHash),
  );

  if (newSkills.length === 0) {
    return { injected: 0, skills: [] };
  }

  // 标记为已注入
  for (const skill of newSkills) {
    injectedHashes.add(skill.contentHash);
  }

  // 注册到上下文收集器
  const content = formatSkillsForContext(newSkills);
  contextCollector.register(sessionId, {
    id: "learner",
    source: "learner",
    content,
    priority: "normal",
    metadata: {
      skillCount: newSkills.length,
      skillIds: newSkills.map((s) => s.metadata.id),
    },
  });

  return { injected: newSkills.length, skills: newSkills };
}

/**
 * 清理会话缓存。
 */
export function clearSkillSession(sessionId: string): void {
  sessionCaches.delete(sessionId);
}

/**
 * 获取所有已加载的技能（用于调试/展示）。
 */
export function getAllSkills(projectRoot: string | null): LearnedSkill[] {
  return loadAllSkills(projectRoot);
}

/**
 * 为 Claude Code 创建已学习技能钩子。
 */
export function createLearnedSkillsHook(projectRoot: string | null) {
  return {
    /**
     * 处理用户消息以注入技能。
     */
    processMessage: (message: string, sessionId: string) => {
      return processMessageForSkills(message, sessionId, projectRoot);
    },

    /**
     * 完成后清理会话。
     */
    clearSession: (sessionId: string) => {
      clearSkillSession(sessionId);
    },

    /**
     * 获取所有技能用于展示。
     */
    getAllSkills: () => getAllSkills(projectRoot),

    /**
     * 检查功能是否启用。
     */
    isEnabled: isLearnerEnabled,
  };
}
