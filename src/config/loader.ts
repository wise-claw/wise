/**
 * 配置加载器
 *
 * 负责从多个来源加载与合并配置：
 * - 用户配置：~/.config/claude-wise/config.jsonc
 * - 项目配置：.claude/wise.jsonc
 * - 环境变量
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type {
  PluginConfig,
  ExternalModelsConfig,
  DelegationProvider,
  TeamRoleAssignmentSpec,
} from "../shared/types.js";
import {
  CANONICAL_TEAM_ROLES,
  KNOWN_AGENT_NAMES,
} from "../shared/types.js";
import { getConfigDir } from "../utils/paths.js";
import { parseJsonc } from "../utils/jsonc.js";
import {
  getDefaultTierModels,
  BUILTIN_EXTERNAL_MODEL_DEFAULTS,
  shouldAutoForceInherit,
} from "./models.js";
import { normalizeDelegationRole } from "../features/delegation-routing/types.js";
import { isDeprecatedMcpProvider } from "../features/delegation-routing/index.js";

/**
 * 默认配置。
 *
 * 模型 ID 从环境变量（WISE_MODEL_HIGH、WISE_MODEL_MEDIUM、WISE_MODEL_LOW）
 * 解析，并带有内置兜底值。
 * 用户/项目配置文件可通过 deepMerge 进一步覆盖。
 *
 * 注意：外部模型默认值的环境变量（WISE_CODEX_DEFAULT_MODEL、
 * WISE_GEMINI_DEFAULT_MODEL）在 loadEnvConfig() 中惰性读取，以避免在
 * 模块加载时捕获到过期值。
 */
export function buildDefaultConfig(): PluginConfig {
  const defaultTierModels = getDefaultTierModels();

  return {
    agents: {
      wise: { model: defaultTierModels.HIGH },
      explore: { model: defaultTierModels.LOW },
      analyst: { model: defaultTierModels.HIGH },
      planner: { model: defaultTierModels.HIGH },
      architect: { model: defaultTierModels.HIGH },
      debugger: { model: defaultTierModels.MEDIUM },
      executor: { model: defaultTierModels.MEDIUM },
      verifier: { model: defaultTierModels.MEDIUM },
      securityReviewer: { model: defaultTierModels.MEDIUM },
      codeReviewer: { model: defaultTierModels.HIGH },
      testEngineer: { model: defaultTierModels.MEDIUM },
      designer: { model: defaultTierModels.MEDIUM },
      writer: { model: defaultTierModels.LOW },
      qaTester: { model: defaultTierModels.MEDIUM },
      scientist: { model: defaultTierModels.MEDIUM },
      tracer: { model: defaultTierModels.MEDIUM },
      gitMaster: { model: defaultTierModels.MEDIUM },
      codeSimplifier: { model: defaultTierModels.HIGH },
      critic: { model: defaultTierModels.HIGH },
      documentSpecialist: { model: defaultTierModels.MEDIUM },
    },
    features: {
      parallelExecution: true,
      lspTools: true, // 真正的语言服务器 LSP 集成
      astTools: true, // 基于 ast-grep 的真正 AST 工具
      continuationEnforcement: true,
      autoContextInjection: true,
    },
    mcpServers: {
      exa: { enabled: true },
      context7: { enabled: true },
    },
    companyContext: {
      onError: "warn",
    },
    permissions: {
      allowBash: true,
      allowEdit: true,
      allowWrite: true,
      maxBackgroundTasks: 5,
    },
    magicKeywords: {
      ultrawork: ["ultrawork", "ulw", "uw"],
      search: ["search", "find", "locate"],
      analyze: ["analyze", "investigate", "examine"],
      ultrathink: ["ultrathink", "think", "reason", "ponder"],
    },
    // 智能模型路由配置
    routing: {
      enabled: true,
      defaultTier: "MEDIUM",
      forceInherit: false,
      escalationEnabled: true,
      maxEscalations: 2,
      tierModels: { ...defaultTierModels },
      agentOverrides: {
        architect: {
          tier: "HIGH",
          reason: "Advisory agent requires deep reasoning",
        },
        planner: {
          tier: "HIGH",
          reason: "Strategic planning requires deep reasoning",
        },
        critic: {
          tier: "HIGH",
          reason: "Critical review requires deep reasoning",
        },
        analyst: {
          tier: "HIGH",
          reason: "Pre-planning analysis requires deep reasoning",
        },
        explore: { tier: "LOW", reason: "Exploration is search-focused" },
        writer: { tier: "LOW", reason: "Documentation is straightforward" },
      },
      escalationKeywords: [
        "critical",
        "production",
        "urgent",
        "security",
        "breaking",
        "architecture",
        "refactor",
        "redesign",
        "root cause",
      ],
      simplificationKeywords: [
        "find",
        "list",
        "show",
        "where",
        "search",
        "locate",
        "grep",
      ],
    },
    // 外部模型配置（Codex、Gemini）
    // 仅静态默认值——环境变量覆盖在 loadEnvConfig() 中应用
    externalModels: {
      defaults: {
        codexModel: BUILTIN_EXTERNAL_MODEL_DEFAULTS.codexModel,
        geminiModel: BUILTIN_EXTERNAL_MODEL_DEFAULTS.geminiModel,
      },
      fallbackPolicy: {
        onModelFailure: "provider_chain",
        allowCrossProvider: false,
        crossProviderOrder: ["codex", "gemini"],
      },
    },
    // 委派路由配置（外部模型路由的可选功能）
    delegationRouting: {
      enabled: false,
      defaultProvider: "claude",
      roles: {},
    },
    // /team 角色路由（方案 E——/team 作用域内的按角色 provider 与 model）
    // 默认为空：用户启用前行为零变化。
    team: {
      ops: {},
      roleRouting: {},
    },
    planOutput: {
      directory: ".wise/plans",
      filenameTemplate: "{{name}}.md",
    },
    teleport: {
      symlinkNodeModules: true,
    },
    startupCodebaseMap: {
      enabled: true,
      maxFiles: 200,
      maxDepth: 4,
    },
    taskSizeDetection: {
      enabled: true,
      smallWordLimit: 50,
      largeWordLimit: 200,
      suppressHeavyModesForSmallTasks: true,
    },
    promptPrerequisites: {
      enabled: true,
      sectionNames: {
        memory: ["MÉMOIRE", "MEMOIRE", "MEMORY"],
        skills: ["SKILLS"],
        verifyFirst: ["VERIFY-FIRST", "VERIFY FIRST", "VERIFY_FIRST"],
        context: ["CONTEXT"],
      },
      blockingTools: ["Edit", "MultiEdit", "Write", "Agent", "Task"],
      executionKeywords: ["ralph", "ultrawork", "autopilot"],
    },
  };
}

