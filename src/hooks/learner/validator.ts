/**
 * 技能质量校验器
 *
 * 依据质量门校验技能抽取请求。
 */

import { REQUIRED_METADATA_FIELDS, MIN_QUALITY_SCORE, MAX_SKILL_CONTENT_LENGTH } from './constants.js';
import type { SkillExtractionRequest, QualityValidation, SkillMetadata } from './types.js';

/**
 * 校验技能抽取请求。
 */
export function validateExtractionRequest(request: SkillExtractionRequest): QualityValidation {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // 检查必填字段
  if (!request.problem || request.problem.trim().length < 10) {
    missingFields.push('problem (minimum 10 characters)');
    score -= 30;
  }

  if (!request.solution || request.solution.trim().length < 20) {
    missingFields.push('solution (minimum 20 characters)');
    score -= 30;
  }

  if (!request.triggers || request.triggers.length === 0) {
    missingFields.push('triggers (at least one required)');
    score -= 20;
  }

  // 检查内容长度
  const totalLength = (request.problem?.length || 0) + (request.solution?.length || 0);
  if (totalLength > MAX_SKILL_CONTENT_LENGTH) {
    warnings.push(`Content exceeds ${MAX_SKILL_CONTENT_LENGTH} chars (${totalLength}). Consider condensing.`);
    score -= 10;
  }

  // 检查触发词质量
  if (request.triggers) {
    const shortTriggers = request.triggers.filter(t => t.length < 3);
    if (shortTriggers.length > 0) {
      warnings.push(`Short triggers may cause false matches: ${shortTriggers.join(', ')}`);
      score -= 5;
    }

    const genericTriggers = ['the', 'a', 'an', 'this', 'that', 'it', 'is', 'are'];
    const foundGeneric = request.triggers.filter(t => genericTriggers.includes(t.toLowerCase()));
    if (foundGeneric.length > 0) {
      warnings.push(`Generic triggers should be avoided: ${foundGeneric.join(', ')}`);
      score -= 10;
    }
  }

  // 确保分数不为负
  score = Math.max(0, score);

  return {
    valid: missingFields.length === 0 && score >= MIN_QUALITY_SCORE,
    missingFields,
    warnings,
    score,
  };
}

/**
 * 校验已有技能元数据。
 */
export function validateSkillMetadata(metadata: Partial<SkillMetadata>): QualityValidation {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  for (const field of REQUIRED_METADATA_FIELDS) {
    if (!metadata[field as keyof SkillMetadata]) {
      missingFields.push(field);
      score -= 15;
    }
  }

  // 检查 triggers 数组
  if (metadata.triggers && metadata.triggers.length === 0) {
    missingFields.push('triggers (empty array)');
    score -= 20;
  }

  // 检查 source 值
  if (metadata.source && !['extracted', 'promoted', 'manual'].includes(metadata.source)) {
    warnings.push(`Invalid source value: ${metadata.source}`);
    score -= 10;
  }

  score = Math.max(0, score);

  return {
    valid: missingFields.length === 0 && score >= MIN_QUALITY_SCORE,
    missingFields,
    warnings,
    score,
  };
}
