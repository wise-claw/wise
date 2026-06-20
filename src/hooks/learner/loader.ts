/**
 * 技能加载器
 *
 * 从磁盘加载并缓存技能。
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { relative, normalize } from 'path';
import { findSkillFiles } from './finder.js';
import { parseSkillFile } from './parser.js';
import { DEBUG_ENABLED } from './constants.js';
import type { LearnedSkill, SkillMetadata } from './types.js';

/**
 * 为内容创建 SHA-256 哈希。
 */
function createContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 加载项目的全部技能。
 * 项目级技能会覆盖同 ID 的用户级技能。
 */
export function loadAllSkills(projectRoot: string | null): LearnedSkill[] {
  const candidates = findSkillFiles(projectRoot);
  const seenIds = new Map<string, LearnedSkill>();

  for (const candidate of candidates) {
    try {
      const rawContent = readFileSync(candidate.path, 'utf-8');
      const { metadata, content, valid, errors } = parseSkillFile(rawContent);

      if (!valid) {
        if (DEBUG_ENABLED) {
          console.warn(`Invalid skill file ${candidate.path}: ${errors.join(', ')}`);
        }
        continue;
      }

      const skillId = metadata.id!;
      const relativePath = normalize(relative(candidate.sourceDir, candidate.path));

      const skill: LearnedSkill = {
        path: candidate.path,
        relativePath,
        scope: candidate.scope,
        metadata: metadata as SkillMetadata,
        content,
        contentHash: createContentHash(content),
        priority: candidate.scope === 'project' ? 1 : 0,
      };

      // 项目级技能覆盖同 ID 的用户级技能
      const existing = seenIds.get(skillId);
      if (!existing || skill.priority > existing.priority) {
        seenIds.set(skillId, skill);
      }
    } catch (e) {
      if (DEBUG_ENABLED) {
        console.warn(`Error loading skill ${candidate.path}:`, e);
      }
    }
  }

  // 返回按优先级排序的技能（项目级优先）
  return Array.from(seenIds.values()).sort((a, b) => b.priority - a.priority);
}

/**
 * 按 ID 加载特定技能。
 */
export function loadSkillById(skillId: string, projectRoot: string | null): LearnedSkill | null {
  const skills = loadAllSkills(projectRoot);
  return skills.find(s => s.metadata.id === skillId) || null;
}

/**
 * 查找与用户消息中关键词匹配的技能。
 */
export function findMatchingSkills(
  message: string,
  projectRoot: string | null,
  limit: number = 5
): LearnedSkill[] {
  const skills = loadAllSkills(projectRoot);
  const messageLower = message.toLowerCase();

  const scored = skills.map(skill => {
    let score = 0;
    let hasMatch = false;

    // 检查触发器匹配
    for (const trigger of skill.metadata.triggers) {
      if (messageLower.includes(trigger.toLowerCase())) {
        score += 10;
        hasMatch = true;
      }
    }

    // 检查标签匹配
    if (skill.metadata.tags) {
      for (const tag of skill.metadata.tags) {
        if (messageLower.includes(tag.toLowerCase())) {
          score += 5;
          hasMatch = true;
        }
      }
    }

    // 仅在存在触发器或标签匹配时才应用质量/用量加成
    if (hasMatch) {
      // 按质量分加成
      if (skill.metadata.quality) {
        score += skill.metadata.quality / 20;
      }

      // 按使用次数加成
      if (skill.metadata.usageCount) {
        score += Math.min(skill.metadata.usageCount, 10);
      }
    }

    return { skill, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.skill);
}