export const DEFAULT_CONFIG: PluginConfig = buildDefaultConfig();

/**
 * 配置文件位置
 */
export function getConfigPaths(): { user: string; project: string } {
  const userConfigDir = getConfigDir();

  return {
    user: join(userConfigDir, "claude-wise", "config.jsonc"),
    project: join(process.cwd(), ".claude", "wise.jsonc"),
  };
}

/**
 * 加载并解析 JSONC 文件
 */
export function loadJsoncFile(path: string): PluginConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, "utf-8");
    const result = parseJsonc(content);
    return result as PluginConfig;
  } catch (error) {
    console.error(`Error loading config from ${path}:`, error);
    return null;
  }
}

/**
 * 深度合并两个对象
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  const mutableResult = result as Record<string, unknown>;

  for (const key of Object.keys(source) as (keyof T)[]) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;
    const sourceValue = source[key];
    const targetValue = mutableResult[key as string];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      mutableResult[key as string] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else if (sourceValue !== undefined) {
      mutableResult[key as string] = sourceValue as unknown;
    }
  }

  return result as T;
}

/**
 * 从环境变量加载配置
 */
export function loadEnvConfig(): Partial<PluginConfig> {
  const config: Partial<PluginConfig> = {};

  // MCP API 密钥
  if (process.env.EXA_API_KEY) {
    config.mcpServers = {
      ...config.mcpServers,
      exa: { enabled: true, apiKey: process.env.EXA_API_KEY },
    };
  }

  // 来自环境的功能开关
  if (process.env.WISE_PARALLEL_EXECUTION !== undefined) {
    config.features = {
      ...config.features,
      parallelExecution: process.env.WISE_PARALLEL_EXECUTION === "true",
    };
  }

  if (process.env.WISE_LSP_TOOLS !== undefined) {
    config.features = {
      ...config.features,
      lspTools: process.env.WISE_LSP_TOOLS === "true",
    };
  }

  if (process.env.WISE_MAX_BACKGROUND_TASKS) {
    const maxTasks = parseInt(process.env.WISE_MAX_BACKGROUND_TASKS, 10);
    if (!isNaN(maxTasks)) {
      config.permissions = {
        ...config.permissions,
        maxBackgroundTasks: maxTasks,
      };
    }
  }

  // 来自环境的路由配置
  if (process.env.WISE_ROUTING_ENABLED !== undefined) {
    config.routing = {
      ...config.routing,
      enabled: process.env.WISE_ROUTING_ENABLED === "true",
    };
  }

  if (process.env.WISE_ROUTING_FORCE_INHERIT !== undefined) {
    config.routing = {
      ...config.routing,
      forceInherit: process.env.WISE_ROUTING_FORCE_INHERIT === "true",
    };
  }

  if (process.env.WISE_ROUTING_DEFAULT_TIER) {
    const tier = process.env.WISE_ROUTING_DEFAULT_TIER.toUpperCase();
    if (tier === "LOW" || tier === "MEDIUM" || tier === "HIGH") {
      config.routing = {
        ...config.routing,
        defaultTier: tier as "LOW" | "MEDIUM" | "HIGH",
      };
    }
  }

  // 来自环境的模型别名覆盖（issue #1211）
  const aliasKeys = ["HAIKU", "SONNET", "OPUS"] as const;
  const modelAliases: Record<string, string> = {};
  for (const key of aliasKeys) {
    const envVal = process.env[`WISE_MODEL_ALIAS_${key}`];
    if (envVal) {
      const lower = key.toLowerCase();
      modelAliases[lower] = envVal.toLowerCase();
    }
  }
  if (Object.keys(modelAliases).length > 0) {
    config.routing = {
      ...config.routing,
      modelAliases: modelAliases as Record<
        string,
        "haiku" | "sonnet" | "opus" | "inherit"
      >,
    };
  }

  if (process.env.WISE_ESCALATION_ENABLED !== undefined) {
    config.routing = {
      ...config.routing,
      escalationEnabled: process.env.WISE_ESCALATION_ENABLED === "true",
    };
  }

  // 来自环境的外部模型配置
  const externalModelsDefaults: ExternalModelsConfig["defaults"] = {};

  if (process.env.WISE_EXTERNAL_MODELS_DEFAULT_PROVIDER) {
    const provider = process.env.WISE_EXTERNAL_MODELS_DEFAULT_PROVIDER;
    if (provider === "codex" || provider === "gemini") {
      externalModelsDefaults.provider = provider;
    }
  }

  if (process.env.WISE_EXTERNAL_MODELS_DEFAULT_CODEX_MODEL) {
    externalModelsDefaults.codexModel =
      process.env.WISE_EXTERNAL_MODELS_DEFAULT_CODEX_MODEL;
  } else if (process.env.WISE_CODEX_DEFAULT_MODEL) {
    // 旧版兜底
    externalModelsDefaults.codexModel = process.env.WISE_CODEX_DEFAULT_MODEL;
  }

  if (process.env.WISE_EXTERNAL_MODELS_DEFAULT_GEMINI_MODEL) {
    externalModelsDefaults.geminiModel =
      process.env.WISE_EXTERNAL_MODELS_DEFAULT_GEMINI_MODEL;
  } else if (process.env.WISE_GEMINI_DEFAULT_MODEL) {
    // 旧版兜底
    externalModelsDefaults.geminiModel = process.env.WISE_GEMINI_DEFAULT_MODEL;
  }

  if (process.env.WISE_EXTERNAL_MODELS_DEFAULT_GROK_MODEL) {
    externalModelsDefaults.grokModel =
      process.env.WISE_EXTERNAL_MODELS_DEFAULT_GROK_MODEL;
  } else if (process.env.WISE_GROK_DEFAULT_MODEL) {
    // 旧版兜底
    externalModelsDefaults.grokModel = process.env.WISE_GROK_DEFAULT_MODEL;
  }

  const externalModelsFallback: ExternalModelsConfig["fallbackPolicy"] = {
    onModelFailure: "provider_chain",
  };

  if (process.env.WISE_EXTERNAL_MODELS_FALLBACK_POLICY) {
    const policy = process.env.WISE_EXTERNAL_MODELS_FALLBACK_POLICY;
    if (
      policy === "provider_chain" ||
      policy === "cross_provider" ||
      policy === "claude_only"
    ) {
      externalModelsFallback.onModelFailure = policy;
    }
  }

  // 仅在设置了任一环境变量时才添加 externalModels
  if (
    Object.keys(externalModelsDefaults).length > 0 ||
    externalModelsFallback.onModelFailure !== "provider_chain"
  ) {
    config.externalModels = {
      defaults: externalModelsDefaults,
      fallbackPolicy: externalModelsFallback,
    };
  }

  // 来自环境的委派路由配置
  if (process.env.WISE_DELEGATION_ROUTING_ENABLED !== undefined) {
    config.delegationRouting = {
      ...config.delegationRouting,
      enabled: process.env.WISE_DELEGATION_ROUTING_ENABLED === "true",
    };
  }

  if (process.env.WISE_DELEGATION_ROUTING_DEFAULT_PROVIDER) {
    const provider = process.env.WISE_DELEGATION_ROUTING_DEFAULT_PROVIDER;
    if (["claude", "codex", "gemini"].includes(provider)) {
      config.delegationRouting = {
        ...config.delegationRouting,
        defaultProvider: provider as "claude" | "codex" | "gemini",
      };
    }
  }

  // /team 角色路由环境覆盖（WISE_TEAM_ROLE_OVERRIDES——单个 JSON 变量）。
  // 尽力而为：无效 JSON 会记录日志并被忽略（环境路径不抛错）。
  const teamRoleOverrides = parseTeamRoleOverridesFromEnv();
  if (teamRoleOverrides) {
    config.team = {
      ...config.team,
      roleRouting: {
        ...config.team?.roleRouting,
        ...teamRoleOverrides,
      },
    };
  }

  return config;
}

