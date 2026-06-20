import fs from 'fs';
import path from 'path';
import os from 'os';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { atomicWriteJson } from '../../lib/atomic-write.js';

export interface InvocationConfig {
  enabled: boolean;
  confidenceThreshold: number;  // 默认：80
  maxAutoInvokes: number;       // 每会话，默认：3
  cooldownMs: number;           // 调用间隔，默认：30000
}

export interface InvocationRecord {
  skillId: string;
  skillName: string;
  timestamp: number;
  confidence: number;
  prompt: string;
  wasSuccessful: boolean | null;  // null = 未知
  feedbackScore: number | null;   // 用户评分（若提供）
}

export interface AutoInvokeState {
  sessionId: string;
  config: InvocationConfig;
  invocations: InvocationRecord[];
  lastInvokeTime: number;
}

const DEFAULT_CONFIG: InvocationConfig = {
  enabled: true,
  confidenceThreshold: 80,
  maxAutoInvokes: 3,
  cooldownMs: 30000,
};

/**
 * 从 ~/.claude/.wise-config.json 加载自动调用配置
 */
export function loadInvocationConfig(): InvocationConfig {
  const configPath = path.join(getClaudeConfigDir(), '.wise-config.json');

  try {
    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    const configFile = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configFile);

    // 与默认值合并
    return {
      enabled: config.autoInvoke?.enabled ?? DEFAULT_CONFIG.enabled,
      confidenceThreshold: config.autoInvoke?.confidenceThreshold ?? DEFAULT_CONFIG.confidenceThreshold,
      maxAutoInvokes: config.autoInvoke?.maxAutoInvokes ?? DEFAULT_CONFIG.maxAutoInvokes,
      cooldownMs: config.autoInvoke?.cooldownMs ?? DEFAULT_CONFIG.cooldownMs,
    };
  } catch (error) {
    console.error('[auto-invoke] Failed to load config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 为某会话初始化自动调用状态
 */
export function initAutoInvoke(sessionId: string): AutoInvokeState {
  return {
    sessionId,
    config: loadInvocationConfig(),
    invocations: [],
    lastInvokeTime: 0,
  };
}

/**
 * 根据置信度和约束决定是否自动调用技能
 */
export function shouldAutoInvoke(
  state: AutoInvokeState,
  skillId: string,
  confidence: number
): boolean {
  const { config, invocations, lastInvokeTime } = state;

  // 检查自动调用是否启用
  if (!config.enabled) {
    return false;
  }

  // 检查置信度阈值
  if (confidence < config.confidenceThreshold) {
    return false;
  }

  // 检查每会话最大调用次数
  if (invocations.length >= config.maxAutoInvokes) {
    return false;
  }

  // 检查冷却
  const now = Date.now();
  if (now - lastInvokeTime < config.cooldownMs) {
    return false;
  }

  // 检查本会话是否已调用过该技能
  const alreadyInvoked = invocations.some(inv => inv.skillId === skillId);
  if (alreadyInvoked) {
    return false;
  }

  return true;
}

/**
 * 记录一次技能调用
 */
export function recordInvocation(
  state: AutoInvokeState,
  record: Omit<InvocationRecord, 'timestamp'>
): void {
  state.invocations.push({
    ...record,
    timestamp: Date.now(),
  });
  state.lastInvokeTime = Date.now();
}

/**
 * 更新技能调用的成功状态
 */
export function updateInvocationSuccess(
  state: AutoInvokeState,
  skillId: string,
  wasSuccessful: boolean
): void {
  // 更新该技能最近一次调用
  const invocation = [...state.invocations]
    .reverse()
    .find(inv => inv.skillId === skillId);

  if (invocation) {
    invocation.wasSuccessful = wasSuccessful;
  }
}

/**
 * 格式化技能以供自动调用（比被动注入更显眼）
 */
export function formatAutoInvoke(skill: {
  name: string;
  content: string;
  confidence: number;
}): string {
  return `
<auto_invoke_skill>
HIGH CONFIDENCE MATCH (${skill.confidence.toFixed(1)}%) - AUTO-INVOKING SKILL

SKILL: ${skill.name}
CONFIDENCE: ${skill.confidence.toFixed(1)}%
STATUS: AUTOMATICALLY INVOKED

${skill.content}

INSTRUCTION: This skill has been automatically invoked due to high confidence match.
Please follow the skill's instructions immediately.
</auto_invoke_skill>
`;
}

/**
 * 获取本会话的调用统计
 */
export function getInvocationStats(state: AutoInvokeState): {
  total: number;
  successful: number;
  failed: number;
  unknown: number;
  averageConfidence: number;
} {
  const { invocations } = state;

  const successful = invocations.filter(inv => inv.wasSuccessful === true).length;
  const failed = invocations.filter(inv => inv.wasSuccessful === false).length;
  const unknown = invocations.filter(inv => inv.wasSuccessful === null).length;

  const averageConfidence = invocations.length > 0
    ? invocations.reduce((sum, inv) => sum + inv.confidence, 0) / invocations.length
    : 0;

  return {
    total: invocations.length,
    successful,
    failed,
    unknown,
    averageConfidence,
  };
}

/**
 * 将调用历史保存到磁盘用于分析
 */
export function saveInvocationHistory(state: AutoInvokeState): void {
  const historyDir = path.join(os.homedir(), '.wise', 'analytics', 'invocations');
  const historyFile = path.join(historyDir, `${state.sessionId}.json`);

  // 使用原子写入防止并发会话导致损坏（Bug #11 修复）
  atomicWriteJson(historyFile, {
    sessionId: state.sessionId,
    config: state.config,
    invocations: state.invocations,
    stats: getInvocationStats(state),
  }).catch(error => {
    console.error('[auto-invoke] Failed to save invocation history:', error);
  });
}

/**
 * 从磁盘加载调用历史
 */
export function loadInvocationHistory(sessionId: string): AutoInvokeState | null {
  const historyFile = path.join(
    os.homedir(),
    '.wise',
    'analytics',
    'invocations',
    `${sessionId}.json`
  );

  try {
    if (!fs.existsSync(historyFile)) {
      return null;
    }

    const data = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    return {
      sessionId: data.sessionId,
      config: data.config,
      invocations: data.invocations,
      lastInvokeTime: data.invocations.length > 0
        ? Math.max(...data.invocations.map((inv: InvocationRecord) => inv.timestamp))
        : 0,
    };
  } catch (error) {
    console.error('[auto-invoke] Failed to load invocation history:', error);
    return null;
  }
}

/**
 * 获取跨所有会话的聚合调用分析
 */
export function getAggregatedStats(): {
  totalSessions: number;
  totalInvocations: number;
  successRate: number;
  topSkills: Array<{ skillId: string; skillName: string; count: number; successRate: number }>;
} {
  const historyDir = path.join(os.homedir(), '.wise', 'analytics', 'invocations');

  try {
    if (!fs.existsSync(historyDir)) {
      return {
        totalSessions: 0,
        totalInvocations: 0,
        successRate: 0,
        topSkills: [],
      };
    }

    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
    const allInvocations: InvocationRecord[] = [];
    const skillStats = new Map<string, { name: string; total: number; successful: number }>();

    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf-8'));
      allInvocations.push(...data.invocations);

      for (const inv of data.invocations as InvocationRecord[]) {
        const existing = skillStats.get(inv.skillId) || { name: inv.skillName, total: 0, successful: 0 };
        existing.total++;
        if (inv.wasSuccessful === true) {
          existing.successful++;
        }
        skillStats.set(inv.skillId, existing);
      }
    }

    const successful = allInvocations.filter(inv => inv.wasSuccessful === true).length;
    const withKnownStatus = allInvocations.filter(inv => inv.wasSuccessful !== null).length;

    const topSkills = Array.from(skillStats.entries())
      .map(([skillId, stats]) => ({
        skillId,
        skillName: stats.name,
        count: stats.total,
        successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalSessions: files.length,
      totalInvocations: allInvocations.length,
      successRate: withKnownStatus > 0 ? (successful / withKnownStatus) * 100 : 0,
      topSkills,
    };
  } catch (error) {
    console.error('[auto-invoke] Failed to get aggregated stats:', error);
    return {
      totalSessions: 0,
      totalInvocations: 0,
      successRate: 0,
      topSkills: [],
    };
  }
}
