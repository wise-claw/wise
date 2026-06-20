/**
 * Autopilot 取消逻辑
 *
 * 处理 autopilot 的取消，清理所有相关状态，
 * 包括任何处于活跃状态的 Ralph 或 UltraQA 模式。
 */

import {
  readAutopilotState,
  clearAutopilotState,
  writeAutopilotState,
  getAutopilotStateAge
} from './state.js';
import { clearRalphState, clearLinkedUltraworkState, readRalphState } from '../ralph/index.js';
import { clearUltraQAState, readUltraQAState } from '../ultraqa/index.js';
import type { AutopilotState } from './types.js';

export interface CancelResult {
  success: boolean;
  message: string;
  preservedState?: AutopilotState;
}

/**
 * 取消 autopilot 并清理所有相关状态
 * 进度予以保留以便后续恢复
 */
export function cancelAutopilot(directory: string, sessionId?: string): CancelResult {
  const state = readAutopilotState(directory, sessionId);

  if (!state) {
    return {
      success: false,
      message: 'No active autopilot session found'
    };
  }

  if (!state.active) {
    return {
      success: false,
      message: 'Autopilot is not currently active'
    };
  }

  // 记录已清理的内容
  const cleanedUp: string[] = [];

  // 清理任何活跃的 Ralph 状态
  const ralphState = sessionId
    ? readRalphState(directory, sessionId)
    : readRalphState(directory);
  if (ralphState?.active) {
    if (ralphState.linked_ultrawork) {
      if (sessionId) {
        clearLinkedUltraworkState(directory, sessionId);
      } else {
        clearLinkedUltraworkState(directory);
      }
      cleanedUp.push('ultrawork');
    }
    if (sessionId) {
      clearRalphState(directory, sessionId);
    } else {
      clearRalphState(directory);
    }
    cleanedUp.push('ralph');
  }

  // 清理任何活跃的 UltraQA 状态
  const ultraqaState = sessionId
    ? readUltraQAState(directory, sessionId)
    : readUltraQAState(directory);
  if (ultraqaState?.active) {
    if (sessionId) {
      clearUltraQAState(directory, sessionId);
    } else {
      clearUltraQAState(directory);
    }
    cleanedUp.push('ultraqa');
  }

  // 将 autopilot 标记为非活跃，但保留状态以便恢复
  state.active = false;
  writeAutopilotState(directory, state, sessionId);

  const cleanupMsg = cleanedUp.length > 0
    ? ` Cleaned up: ${cleanedUp.join(', ')}.`
    : '';

  return {
    success: true,
    message: `Autopilot cancelled at phase: ${state.phase}.${cleanupMsg} Progress preserved for resume.`,
    preservedState: state
  };
}

/**
 * 完全清除 autopilot 状态（不保留）
 */
export function clearAutopilot(directory: string, sessionId?: string): CancelResult {
  const state = readAutopilotState(directory, sessionId);

  if (!state) {
    return {
      success: true,
      message: 'No autopilot state to clear'
    };
  }

  // 清理所有相关状态
  const ralphState = sessionId
    ? readRalphState(directory, sessionId)
    : readRalphState(directory);
  if (ralphState) {
    if (ralphState.linked_ultrawork) {
      if (sessionId) {
        clearLinkedUltraworkState(directory, sessionId);
      } else {
        clearLinkedUltraworkState(directory);
      }
    }
    if (sessionId) {
      clearRalphState(directory, sessionId);
    } else {
      clearRalphState(directory);
    }
  }

  const ultraqaState = sessionId
    ? readUltraQAState(directory, sessionId)
    : readUltraQAState(directory);
  if (ultraqaState) {
    if (sessionId) {
      clearUltraQAState(directory, sessionId);
    } else {
      clearUltraQAState(directory);
    }
  }

  // 完全清除 autopilot 状态
  clearAutopilotState(directory, sessionId);

  return {
    success: true,
    message: 'Autopilot state cleared completely'
  };
}

/** 状态被视为可恢复的最大时长（毫秒，1 小时） */
export const STALE_STATE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * 检查 autopilot 是否可恢复。
 *
 * 防止复用过期状态（issue #609）：
 * - 拒绝终态阶段（complete/failed）
 * - 拒绝仍标记为活跃的状态（会话可能仍在运行）
 * - 拒绝超过 STALE_STATE_MAX_AGE_MS 的过期状态
 * - 自动清理过期状态文件以避免未来的误判
 */
export function canResumeAutopilot(directory: string, sessionId?: string): {
  canResume: boolean;
  state?: AutopilotState;
  resumePhase?: string;
} {
  const state = readAutopilotState(directory, sessionId);

  if (!state) {
    return { canResume: false };
  }

  // 终态无法恢复
  if (state.phase === 'complete' || state.phase === 'failed') {
    return { canResume: false, state, resumePhase: state.phase };
  }

  // 无法恢复声称仍在活跃运行的状态——它可能属于另一个仍然存活的会话。
  if (state.active) {
    return { canResume: false, state, resumePhase: state.phase };
  }

  // 拒绝过期状态：如果状态文件已超过一小时未变动，
  // 则它来自之前的会话，不应被恢复。
  const ageMs = getAutopilotStateAge(directory, sessionId);
  if (ageMs !== null && ageMs > STALE_STATE_MAX_AGE_MS) {
    // 自动清理过期状态以避免未来误判
    clearAutopilotState(directory, sessionId);
    return { canResume: false, state, resumePhase: state.phase };
  }

  return {
    canResume: true,
    state,
    resumePhase: state.phase
  };
}

/**
 * 恢复已暂停的 autopilot 会话
 */
export function resumeAutopilot(directory: string, sessionId?: string): {
  success: boolean;
  message: string;
  state?: AutopilotState;
} {
  const { canResume, state } = canResumeAutopilot(directory, sessionId);

  if (!canResume || !state) {
    return {
      success: false,
      message: 'No autopilot session available to resume'
    };
  }

  // 重新激活
  state.active = true;
  state.iteration++;

  if (!writeAutopilotState(directory, state, sessionId)) {
    return {
      success: false,
      message: 'Failed to update autopilot state'
    };
  }

  return {
    success: true,
    message: `Resuming autopilot at phase: ${state.phase}`,
    state
  };
}

/**
 * 格式化取消消息以供展示
 */
export function formatCancelMessage(result: CancelResult): string {
  if (!result.success) {
    return `[AUTOPILOT] ${result.message}`;
  }

  const lines: string[] = [
    '',
    '[AUTOPILOT CANCELLED]',
    '',
    result.message,
    ''
  ];

  if (result.preservedState) {
    const state = result.preservedState;
    lines.push('Progress Summary:');
    lines.push(`- Phase reached: ${state.phase}`);
    lines.push(`- Files created: ${state.execution.files_created.length}`);
    lines.push(`- Files modified: ${state.execution.files_modified.length}`);
    lines.push(`- Agents used: ${state.total_agents_spawned}`);
    lines.push('');
    lines.push('Run /autopilot to resume from where you left off.');
  }

  return lines.join('\n');
}