/**
 * 加载并合并所有配置来源
 */
function warnOnDeprecatedDelegationRouting(config: PluginConfig): void {
  const deprecatedProviders = new Set<DelegationProvider>();
  const defaultProvider = config.delegationRouting?.defaultProvider;
  if (isDeprecatedMcpProvider(defaultProvider)) {
    deprecatedProviders.add(defaultProvider);
  }

  const roles = config.delegationRouting?.roles ?? {};
  for (const route of Object.values(roles)) {
    const provider = route?.provider;
    if (isDeprecatedMcpProvider(provider)) {
      deprecatedProviders.add(provider);
    }
  }

  if (deprecatedProviders.size === 0) {
    return;
  }

  console.warn(
    "[WISE] delegationRouting to Codex/Gemini is deprecated and falls back to Claude Task. Use /team for Codex/Gemini CLI workers instead.",
  );
}

/**
 * 校验从合并后配置解析出的 `team.roleRouting`。
 *
 * 遍历原始解析对象（而非 TS 类型），以捕获 deepMerge 的逃逸情况。
 * 抛出描述性错误，指明违规键与允许的值。
 */
const CANONICAL_TEAM_ROLE_SET = new Set<string>(CANONICAL_TEAM_ROLES);
const KNOWN_AGENT_NAME_SET = new Set<string>(KNOWN_AGENT_NAMES);
// /team CLI worker——这里的 codex/gemini/grok/cursor 是 CLI 集成，并非已废弃的 MCP delegationRouting provider。
const TEAM_ROLE_PROVIDERS = new Set(["claude", "codex", "gemini", "grok", "cursor"]);
const TEAM_ROLE_TIERS = new Set(["HIGH", "MEDIUM", "LOW"]);

