import { validateAnthropicBaseUrl } from '../utils/ssrf-guard.js';

export type ModelTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type ClaudeModelFamily = 'HAIKU' | 'SONNET' | 'OPUS' | 'FABLE';

const DIRECT_MODEL_ENV_KEYS = ['CLAUDE_MODEL', 'ANTHROPIC_MODEL'] as const;
const INHERIT_TIER_PRIORITY: readonly ModelTier[] = ['MEDIUM', 'HIGH', 'LOW'];
const CLAUDE_TIER_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable']);

const TIER_ENV_KEYS: Record<ModelTier, readonly string[]> = {
  LOW: [
    'WISE_MODEL_LOW',
    'CLAUDE_CODE_BEDROCK_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ],
  MEDIUM: [
    'WISE_MODEL_MEDIUM',
    'CLAUDE_CODE_BEDROCK_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
  ],
  HIGH: [
    'WISE_MODEL_HIGH',
    'CLAUDE_CODE_BEDROCK_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
  ],
};

/**
 * Claude 家族的规范默认值。
 * 保持不带日期，以便版本升级时每个家族只需改一行。
 */
export const CLAUDE_FAMILY_DEFAULTS: Record<ClaudeModelFamily, string> = {
  HAIKU: 'claude-haiku-4-5',
  SONNET: 'claude-sonnet-4-6',
  OPUS: 'claude-opus-4-8',
  FABLE: 'claude-fable-5',
};

/** 用作内置默认值的规范 层级->模型 映射 */
export const BUILTIN_TIER_MODEL_DEFAULTS: Record<ModelTier, string> = {
  LOW: CLAUDE_FAMILY_DEFAULTS.HAIKU,
  MEDIUM: CLAUDE_FAMILY_DEFAULTS.SONNET,
  HIGH: CLAUDE_FAMILY_DEFAULTS.OPUS,
};

/** 按家族划分的 Claude 高推理变体规范 */
export const CLAUDE_FAMILY_HIGH_VARIANTS: Record<ClaudeModelFamily, string> = {
  HAIKU: `${CLAUDE_FAMILY_DEFAULTS.HAIKU}-high`,
  SONNET: `${CLAUDE_FAMILY_DEFAULTS.SONNET}-high`,
  OPUS: `${CLAUDE_FAMILY_DEFAULTS.OPUS}-high`,
  FABLE: `${CLAUDE_FAMILY_DEFAULTS.FABLE}-high`,
};

/** 外部 provider 模型的内置默认值 */
export const BUILTIN_EXTERNAL_MODEL_DEFAULTS = {
  codexModel: 'gpt-5.3-codex',
  geminiModel: 'gemini-3.1-pro-preview',
} as const;

/**
 * 集中化的模型 ID 常量
 *
 * 所有默认模型 ID 都定义在此处，以便无需修改源码即可通过
 * 环境变量覆盖。
 *
 * 环境变量（最高优先级）：
 *   WISE_MODEL_HIGH    - HIGH 层级的模型 ID（opus 级别）
 *   WISE_MODEL_MEDIUM  - MEDIUM 层级的模型 ID（sonnet 级别）
 *   WISE_MODEL_LOW     - LOW 层级的模型 ID（haiku 级别）
 *
 * 用户配置（~/.config/claude-wise/config.jsonc）也可通过
 * `routing.tierModels` 或按 agent 的 `agents.<name>.model` 覆盖。
 */

/**
 * 解析某层级的默认模型 ID。
 *
 * 解析顺序：
 * 1. WISE 层级环境变量（WISE_MODEL_HIGH / WISE_MODEL_MEDIUM / WISE_MODEL_LOW）
 * 2. Claude Code provider 环境变量（例如 Bedrock 应用配置模型 ID）
 * 3. Anthropic 家族默认环境变量
 * 4. 内置兜底值
 *
 * 用户/项目配置覆盖由配置加载器稍后通过 deepMerge 应用，
 * 因此优先级高于这些默认值。
 */
function readEnvValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function resolveTierModelFromEnv(tier: ModelTier): string | undefined {
  for (const key of TIER_ENV_KEYS[tier]) {
    const value = readEnvValue(key);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getDirectModelEnvValue(): string | undefined {
  for (const key of DIRECT_MODEL_ENV_KEYS) {
    const value = readEnvValue(key);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getProviderDetectionModelEnvValues(): string[] {
  const directModel = getDirectModelEnvValue();
  if (directModel) {
    return [directModel];
  }

  const values = new Set<string>();
  for (const tier of INHERIT_TIER_PRIORITY) {
    const value = resolveTierModelFromEnv(tier);
    if (value) {
      values.add(value);
    }
  }

  return [...values];
}

function getDirectProviderDetectionModelEnvValues(): string[] {
  const directModel = getDirectModelEnvValue();
  return directModel ? [directModel] : [];
}

export function resolveInheritedModelFromEnv(): string | undefined {
  const directModel = getDirectModelEnvValue();
  if (directModel) {
    return directModel;
  }

  for (const tier of INHERIT_TIER_PRIORITY) {
    const value = resolveTierModelFromEnv(tier);
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function hasTierModelEnvOverrides(): boolean {
  return Object.values(TIER_ENV_KEYS).some((keys) =>
    keys.some((key) => {
      return Boolean(readEnvValue(key));
    })
  );
}

export function getDefaultModelHigh(): string {
  return resolveTierModelFromEnv('HIGH') || BUILTIN_TIER_MODEL_DEFAULTS.HIGH;
}

export function getDefaultModelMedium(): string {
  return resolveTierModelFromEnv('MEDIUM') || BUILTIN_TIER_MODEL_DEFAULTS.MEDIUM;
}

export function getDefaultModelLow(): string {
  return resolveTierModelFromEnv('LOW') || BUILTIN_TIER_MODEL_DEFAULTS.LOW;
}

/**
 * 以 record 形式获取所有默认层级模型。
 * 每次调用都会读取当前环境变量，因此变更会立即反映。
 */
export function getDefaultTierModels(): Record<ModelTier, string> {
  return {
    LOW: getDefaultModelLow(),
    MEDIUM: getDefaultModelMedium(),
    HIGH: getDefaultModelHigh(),
  };
}

/**
 * 从任意模型 ID 解析出 Claude 家族。
 * 支持 Anthropic ID 及带 provider 前缀的形式（如 vertex_ai/...）。
 */
export function resolveClaudeFamily(modelId: string): ClaudeModelFamily | null {
  const lower = modelId.toLowerCase();
  if (!lower.includes('claude')) return null;

  if (lower.includes('sonnet')) return 'SONNET';
  if (lower.includes('opus')) return 'OPUS';
  if (lower.includes('haiku')) return 'HAIKU';
  if (lower.includes('fable')) return 'FABLE';

  return null;
}

/**
 * 从 Claude 模型 ID 解析出规范的 Claude 高推理变体。
 * 非 Claude 模型 ID 返回 null。
 */
export function getClaudeHighVariantFromModel(modelId: string): string | null {
  const family = resolveClaudeFamily(modelId);
  return family ? CLAUDE_FAMILY_HIGH_VARIANTS[family] : null;
}

/** 获取外部 provider 的内置默认模型 */
export function getBuiltinExternalDefaultModel(provider: 'codex' | 'gemini'): string {
  return provider === 'codex'
    ? BUILTIN_EXTERNAL_MODEL_DEFAULTS.codexModel
    : BUILTIN_EXTERNAL_MODEL_DEFAULTS.geminiModel;
}


function hasBedrockModelId(modelIds: readonly string[]): boolean {
  for (const modelId of modelIds) {
    if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
      return true;
    }
    if (
      /^arn:aws(-[^:]+)?:bedrock:/i.test(modelId)
      && /:(inference-profile|application-inference-profile)\//i.test(modelId)
      && modelId.toLowerCase().includes('claude')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 检测 Claude Code 是否运行在 AWS Bedrock 上。
 *
 * Claude Code 在配置为 Bedrock 时设置 CLAUDE_CODE_USE_BEDROCK=1。
 * 作为兜底，Bedrock 模型 ID 使用如下前缀格式：
 *   - us.anthropic.claude-sonnet-4-6-v1:0
 *   - global.anthropic.claude-sonnet-4-6-v1:0
 *   - anthropic.claude-3-haiku-20240307-v1:0
 *
 * 在 Bedrock 上，向派生的 agent 传入裸层级名称（sonnet/opus/haiku）会导致
 * 400 错误，因为 provider 期望带区域/推理配置前缀的完整 Bedrock 模型 ID。
 */
export function isBedrock(): boolean {
  // 主信号：Claude Code 自身的环境变量
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return true;
  }

  // 兜底：在当前生效的模型环境变量值中检测 Bedrock 模型 ID 模式。
  // 直连会话模型环境变量优先级高于低优先级的层级默认值，因此过期的
  // 层级/默认环境变量不得将标准 Claude 会话误判为 Bedrock。
  // 覆盖区域前缀（us、eu、ap）、跨区域（global）以及裸格式（anthropic.）。
  return hasBedrockModelId(getProviderDetectionModelEnvValues());
}

/**
 * 检查某模型 ID 是否为 provider 专属标识符，不应被规范化为裸别名
 * （sonnet/opus/haiku）。
 *
 * provider 专属 ID 包括：
 *   - Bedrock 前缀：us.anthropic.claude-*、global.anthropic.claude-*、anthropic.claude-*
 *   - Bedrock ARN：arn:aws:bedrock:...
 *   - Vertex AI：vertex_ai/...
 *
 * 这些 ID 必须原样透传给 CLI，因为将它们规范化为 "sonnet" 之类的别名会使
 * Claude Code 将其展开为 Anthropic API 模型名（如 claude-sonnet-4-6），而
 * 这在 Bedrock/Vertex 上是非法的。
 */
export function isProviderSpecificModelId(modelId: string): boolean {
  // Bedrock 前缀格式（region.anthropic.claude-*、anthropic.claude-*）
  if (/^((us|eu|ap|global)\.anthropic\.|anthropic\.claude)/i.test(modelId)) {
    return true;
  }
  // Bedrock ARN 格式
  if (/^arn:aws(-[^:]+)?:bedrock:/i.test(modelId)) {
    return true;
  }
  // Vertex AI 前缀格式
  if (modelId.toLowerCase().startsWith('vertex_ai/')) {
    return true;
  }
  return false;
}

/**
 * 检测某模型 ID 是否带有 Claude Code 扩展上下文窗口后缀
 * （如 `[1m]`、`[200k]`），该后缀并非合法的 Bedrock API 标识符。
 *
 * `[1m]` 后缀是 Claude Code 针对 1M 上下文窗口变体的内部标注。它对父会话的
 * API 路径有效，但会被子 agent 派生运行时拒绝，运行时会将其剥离为裸的
 * Anthropic 模型 ID（如 `claude-sonnet-4-6`），这在 Bedrock 上是非法的。
 */
export function hasExtendedContextSuffix(modelId: string): boolean {
  return /\[\d+[mk]\]$/i.test(modelId);
}

/**
 * 检查某模型 ID 在非标准 provider（Bedrock、Vertex AI）上派生子 agent 时，
 * 作为 `model` 参数传入是否安全。
 *
 * 当模型 ID 是 provider 专属（完整 Bedrock 或 Vertex AI 格式），且不带有子
 * agent 运行时无法处理的 Claude Code 上下文窗口后缀（如 `[1m]`）时，即为
 * 子 agent 安全。
 */
export function isSubagentSafeModelId(modelId: string): boolean {
  return isProviderSpecificModelId(modelId) && !hasExtendedContextSuffix(modelId);
}

/**
 * 检测 Claude Code 是否运行在 Google Vertex AI 上。
 *
 * Claude Code 在配置为 Vertex AI 时设置 CLAUDE_CODE_USE_VERTEX=1。
 * Vertex 模型 ID 通常使用 "vertex_ai/" 前缀。
 *
 * 在 Vertex 上，传入裸层级名称会报错，因为 provider 期望完整的 Vertex
 * 模型路径。
 */
export function isVertexAI(): boolean {
  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    return true;
  }

  // 兜底：在当前生效的模型环境变量值中检测 vertex_ai/ 前缀。
  return hasVertexModelId(getProviderDetectionModelEnvValues());
}

function hasVertexModelId(modelIds: readonly string[]): boolean {
  return modelIds.some((modelId) => modelId.toLowerCase().startsWith('vertex_ai/'));
}

function hasNonClaudeModelId(modelIds: readonly string[]): boolean {
  for (const modelId of modelIds) {
    const lower = modelId.toLowerCase();
    if (!lower.includes('claude') && !CLAUDE_TIER_ALIASES.has(lower)) {
      return true;
    }
  }

  return false;
}

/**
 * 检测 WISE 是否应避免向 Agent 工具传入 Claude 专属的模型层级名称
 * （sonnet/opus/haiku）。
 *
 * 当满足以下任一条件时返回 true：
 * - 用户显式设置了 WISE_ROUTING_FORCE_INHERIT=true
 * - 运行在 AWS Bedrock 上——需要完整 Bedrock 模型 ID，而非裸层级名称
 * - 运行在 Google Vertex AI 上——需要完整 Vertex 模型路径
 * - 检测到非 Claude 模型 ID（CC Switch、LiteLLM 等）
 * - 自定义 ANTHROPIC_BASE_URL 指向非 Anthropic 端点
 */
export function isNonClaudeProvider(): boolean {
  // 显式启用：用户已通过环境变量设置 forceInherit
  if (process.env.WISE_ROUTING_FORCE_INHERIT === 'true') {
    return true;
  }

  // AWS Bedrock：经 AWS 使用 Claude，但需要完整 Bedrock 模型 ID
  if (isBedrock()) {
    return true;
  }

  // Google Vertex AI：经 GCP 使用 Claude，需要完整 Vertex 模型路径
  if (isVertexAI()) {
    return true;
  }

  // 检查当前生效的模型环境变量值是否为非 Claude 模型 ID。
  // 直连 CLAUDE_MODEL/ANTHROPIC_MODEL 环境变量有意短路低优先级的层级默认值，
  // 以防过期的层级环境变量强制触发继承。
  // 注意：此检查在 Bedrock/Vertex 之后进行，因为它们的模型 ID 含有
  // "claude"，否则会在此错误地返回 false。
  if (hasNonClaudeModelId(getProviderDetectionModelEnvValues())) {
    return true;
  }

  // 自定义 base URL 暗示是代理/网关（CC Switch、LiteLLM、OneAPI 等）
  const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
  if (baseUrl) {
    // 校验 URL 以防范 SSRF
    const validation = validateAnthropicBaseUrl(baseUrl);
    if (!validation.allowed) {
      console.error(`[SSRF Guard] Rejecting ANTHROPIC_BASE_URL: ${validation.reason}`);
      // 将无效 URL 视为非 Claude，以防潜在 SSRF
      return true;
    }
    if (!baseUrl.includes('anthropic.com')) {
      return true;
    }
  }

  return false;
}

/**
 * 检测 provider 状态是否应全局强制 Agent/Task 调用继承父会话模型。
 * 层级模型环境变量覆盖有意不单独触发此项：它们是 WISE 路由按层级配置的默认值，
 * 并不能证明每个委派的 agent 都应放弃自己的模型。
 */
export function shouldAutoForceInherit(): boolean {
  if (process.env.WISE_ROUTING_FORCE_INHERIT === 'true') {
    return true;
  }

  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return true;
  }

  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    return true;
  }

  const directModelValues = getDirectProviderDetectionModelEnvValues();
  if (
    hasBedrockModelId(directModelValues)
    || hasVertexModelId(directModelValues)
    || hasNonClaudeModelId(directModelValues)
  ) {
    return true;
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
  if (baseUrl) {
    const validation = validateAnthropicBaseUrl(baseUrl);
    if (!validation.allowed) {
      console.error(`[SSRF Guard] Rejecting ANTHROPIC_BASE_URL: ${validation.reason}`);
      return true;
    }
    if (!baseUrl.includes('anthropic.com')) {
      return true;
    }
  }

  return false;
}
