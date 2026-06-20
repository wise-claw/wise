/**
 * 检测钩子
 *
 * 将技能检测集成到消息流中。
 */

import { detectExtractableMoment, shouldPromptExtraction, generateExtractionPrompt } from './detector.js';
import { isLearnerEnabled } from './index.js';
import type { DetectionResult } from './detector.js';

/**
 * 检测行为的配置。
 */
export interface DetectionConfig {
  /** 触发提示的最小置信度 (0-100) */
  promptThreshold: number;
  /** 提示之间的冷却间隔（消息条数） */
  promptCooldown: number;
  /** 启用/禁用自动检测 */
  enabled: boolean;
}

const DEFAULT_CONFIG: DetectionConfig = {
  promptThreshold: 60,
  promptCooldown: 5,
  enabled: true,
};

/**
 * 检测的会话状态。
 */
interface SessionDetectionState {
  messagesSincePrompt: number;
  lastDetection: DetectionResult | null;
  promptedCount: number;
}

const sessionStates = new Map<string, SessionDetectionState>();

/**
 * 获取或创建会话状态。
 */
function getSessionState(sessionId: string): SessionDetectionState {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      messagesSincePrompt: 0,
      lastDetection: null,
      promptedCount: 0,
    });
  }
  return sessionStates.get(sessionId)!;
}

/**
 * 处理助手回复以进行技能检测。
 * 若应建议提取则返回提示文本，否则返回 null。
 */
export function processResponseForDetection(
  assistantMessage: string,
  userMessage: string | undefined,
  sessionId: string,
  config: Partial<DetectionConfig> = {}
): string | null {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  if (!mergedConfig.enabled || !isLearnerEnabled()) {
    return null;
  }

  const state = getSessionState(sessionId);
  state.messagesSincePrompt++;

  // 检查冷却
  if (state.messagesSincePrompt < mergedConfig.promptCooldown) {
    return null;
  }

  // 检测可提取的时机
  const detection = detectExtractableMoment(assistantMessage, userMessage);
  state.lastDetection = detection;

  // 检查是否应提示
  if (shouldPromptExtraction(detection, mergedConfig.promptThreshold)) {
    state.messagesSincePrompt = 0;
    state.promptedCount++;
    return generateExtractionPrompt(detection);
  }

  return null;
}

/**
 * 获取某个会话的最近一次检测结果。
 */
export function getLastDetection(sessionId: string): DetectionResult | null {
  return sessionStates.get(sessionId)?.lastDetection || null;
}

/**
 * 清除某个会话的检测状态。
 */
export function clearDetectionState(sessionId: string): void {
  sessionStates.delete(sessionId);
}

/**
 * 获取某个会话的检测统计信息。
 */
export function getDetectionStats(sessionId: string): {
  messagesSincePrompt: number;
  promptedCount: number;
  lastDetection: DetectionResult | null;
} {
  const state = sessionStates.get(sessionId);
  if (!state) {
    return {
      messagesSincePrompt: 0,
      promptedCount: 0,
      lastDetection: null,
    };
  }
  return {
    messagesSincePrompt: state.messagesSincePrompt,
    promptedCount: state.promptedCount,
    lastDetection: state.lastDetection,
  };
}
