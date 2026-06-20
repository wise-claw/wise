/**
 * Factcheck 守卫配置
 *
 * 从 WISE 配置系统加载守卫配置，进行 token 展开并基于合理的默认值做深度合并。
 */

import { homedir } from 'os';
import { loadConfig } from '../../config/loader.js';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import type { GuardsConfig, FactcheckPolicy, SentinelPolicy } from './types.js';

// ---------------------------------------------------------------------------
// 默认值
// ---------------------------------------------------------------------------

const DEFAULT_FACTCHECK_POLICY: FactcheckPolicy = {
  enabled: false,
  mode: 'quick',
  strict_project_patterns: [],
  forbidden_path_prefixes: ['${CLAUDE_CONFIG_DIR}/plugins/cache/wise/'],
  forbidden_path_substrings: ['/.wise/', '.wise-config.json'],
  readonly_command_prefixes: [
    'ls ', 'cat ', 'find ', 'grep ', 'head ', 'tail ', 'stat ', 'echo ', 'wc ',
  ],
  warn_on_cwd_mismatch: true,
  enforce_cwd_parity_in_quick: false,
  warn_on_unverified_gates: true,
  warn_on_unverified_gates_when_no_source_files: false,
};

const DEFAULT_SENTINEL_POLICY: SentinelPolicy = {
  enabled: false,
  readiness: {
    min_pass_rate: 0.60,
    max_timeout_rate: 0.10,
    max_warn_plus_fail_rate: 0.40,
    min_reason_coverage_rate: 0.95,
  },
};

export const DEFAULT_GUARDS_CONFIG: GuardsConfig = {
  factcheck: { ...DEFAULT_FACTCHECK_POLICY },
  sentinel: { ...DEFAULT_SENTINEL_POLICY },
};

// ---------------------------------------------------------------------------
// token 展开
// ---------------------------------------------------------------------------

/**
 * 展开字符串中的 ${HOME}、${WORKSPACE} 和 ${CLAUDE_CONFIG_DIR} token。
 */
export function expandTokens(value: string, workspace?: string): string {
  const home = homedir();
  const ws = workspace ?? process.env.WISE_WORKSPACE ?? process.cwd();
  return value
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$\{WORKSPACE\}/g, ws)
    .replace(/\$\{CLAUDE_CONFIG_DIR\}/g, getClaudeConfigDir());
}

/**
 * 递归展开对象或数组中字符串值里的 token。
 */
function expandTokensDeep<T>(obj: T, workspace?: string): T {
  if (typeof obj === 'string') {
    return expandTokens(obj, workspace) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => expandTokensDeep(item, workspace)) as unknown as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandTokensDeep(value, workspace);
    }
    return result as T;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// 深度合并（本地实现，针对 guards 配置做类型安全处理）
// ---------------------------------------------------------------------------

function deepMergeGuards(
  target: GuardsConfig,
  source: Partial<GuardsConfig>,
): GuardsConfig {
  const result = { ...target };

  if (source.factcheck) {
    result.factcheck = { ...result.factcheck, ...source.factcheck };
  }
  if (source.sentinel) {
    result.sentinel = {
      ...result.sentinel,
      ...source.sentinel,
      readiness: {
        ...result.sentinel.readiness,
        ...(source.sentinel.readiness ?? {}),
      },
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 从 WISE 配置系统加载 guards 配置。
 *
 * 从合并后的 WISE 配置中读取 `guards` 键，基于默认值做深度合并，
 * 并展开 ${HOME}/${WORKSPACE}/${CLAUDE_CONFIG_DIR} token。
 */
export function loadGuardsConfig(workspace?: string): GuardsConfig {
  try {
    const fullConfig = loadConfig() as Record<string, unknown>;
    const guardsRaw = (fullConfig.guards ?? {}) as Partial<GuardsConfig>;
    const merged = deepMergeGuards(DEFAULT_GUARDS_CONFIG, guardsRaw);
    return expandTokensDeep(merged, workspace);
  } catch {
    // 若配置加载失败，返回展开后的默认值
    return expandTokensDeep({ ...DEFAULT_GUARDS_CONFIG }, workspace);
  }
}

/**
 * 检查项目名称是否匹配任一 strict 项目模式。
 * 使用简单的 glob 风格匹配（支持 * 通配符）。
 */
export function shouldUseStrictMode(
  projectName: string,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    if (regex.test(projectName)) {
      return true;
    }
  }
  return false;
}
