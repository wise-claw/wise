/**
 * Learner 配置
 *
 * 负责配置的加载与校验。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { DEBUG_ENABLED } from './constants.js';

export interface LearnerConfig {
  /** 功能启用/禁用 */
  enabled: boolean;
  /** 检测配置 */
  detection: {
    /** 启用自动检测 */
    enabled: boolean;
    /** 触发提示的置信度阈值 (0-100) */
    promptThreshold: number;
    /** 提示之间的冷却间隔（消息条数） */
    promptCooldown: number;
  };
  /** 质量门禁配置 */
  quality: {
    /** 接受的最低分数 (0-100) */
    minScore: number;
    /** 问题描述的最小长度 */
    minProblemLength: number;
    /** 解决方案的最小长度 */
    minSolutionLength: number;
  };
  /** 存储配置 */
  storage: {
    /** 每个作用域的最大技能数 */
    maxSkillsPerScope: number;
    /** 自动清理旧技能 */
    autoPrune: boolean;
    /** 自动清理前的天数（启用时生效） */
    pruneDays: number;
  };
}

const DEFAULT_CONFIG: LearnerConfig = {
  enabled: true,
  detection: {
    enabled: true,
    promptThreshold: 60,
    promptCooldown: 5,
  },
  quality: {
    minScore: 50,
    minProblemLength: 10,
    minSolutionLength: 20,
  },
  storage: {
    maxSkillsPerScope: 100,
    autoPrune: false,
    pruneDays: 90,
  },
};

const CONFIG_PATH = join(getClaudeConfigDir(), 'wise', 'learner.json');

/**
 * 从磁盘加载配置。
 */
export function loadConfig(): LearnerConfig {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    const loaded = JSON.parse(content);
    return mergeConfig(DEFAULT_CONFIG, loaded);
  } catch (error) {
    if (DEBUG_ENABLED) {
      console.error('[learner] Error loading config:', error);
    }
    return DEFAULT_CONFIG;
  }
}

/**
 * 将配置保存到磁盘。
 */
export function saveConfig(config: Partial<LearnerConfig>): boolean {
  const merged = mergeConfig(DEFAULT_CONFIG, config);

  try {
    const dir = join(getClaudeConfigDir(), 'wise');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
    return true;
  } catch (error) {
    if (DEBUG_ENABLED) {
      console.error('[learner] Error saving config:', error);
    }
    return false;
  }
}

/**
 * 将部分配置与默认值合并。
 */
function mergeConfig(
  defaults: LearnerConfig,
  partial: Partial<LearnerConfig>
): LearnerConfig {
  return {
    enabled: partial.enabled ?? defaults.enabled,
    detection: {
      ...defaults.detection,
      ...partial.detection,
    },
    quality: {
      ...defaults.quality,
      ...partial.quality,
    },
    storage: {
      ...defaults.storage,
      ...partial.storage,
    },
  };
}

/**
 * 获取指定的配置值。
 */
export function getConfigValue<K extends keyof LearnerConfig>(
  key: K
): LearnerConfig[K] {
  const config = loadConfig();
  return config[key];
}

/**
 * 更新指定的配置值。
 */
export function setConfigValue<K extends keyof LearnerConfig>(
  key: K,
  value: LearnerConfig[K]
): boolean {
  const config = loadConfig();
  config[key] = value;
  return saveConfig(config);
}
