/**
 * 技能写入器
 *
 * 将技能文件以正确格式写入磁盘。
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ensureSkillsDir, getSkillsDir } from './finder.js';
import { generateSkillFrontmatter } from './parser.js';
import { validateExtractionRequest } from './validator.js';
import { DEBUG_ENABLED } from './constants.js';
import { ensureClaudeCodeUserSkillCompat } from '../../utils/user-skill-compat.js';
import type { SkillMetadata, SkillExtractionRequest, QualityValidation } from './types.js';

/**
 * 生成唯一的技能 ID。
 */
function generateSkillId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `skill-${timestamp}-${random}`;
}

/**
 * 清理字符串以用作文件名。
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * 技能写入操作的结果。
 */
export interface WriteSkillResult {
  success: boolean;
  path?: string;
  error?: string;
  validation: QualityValidation;
}

/**
 * 根据抽取请求写入新技能。
 */
export function writeSkill(
  request: SkillExtractionRequest,
  projectRoot: string | null,
  skillName: string
): WriteSkillResult {
  // 先校验
  const validation = validateExtractionRequest(request);

  if (!validation.valid) {
    return {
      success: false,
      error: `Quality validation failed: ${validation.missingFields.join(', ')}`,
      validation,
    };
  }

  // 确保目录存在
  if (!ensureSkillsDir(request.targetScope, projectRoot || undefined)) {
    return {
      success: false,
      error: `Failed to create skills directory for scope: ${request.targetScope}`,
      validation,
    };
  }

  // 生成元数据
  const metadata: SkillMetadata = {
    id: generateSkillId(),
    name: skillName,
    description: request.problem.slice(0, 200),
    source: 'extracted',
    createdAt: new Date().toISOString(),
    triggers: request.triggers,
    tags: request.tags,
    quality: validation.score,
    usageCount: 0,
  };

  // 生成内容
  const frontmatter = generateSkillFrontmatter(metadata);
  const content = `${frontmatter}

# Problem

${request.problem}

# Solution

${request.solution}
`;

  const safeSkillName = sanitizeFilename(skillName);
  const filename = `${safeSkillName}.md`;
  const skillsDir = getSkillsDir(request.targetScope, projectRoot || undefined);
  const filePath = join(skillsDir, filename);

  // 检查重复
  if (existsSync(filePath)) {
    return {
      success: false,
      error: `Skill file already exists: ${filename}`,
      validation,
    };
  }

  try {
    writeFileSync(filePath, content);
    if (request.targetScope === 'user') {
      ensureClaudeCodeUserSkillCompat(safeSkillName, filePath);
    }
    return {
      success: true,
      path: filePath,
      validation,
    };
  } catch (e) {
    if (DEBUG_ENABLED) {
      console.error('[learner] Error writing skill file:', e);
    }
    return {
      success: false,
      error: `Failed to write skill file: ${e}`,
      validation,
    };
  }
}

/**
 * 检查是否已存在具有相似触发词的技能。
 */
export function checkDuplicateTriggers(
  triggers: string[],
  projectRoot: string | null
): { isDuplicate: boolean; existingSkillId?: string } {
  // 动态引入以避免循环依赖
  const { loadAllSkills } = require('./loader.js');
  const skills = loadAllSkills(projectRoot);

  const normalizedTriggers = new Set(triggers.map(t => t.toLowerCase()));

  for (const skill of skills) {
    const skillTriggers = skill.metadata.triggers.map((t: string) => t.toLowerCase());
    const overlap = skillTriggers.filter((t: string) => normalizedTriggers.has(t));

    if (overlap.length >= triggers.length * 0.5) {
      return {
        isDuplicate: true,
        existingSkillId: skill.metadata.id,
      };
    }
  }

  return { isDuplicate: false };
}
