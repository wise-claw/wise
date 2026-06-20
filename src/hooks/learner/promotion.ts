/**
 * Ralph-Progress 提升器
 *
 * 将 ralph-progress 中的学习成果提升为正式技能。
 */

import { readProgress } from '../ralph/index.js';
import { writeSkill } from './writer.js';
import type { SkillExtractionRequest } from './types.js';
import type { WriteSkillResult } from './writer.js';

export interface PromotionCandidate {
  /** 学习成果文本 */
  learning: string;
  /** 来源 Story ID */
  storyId: string;
  /** 时间戳 */
  timestamp: string;
  /** 建议的触发器（从文本中提取） */
  suggestedTriggers: string[];
}

/**
 * 从学习成果文本中提取触发器关键词。
 */
function extractTriggers(text: string): string[] {
  const technicalKeywords = [
    'react', 'typescript', 'javascript', 'python', 'api', 'database',
    'testing', 'debugging', 'performance', 'async', 'state', 'component',
    'error', 'validation', 'authentication', 'cache', 'query', 'mutation',
  ];

  const textLower = text.toLowerCase();
  return technicalKeywords.filter(kw => textLower.includes(kw));
}

/**
 * 从 ralph-progress 学习成果中获取提升候选项。
 */
export function getPromotionCandidates(
  directory: string,
  limit: number = 10
): PromotionCandidate[] {
  const progress = readProgress(directory);
  if (!progress) {
    return [];
  }

  const candidates: PromotionCandidate[] = [];

  // 获取含学习成果的近期条目
  const recentEntries = progress.entries.slice(-limit);

  for (const entry of recentEntries) {
    for (const learning of entry.learnings) {
      // 跳过过短的学习成果
      if (learning.length < 20) continue;

      candidates.push({
        learning,
        storyId: entry.storyId,
        timestamp: entry.timestamp,
        suggestedTriggers: extractTriggers(learning),
      });
    }
  }

  // 按触发器数量排序（越具体越是优质候选项）
  return candidates.sort((a, b) => b.suggestedTriggers.length - a.suggestedTriggers.length);
}

/**
 * 将学习成果提升为正式技能。
 */
export function promoteLearning(
  candidate: PromotionCandidate,
  skillName: string,
  additionalTriggers: string[],
  targetScope: 'user' | 'project',
  projectRoot: string | null
): WriteSkillResult {
  const request: SkillExtractionRequest = {
    problem: `Learning from ${candidate.storyId}: ${candidate.learning.slice(0, 100)}...`,
    solution: candidate.learning,
    triggers: [...new Set([...candidate.suggestedTriggers, ...additionalTriggers])],
    targetScope,
  };

  return writeSkill(request, projectRoot, skillName);
}

/**
 * 列出可被提升的学习成果。
 */
export function listPromotableLearnings(directory: string): string {
  const candidates = getPromotionCandidates(directory);

  if (candidates.length === 0) {
    return 'No promotion candidates found in ralph-progress learnings.';
  }

  const lines = [
    '# Promotion Candidates',
    '',
    'The following learnings from ralph-progress could be promoted to skills:',
    '',
  ];

  candidates.forEach((candidate, index) => {
    lines.push(`## ${index + 1}. From ${candidate.storyId} (${candidate.timestamp})`);
    lines.push('');
    lines.push(candidate.learning);
    lines.push('');
    if (candidate.suggestedTriggers.length > 0) {
      lines.push(`**Suggested triggers:** ${candidate.suggestedTriggers.join(', ')}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}