export function validateTeamConfig(config: PluginConfig): void {
  const team = (config as Record<string, unknown>).team as
    | Record<string, unknown>
    | undefined;
  if (!team || typeof team !== "object") return;

  const ops = team.ops as Record<string, unknown> | undefined;
  if (ops && typeof ops === "object") {
    if (ops.defaultAgentType !== undefined) {
      if (
        typeof ops.defaultAgentType !== "string" ||
        !TEAM_ROLE_PROVIDERS.has(ops.defaultAgentType)
      ) {
        throw new Error(
          `[WISE] team.ops.defaultAgentType: invalid value "${String(ops.defaultAgentType)}". Allowed: ${[...TEAM_ROLE_PROVIDERS].join(", ")}`,
        );
      }
    }
    if (ops.worktreeMode !== undefined) {
      const allowed = new Set(["disabled", "off", "detached", "branch", "named"]);
      if (typeof ops.worktreeMode !== "string" || !allowed.has(ops.worktreeMode)) {
        throw new Error(
          `[WISE] team.ops.worktreeMode: invalid value "${String(ops.worktreeMode)}". Allowed: ${[...allowed].join(", ")}`,
        );
      }
    }
  }

  const roleRouting = team.roleRouting as Record<string, unknown> | undefined;
  if (!roleRouting || typeof roleRouting !== "object") return;

  for (const [rawRoleKey, rawSpec] of Object.entries(roleRouting)) {
    const normalized = normalizeDelegationRole(rawRoleKey);
    if (!CANONICAL_TEAM_ROLE_SET.has(normalized)) {
      throw new Error(
        `[WISE] team.roleRouting: unknown role "${rawRoleKey}". Allowed roles: ${[...CANONICAL_TEAM_ROLE_SET].join(", ")}`,
      );
    }

    if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) {
      throw new Error(
        `[WISE] team.roleRouting.${rawRoleKey}: must be an object, got ${Array.isArray(rawSpec) ? "array" : typeof rawSpec}`,
      );
    }
    const spec = rawSpec as Record<string, unknown>;

    // orchestrator 条目：仅允许 `model`。
    if (normalized === "orchestrator") {
      for (const key of Object.keys(spec)) {
        if (key !== "model") {
          throw new Error(
            `[WISE] team.roleRouting.orchestrator: key "${key}" is not allowed (orchestrator is pinned to claude; only "model" is configurable)`,
          );
        }
      }
      if (spec.model !== undefined && !isValidModelValue(spec.model)) {
        throw new Error(
          `[WISE] team.roleRouting.orchestrator.model: must be a tier name (HIGH|MEDIUM|LOW) or model ID string, got ${typeof spec.model}`,
        );
      }
      continue;
    }

    if (spec.provider !== undefined) {
      if (typeof spec.provider !== "string" || !TEAM_ROLE_PROVIDERS.has(spec.provider)) {
        throw new Error(
          `[WISE] team.roleRouting.${rawRoleKey}.provider: invalid value "${String(spec.provider)}". Allowed: ${[...TEAM_ROLE_PROVIDERS].join(", ")}`,
        );
      }
    }

    if (spec.model !== undefined && !isValidModelValue(spec.model)) {
      throw new Error(
        `[WISE] team.roleRouting.${rawRoleKey}.model: must be a tier name (HIGH|MEDIUM|LOW) or a non-empty model ID string`,
      );
    }

    if (spec.agent !== undefined) {
      if (typeof spec.agent !== "string" || !KNOWN_AGENT_NAME_SET.has(spec.agent)) {
        throw new Error(
          `[WISE] team.roleRouting.${rawRoleKey}.agent: unknown agent "${String(spec.agent)}". Allowed: ${[...KNOWN_AGENT_NAME_SET].join(", ")}`,
        );
      }
    }
  }
}

function isValidModelValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  // 接受层级名称或显式模型 ID（任意非空字符串）。
  // 层级名称在解析时会规范化；显式 ID 原样透传。
  return TEAM_ROLE_TIERS.has(value) || value.length > 0;
}

function parseTeamRoleOverridesFromEnv(): Record<string, TeamRoleAssignmentSpec> | undefined {
  const raw = process.env.WISE_TEAM_ROLE_OVERRIDES;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        "[WISE] WISE_TEAM_ROLE_OVERRIDES: expected a JSON object; ignoring.",
      );
      return undefined;
    }
    return parsed as Record<string, TeamRoleAssignmentSpec>;
  } catch (err) {
    console.warn(
      `[WISE] WISE_TEAM_ROLE_OVERRIDES: invalid JSON, ignoring (${(err as Error).message})`,
    );
    return undefined;
  }
}

export function loadConfig(): PluginConfig {
  const paths = getConfigPaths();

  // 以全新默认值开始，以便基于环境的模型覆盖在调用时解析
  let config = buildDefaultConfig();

  // 合并用户配置
  const userConfig = loadJsoncFile(paths.user);
  if (userConfig) {
    config = deepMerge(config, userConfig);
  }

  // 合并项目配置（优先级高于用户配置）
  const projectConfig = loadJsoncFile(paths.project);
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
  }

  // 合并环境变量（最高优先级）
  const envConfig = loadEnvConfig();
  config = deepMerge(config, envConfig);

  // 为非标准 provider 自动启用 forceInherit（issues #1201、#1025）
  // 仅当用户未通过配置或环境变量显式设置时才自动启用。
  // 触发条件：CC Switch / LiteLLM（非 Claude 模型 ID）、自定义
  // ANTHROPIC_BASE_URL、AWS Bedrock（CLAUDE_CODE_USE_BEDROCK=1），以及
  // Google Vertex AI（CLAUDE_CODE_USE_VERTEX=1）。在这些平台上传入 Claude
  // 专属层级名称（sonnet/opus/haiku）会导致 400 错误。
  if (
    config.routing?.forceInherit !== true &&
    process.env.WISE_ROUTING_FORCE_INHERIT === undefined &&
    shouldAutoForceInherit()
  ) {
    config.routing = {
      ...config.routing,
      forceInherit: true,
    };
  }

  warnOnDeprecatedDelegationRouting(config);

  // 合并后校验 /team 角色路由。形状非法时抛错，
  // 遍历解析对象，使 deepMerge 绕过在此暴露。
  validateTeamConfig(config);

  return config;
}

const WISE_STARTUP_COMPACTABLE_SECTIONS = [
  "agent_catalog",
  "skills",
  "team_compositions",
] as const;
const WISE_STARTUP_GUIDANCE_MAX_CHARS = 8000;
const WISE_CONTEXT_FILES_MAX_CHARS = 12000;

function compactBudgetedText(text: string, maxChars: number): string {
  if (!text || maxChars <= 0) return "";
  const notice = "\n...[truncated to preserve startup context budget]";
  if (text.length <= maxChars) return text;
  if (maxChars <= notice.length) return notice.slice(0, maxChars);
  return `${text.slice(0, maxChars - notice.length).trimEnd()}${notice}`;
}

function looksLikeWiseGuidance(content: string): boolean {
  return (
    content.includes("<guidance_schema_contract>") &&
    /^# wise\b/im.test(content) &&
    WISE_STARTUP_COMPACTABLE_SECTIONS.some(
      (section) =>
        content.includes(`<${section}>`) && content.includes(`</${section}>`),
    )
  );
}

export function compactWiseStartupGuidance(content: string): string {
  if (!looksLikeWiseGuidance(content)) {
    return content;
  }

  let compacted = content;
  let removedAny = false;

  for (const section of WISE_STARTUP_COMPACTABLE_SECTIONS) {
    const pattern = new RegExp(
      `\n*<${section}>[\\s\\S]*?</${section}>\n*`,
      "g",
    );
    const next = compacted.replace(pattern, "\n\n");
    removedAny = removedAny || next !== compacted;
    compacted = next;
  }

  const normalized = compacted
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n---\n\n---\n\n/g, "\n\n---\n\n")
    .trim();

  if (normalized.length <= WISE_STARTUP_GUIDANCE_MAX_CHARS) {
    return removedAny ? normalized : content;
  }

  const notice = "\n\n[WISE startup guidance truncated to preserve an 8000-character budget. Read the source file directly for the full document.]";
  return `${normalized.slice(0, WISE_STARTUP_GUIDANCE_MAX_CHARS - notice.length).trimEnd()}${notice}`;
}

/**
 * 查找并加载 AGENTS.md 或 CLAUDE.md 文件用于上下文注入
 */
export function findContextFiles(startDir?: string): string[] {
  const files: string[] = [];
  const searchDir = startDir ?? process.cwd();

  // 要查找的文件
  const contextFileNames = [
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/CLAUDE.md",
    ".claude/AGENTS.md",
  ];

  // 在当前目录及父级目录中搜索
  let currentDir = searchDir;
  const searchedDirs = new Set<string>();

  while (currentDir && !searchedDirs.has(currentDir)) {
    searchedDirs.add(currentDir);

    for (const fileName of contextFileNames) {
      const filePath = join(currentDir, fileName);
      if (existsSync(filePath) && !files.includes(filePath)) {
        files.push(filePath);
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return files;
}

/**
 * 从 AGENTS.md/CLAUDE.md 文件加载上下文
 */
export function loadContextFromFiles(files: string[]): string {
  const contexts: string[] = [];
  let used = 0;
  const separator = "\n\n---\n\n";

  for (const file of files) {
    try {
      const content = compactWiseStartupGuidance(readFileSync(file, "utf-8"));
      const contextBlock = `## Context from ${file}\n\n${content}`;
      const separatorLength = contexts.length > 0 ? separator.length : 0;
      const remainingBudget = WISE_CONTEXT_FILES_MAX_CHARS - used - separatorLength;

      if (remainingBudget <= 0) break;
      if (contextBlock.length > remainingBudget) {
        contexts.push(compactBudgetedText(contextBlock, remainingBudget));
        break;
      }

      contexts.push(contextBlock);
      used += separatorLength + contextBlock.length;
    } catch (error) {
      console.warn(`Warning: Could not read context file ${file}:`, error);
    }
  }

  return contexts.join(separator);
}

/**
 * 为配置生成 JSON Schema（用于编辑器自动补全）
 */
export function generateConfigSchema(): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Wise Configuration",
    type: "object",
    properties: {
      agents: {
        type: "object",
        description: "Agent model and feature configuration",
        properties: {
          wise: {
            type: "object",
            properties: {
              model: {
                type: "string",
                description: "Model ID for the main orchestrator",
              },
            },
          },
          explore: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          analyst: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          planner: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          architect: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          debugger: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          executor: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          verifier: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          securityReviewer: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          codeReviewer: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          testEngineer: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          designer: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          writer: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          qaTester: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          scientist: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          tracer: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          gitMaster: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          codeSimplifier: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          critic: {
            type: "object",
            properties: { model: { type: "string" } },
          },
          documentSpecialist: {
            type: "object",
            properties: { model: { type: "string" } },
          },
        },
      },
      features: {
        type: "object",
        description: "Feature toggles",
        properties: {
          parallelExecution: { type: "boolean", default: true },
          lspTools: { type: "boolean", default: true },
          astTools: { type: "boolean", default: true },
          continuationEnforcement: { type: "boolean", default: true },
          autoContextInjection: { type: "boolean", default: true },
        },
      },
      mcpServers: {
        type: "object",
        description: "MCP server configurations",
        properties: {
          exa: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              apiKey: { type: "string" },
            },
          },
          context7: {
            type: "object",
            properties: { enabled: { type: "boolean" } },
          },
        },
      },
      companyContext: {
        type: "object",
        description: "Prompt-level company-context MCP contract for workflow skills",
        properties: {
          tool: {
            type: "string",
            description: "Full MCP tool name to call, for example mcp__vendor__get_company_context",
          },
          onError: {
            type: "string",
            enum: ["warn", "silent", "fail"],
            default: "warn",
            description: "How prompt workflows should react when the configured company-context tool call fails",
          },
        },
      },
      permissions: {
        type: "object",
        description: "Permission settings",
        properties: {
          allowBash: { type: "boolean", default: true },
          allowEdit: { type: "boolean", default: true },
          allowWrite: { type: "boolean", default: true },
          maxBackgroundTasks: {
            type: "integer",
            default: 5,
            minimum: 1,
            maximum: 50,
          },
        },
      },
      magicKeywords: {
        type: "object",
        description: "Magic keyword triggers",
        properties: {
          ultrawork: { type: "array", items: { type: "string" } },
          search: { type: "array", items: { type: "string" } },
          analyze: { type: "array", items: { type: "string" } },
          ultrathink: { type: "array", items: { type: "string" } },
        },
      },
      teleport: {
        type: "object",
        description: "Teleport worktree bootstrap settings",
        properties: {
          symlinkNodeModules: {
            type: "boolean",
            default: true,
            description: "Symlink node_modules from the parent repo when teleport-created worktrees have a matching package.json",
          },
        },
      },
      routing: {
        type: "object",
        description: "Intelligent model routing configuration",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            description: "Enable intelligent model routing",
          },
          defaultTier: {
            type: "string",
            enum: ["LOW", "MEDIUM", "HIGH"],
            default: "MEDIUM",
            description: "Default tier when no rules match",
          },
          forceInherit: {
            type: "boolean",
            default: false,
            description:
              "Force all agents to inherit the parent model, bypassing WISE model routing. When true, no model parameter is passed to Task/Agent calls, so agents use the user's Claude Code model setting. Auto-enabled for non-Claude providers (CC Switch, custom ANTHROPIC_BASE_URL), AWS Bedrock, and Google Vertex AI.",
          },
        },
      },
      externalModels: {
        type: "object",
        description: "External model provider configuration (Codex, Gemini, Grok)",
        properties: {
          defaults: {
            type: "object",
            description: "Default model settings for external providers",
            properties: {
              provider: {
                type: "string",
                enum: ["codex", "gemini"],
                description: "Default external provider",
              },
              codexModel: {
                type: "string",
                default: BUILTIN_EXTERNAL_MODEL_DEFAULTS.codexModel,
                description: "Default Codex model",
              },
              geminiModel: {
                type: "string",
                default: BUILTIN_EXTERNAL_MODEL_DEFAULTS.geminiModel,
                description: "Default Gemini model",
              },
              grokModel: {
                type: "string",
                description: "Default Grok Build model",
              },
            },
          },
          rolePreferences: {
            type: "object",
            description: "Provider/model preferences by agent role",
            additionalProperties: {
              type: "object",
              properties: {
                provider: { type: "string", enum: ["codex", "gemini"] },
                model: { type: "string" },
              },
              required: ["provider", "model"],
            },
          },
          taskPreferences: {
            type: "object",
            description: "Provider/model preferences by task type",
            additionalProperties: {
              type: "object",
              properties: {
                provider: { type: "string", enum: ["codex", "gemini"] },
                model: { type: "string" },
              },
              required: ["provider", "model"],
            },
          },
          fallbackPolicy: {
            type: "object",
            description: "Fallback behavior on model failure",
            properties: {
              onModelFailure: {
                type: "string",
                enum: ["provider_chain", "cross_provider", "claude_only"],
                default: "provider_chain",
                description: "Fallback strategy when a model fails",
              },
              allowCrossProvider: {
                type: "boolean",
                default: false,
                description: "Allow fallback to a different provider",
              },
              crossProviderOrder: {
                type: "array",
                items: { type: "string", enum: ["codex", "gemini"] },
                default: ["codex", "gemini"],
                description: "Order of providers for cross-provider fallback",
              },
            },
          },
        },
      },
      delegationRouting: {
        type: "object",
        description:
          "Delegation routing configuration for external model providers (opt-in feature)",
        properties: {
          enabled: {
            type: "boolean",
            default: false,
            description:
              "Enable delegation routing to external providers (Codex, Gemini)",
          },
          defaultProvider: {
            type: "string",
            enum: ["claude", "codex", "gemini"],
            default: "claude",
            description:
              "Default provider for delegation routing when no specific role mapping exists",
          },
          roles: {
            type: "object",
            description: "Provider mappings by agent role",
            additionalProperties: {
              type: "object",
              properties: {
                provider: {
                  type: "string",
                  enum: ["claude", "codex", "gemini"],
                },
                tool: { type: "string", enum: ["Task"] },
                model: { type: "string" },
                agentType: { type: "string" },
                fallback: { type: "array", items: { type: "string" } },
              },
              required: ["provider", "tool"],
            },
          },
        },
      },
      team: {
        type: "object",
        description: "/team runtime configuration",
        properties: {
          ops: {
            type: "object",
            properties: {
              maxAgents: { type: "integer", minimum: 1 },
              defaultAgentType: {
                type: "string",
                enum: ["claude", "codex", "gemini", "grok", "cursor"],
                default: "claude",
              },
              monitorIntervalMs: { type: "integer", minimum: 1 },
              shutdownTimeoutMs: { type: "integer", minimum: 1 },
              costMode: { type: "string", enum: ["normal", "downgrade"] },
            },
          },
          roleRouting: {
            type: "object",
            description: "Provider/model overrides for canonical /team roles",
            additionalProperties: {
              type: "object",
              properties: {
                provider: { type: "string", enum: ["claude", "codex", "gemini", "grok", "cursor"] },
                model: { type: "string" },
                agent: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}
