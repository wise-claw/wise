/**
 * 冲突诊断命令
 * 扫描并报告插件共存问题。
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { isWiseHook } from '../../installer/index.js';
import { colors } from '../utils/formatting.js';
import { getSkillsDir, listBuiltinSkillNames } from '../../features/builtin-skills/skills.js';
import { inspectUnifiedMcpRegistrySync } from '../../installer/mcp-registry.js';
import { findWorkspaceRoot, WORKSPACE_MARKER } from '../../lib/worktree-paths.js';

export interface WorkspaceMarkerStatus {
  /** 包含 .wise-workspace 的目录的绝对路径，缺失时为 null。 */
  markerRoot: string | null;
  /** 当 WISE_STATE_DIR 环境变量已设置时为 true。 */
  stateDirEnvSet: boolean;
  /** WISE_STATE_DIR 的值，未设置时为 null。 */
  stateDirEnvValue: string | null;
  /** 当 WISE_STATE_DIR 与 .wise-workspace 同时生效时为 true（警告：WISE_STATE_DIR 优先）。 */
  precedenceConflict: boolean;
}

export interface ConflictReport {
  hookConflicts: { event: string; command: string; isWise: boolean }[];
  claudeMdStatus: { hasMarkers: boolean; hasUserContent: boolean; path: string; companionFile?: string } | null;
  legacySkills: { name: string; path: string }[];
  envFlags: { disableWise: boolean; skipHooks: string[] };
  configIssues: { unknownFields: string[] };
  windowsUnsafePluginHooks: { pluginRoot: string; event: string; command: string }[];
  mcpRegistrySync: ReturnType<typeof inspectUnifiedMcpRegistrySync>;
  workspaceMarker: WorkspaceMarkerStatus;
  hasConflicts: boolean;
}

/**
 * 从单个 settings.json 文件收集钩子条目。
 */
function collectHooksFromSettings(settingsPath: string): ConflictReport['hookConflicts'] {
  const conflicts: ConflictReport['hookConflicts'] = [];

  if (!existsSync(settingsPath)) {
    return conflicts;
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const hooks = settings.hooks || {};

    // 待检查的钩子事件
    const hookEvents = [
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit'
    ];

    for (const event of hookEvents) {
      if (hooks[event] && Array.isArray(hooks[event])) {
        const eventHookGroups = hooks[event] as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
        for (const group of eventHookGroups) {
          if (!group.hooks || !Array.isArray(group.hooks)) continue;
          for (const hook of group.hooks) {
            if (hook.type === 'command' && hook.command) {
              conflicts.push({ event, command: hook.command, isWise: isWiseHook(hook.command) });
            }
          }
        }
      }
    }
  } catch (_error) {
    // 忽略解析错误，将另行报告
  }

  return conflicts;
}

/**
 * 检查 profile 级（~/.claude/settings.json）与
 * project 级（./.claude/settings.json）的钩子冲突。
 *
 * Claude Code 设置优先级：project > profile > defaults。
 * 我们检查两个层级以使诊断完整。
 */
export function checkHookConflicts(): ConflictReport['hookConflicts'] {
  const profileSettingsPath = join(getClaudeConfigDir(), 'settings.json');
  const projectSettingsPath = join(process.cwd(), '.claude', 'settings.json');

  const profileHooks = collectHooksFromSettings(profileSettingsPath);
  const projectHooks = collectHooksFromSettings(projectSettingsPath);

  // 按 event+command 去重（两个层级中相同的钩子应只出现一次）
  const seen = new Set<string>();
  const merged: ConflictReport['hookConflicts'] = [];

  for (const hook of [...projectHooks, ...profileHooks]) {
    const key = `${hook.event}::${hook.command}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(hook);
    }
  }

  return merged;
}

function isWindowsUnsafePluginHookCommand(command: string): boolean {
  return command.includes('find-node.sh')
    || command.includes('/bin/sh')
    || /^sh\s/.test(command);
}

/**
 * 原生 Windows 无法执行仍经由 sh/find-node 路由的插件钩子。
 * 检测陈旧的缓存清单，使 doctor 能引导用户进行 setup/update 修复，
 * 而不是报告通用的钩子冲突。
 */
export function checkWindowsUnsafePluginHooks(): ConflictReport['windowsUnsafePluginHooks'] {
  if (process.platform !== 'win32') {
    return [];
  }

  const roots = [process.env.CLAUDE_PLUGIN_ROOT, ...readInstalledPluginRoots()]
    .filter((root): root is string => typeof root === 'string' && root.length > 0);
  const seenRoots = new Set<string>();
  const unsafe: ConflictReport['windowsUnsafePluginHooks'] = [];

  for (const pluginRoot of roots) {
    if (seenRoots.has(pluginRoot)) continue;
    seenRoots.add(pluginRoot);

    const hooksJsonPath = join(pluginRoot, 'hooks', 'hooks.json');
    if (!existsSync(hooksJsonPath)) continue;

    try {
      const parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf-8')) as {
        hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string }> }>>;
      };

      for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
        for (const group of groups) {
          for (const hook of group.hooks ?? []) {
            if (hook.type !== 'command' || typeof hook.command !== 'string') continue;
            if (isWindowsUnsafePluginHookCommand(hook.command)) {
              unsafe.push({ pluginRoot, event, command: hook.command });
            }
          }
        }
      }
    } catch {
      // 忽略无法读取的清单；doctor 应保持尽力而为。
    }
  }

  return unsafe;
}

/**
 * 检查单个文件是否包含 WISE 标记。
 * 返回 { hasMarkers, hasUserContent }，出错时返回 null。
 */
function checkFileForWiseMarkers(filePath: string): { hasMarkers: boolean; hasUserContent: boolean } | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const hasStartMarker = content.includes('<!-- WISE:START -->');
    const hasEndMarker = content.includes('<!-- WISE:END -->');
    const hasMarkers = hasStartMarker && hasEndMarker;

    let hasUserContent = false;
    if (hasMarkers) {
      const startIdx = content.indexOf('<!-- WISE:START -->');
      const endIdx = content.indexOf('<!-- WISE:END -->');
      const beforeMarker = content.substring(0, startIdx).trim();
      const afterMarker = content.substring(endIdx + '<!-- WISE:END -->'.length).trim();
      hasUserContent = beforeMarker.length > 0 || afterMarker.length > 0;
    } else {
      hasUserContent = content.trim().length > 0;
    }
    return { hasMarkers, hasUserContent };
  } catch {
    return null;
  }
}

/**
 * 在配置目录中查找伴随的 CLAUDE-*.md 文件。
 * 这些是类似 CLAUDE-wise.md 的文件，用户作为文件拆分模式的一部分创建，
 * 以将 WISE 配置与自己的 CLAUDE.md 分开存放。
 */
function findCompanionClaudeMdFiles(configDir: string): string[] {
  try {
    return readdirSync(configDir)
      .filter(f => /^CLAUDE-.+\.md$/i.test(f))
      .map(f => join(configDir, f));
  } catch {
    return [];
  }
}

/**
 * 检查 CLAUDE.md 中的 WISE 标记与用户内容。
 * 同时检查伴随文件（CLAUDE-wise.md 等）以识别文件拆分模式，
 * 即用户将 WISE 配置存放在单独文件中的情形。
 */
export function checkClaudeMdStatus(): ConflictReport['claudeMdStatus'] {
  const configDir = getClaudeConfigDir();
  const claudeMdPath = join(configDir, 'CLAUDE.md');

  if (!existsSync(claudeMdPath)) {
    return null;
  }

  try {
    // 先检查主 CLAUDE.md
    const mainResult = checkFileForWiseMarkers(claudeMdPath);
    if (!mainResult) return null;

    if (mainResult.hasMarkers) {
      return {
        hasMarkers: true,
        hasUserContent: mainResult.hasUserContent,
        path: claudeMdPath
      };
    }

    // 主文件无标记 - 检查伴随文件（文件拆分模式）
    const companions = findCompanionClaudeMdFiles(configDir);
    for (const companionPath of companions) {
      const companionResult = checkFileForWiseMarkers(companionPath);
      if (companionResult?.hasMarkers) {
        return {
          hasMarkers: true,
          hasUserContent: mainResult.hasUserContent,
          path: claudeMdPath,
          companionFile: companionPath
        };
      }
    }

    // 主文件与伴随文件均无标记 - 检查 CLAUDE.md 是否引用了伴随文件
    const content = readFileSync(claudeMdPath, 'utf-8');
    const companionRefPattern = /CLAUDE-[^\s)]+\.md/i;
    const refMatch = content.match(companionRefPattern);
    if (refMatch) {
      // CLAUDE.md 引用了伴随文件，但该文件尚无标记
      return {
        hasMarkers: false,
        hasUserContent: mainResult.hasUserContent,
        path: claudeMdPath,
        companionFile: join(configDir, refMatch[0])
      };
    }

    return {
      hasMarkers: false,
      hasUserContent: mainResult.hasUserContent,
      path: claudeMdPath
    };
  } catch (_error) {
    return null;
  }
}

/**
 * 检查影响 WISE 行为的环境标志
 */
export function checkEnvFlags(): ConflictReport['envFlags'] {
  const disableWise = process.env.DISABLE_WISE === 'true' || process.env.DISABLE_WISE === '1';
  const skipHooks: string[] = [];

  if (process.env.WISE_SKIP_HOOKS) {
    skipHooks.push(...process.env.WISE_SKIP_HOOKS.split(',').map(h => h.trim()));
  }

  return { disableWise, skipHooks };
}

const SETUP_FALLBACK_SKILL_NAMES = new Set(['wise-reference']);

function parseSemverLikeVersion(version: string): number[] | null {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return null;
  }

  return version.split(/[+-]/, 1)[0].split('.').map(part => Number.parseInt(part, 10));
}

function compareSemverLikeVersions(a: string, b: string): number {
  const parsedA = parseSemverLikeVersion(a);
  const parsedB = parseSemverLikeVersion(b);
  if (!parsedA || !parsedB) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    const delta = parsedA[index] - parsedB[index];
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function isValidSetupPluginRoot(pluginRoot: string): boolean {
  return existsSync(join(pluginRoot, 'docs', 'CLAUDE.md'));
}

function readInstalledPluginRoots(): string[] {
  const installedPluginsPath = join(getClaudeConfigDir(), 'plugins', 'installed_plugins.json');
  if (!existsSync(installedPluginsPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(installedPluginsPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }

    const plugins = 'plugins' in parsed
      && parsed.plugins
      && typeof parsed.plugins === 'object'
      && !Array.isArray(parsed.plugins)
      ? parsed.plugins as Record<string, unknown>
      : parsed as Record<string, unknown>;

    return Object.entries(plugins)
      .filter(([key]) => key.startsWith('wise'))
      .flatMap(([, value]) => Array.isArray(value) ? value : [])
      .map(entry => entry && typeof entry === 'object' && 'installPath' in entry
        ? (entry as { installPath?: unknown }).installPath
        : null)
      .filter((installPath): installPath is string => typeof installPath === 'string' && installPath.length > 0);
  } catch {
    return [];
  }
}

function findLatestSiblingPluginRoot(pluginRoot: string): string | null {
  const cacheBase = dirname(pluginRoot);
  if (!existsSync(cacheBase)) {
    return null;
  }

  try {
    return readdirSync(cacheBase)
      .filter(entry => parseSemverLikeVersion(entry))
      .map(entry => join(cacheBase, entry))
      .filter(isValidSetupPluginRoot)
      .sort((a, b) => compareSemverLikeVersions(basename(b), basename(a)))[0] || null;
  } catch {
    return null;
  }
}

function getSetupFallbackCanonicalSkillPaths(baseName: string): string[] {
  const currentSkillsDir = getSkillsDir();
  const currentPluginRoot = dirname(currentSkillsDir);
  const roots = [
    currentPluginRoot,
    process.env.CLAUDE_PLUGIN_ROOT,
    ...readInstalledPluginRoots(),
  ].filter((root): root is string => typeof root === 'string' && root.length > 0);

  for (const root of [...roots]) {
    const latestSibling = findLatestSiblingPluginRoot(root);
    if (latestSibling) {
      roots.push(latestSibling);
    }
  }

  const seen = new Set<string>();
  return [
    join(currentSkillsDir, baseName, 'SKILL.md'),
    ...roots.flatMap(root => [join(root, 'skills', baseName, 'SKILL.md')]),
  ]
    .filter(path => {
      if (seen.has(path)) {
        return false;
      }
      seen.add(path);
      return true;
    });
}

function isSupportedSetupFallbackSkill(legacySkillsDir: string, entry: string, baseName: string): boolean {
  if (!SETUP_FALLBACK_SKILL_NAMES.has(baseName)) {
    return false;
  }

  // scripts/setup-claude-md.sh 有意将打包的原始
  // skills/wise-reference/SKILL.md 文件同步到 ~/.claude/skills/wise-reference/SKILL.md
  // 作为 Claude CLI 兜底。仅抑制这种精确且未修改的同步，以确保真正的
  // 旧版冲突与用户编辑过的 wise-reference 副本仍能浮现。
  if (entry.toLowerCase() !== baseName) {
    return false;
  }

  const installedSkillPath = join(legacySkillsDir, entry, 'SKILL.md');
  if (!existsSync(installedSkillPath)) {
    return false;
  }

  try {
    const installedContent = readFileSync(installedSkillPath, 'utf-8');
    return getSetupFallbackCanonicalSkillPaths(baseName).some(canonicalSkillPath => (
      existsSync(canonicalSkillPath)
      && installedContent === readFileSync(canonicalSkillPath, 'utf-8')
    ));
  } catch {
    return false;
  }
}

/**
 * 检查与插件技能名冲突的旧版 curl 安装技能。
 * 仅标记名称与实际已安装插件技能匹配的技能，避免对用户自定义技能误报。
 */
export function checkLegacySkills(): ConflictReport['legacySkills'] {
  const legacySkillsDir = join(getClaudeConfigDir(), 'skills');
  if (!existsSync(legacySkillsDir)) return [];

  const collisions: ConflictReport['legacySkills'] = [];
  try {
    const pluginSkillNames = new Set(
      listBuiltinSkillNames({ includeAliases: true }).map(n => n.toLowerCase())
    );
    const entries = readdirSync(legacySkillsDir);
    for (const entry of entries) {
      // 匹配名称与插件技能冲突的 .md 文件或目录
      const baseName = entry.replace(/\.md$/i, '').toLowerCase();
      if (pluginSkillNames.has(baseName)) {
        if (isSupportedSetupFallbackSkill(legacySkillsDir, entry, baseName)) {
          continue;
        }
        collisions.push({ name: baseName, path: join(legacySkillsDir, entry) });
      }
    }
  } catch {
    // 忽略读取错误
  }
  return collisions;
}

/**
 * 检查配置文件中的未知字段
 */
export function checkConfigIssues(): ConflictReport['configIssues'] {
  const unknownFields: string[] = [];
  const configPath = join(getClaudeConfigDir(), '.wise-config.json');

  if (!existsSync(configPath)) {
    return { unknownFields };
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    // 当前配置面中的已知顶层字段：
    // - PluginConfig (src/shared/types.ts)
    // - WiseConfig (src/features/auto-update.ts)
    // - 直接读写 .wise-config.json 的位置（notifications、auto-invoke、
    //   delegation enforcement、wise-setup team config）
    // - 保留的旧版兼容键，仍会出现在用户配置中
    const knownFields = new Set([
      // PluginConfig 字段
      'agents',
      'features',
      'mcpServers',
      'permissions',
      'magicKeywords',
      'routing',
      // WiseConfig 字段（来自 auto-update.ts / wise-setup）
      'silentAutoUpdate',
      'configuredAt',
      'configVersion',
      'taskTool',
      'taskToolConfig',
      'defaultExecutionMode',
      'bashHistory',
      'agentTiers',
      'setupCompleted',
      'setupVersion',
      'stopHookCallbacks',
      'notifications',
      'notificationProfiles',
      'hudEnabled',
      'autoUpgradePrompt',
      'nodeBinary',
      // WiseConfig 之外的直接配置读取/写入方
      'customIntegrations',
      'delegationEnforcementLevel',
      'enforcementLevel',
      'autoInvoke',
      'team',
    ]);

    for (const field of Object.keys(config)) {
      if (!knownFields.has(field)) {
        unknownFields.push(field);
      }
    }
  } catch (_error) {
    // 忽略解析错误
  }

  return { unknownFields };
}

/**
 * 检查 .wise-workspace 标记是否存在及 WISE_STATE_DIR 优先级。
 *
 * 报告：
 *  - 是否找到 .wise-workspace 标记（及其位置）。
 *  - 是否设置了 WISE_STATE_DIR。
 *  - 当两者都设置时，发出 precedenceConflict 标志（按解析顺序原则 WISE_STATE_DIR 优先：
 *    WISE_STATE_DIR > .wise-workspace > git > cwd）。
 */
export function checkWorkspaceMarker(): WorkspaceMarkerStatus {
  const markerRoot = findWorkspaceRoot();
  const stateDirEnvValue = process.env.WISE_STATE_DIR && process.env.WISE_STATE_DIR.trim()
    ? process.env.WISE_STATE_DIR.trim()
    : null;
  const stateDirEnvSet = stateDirEnvValue !== null;
  const precedenceConflict = stateDirEnvSet && markerRoot !== null;

  return { markerRoot, stateDirEnvSet, stateDirEnvValue, precedenceConflict };
}

/**
 * 运行完整的冲突检查
 */
export function runConflictCheck(): ConflictReport {
  const hookConflicts = checkHookConflicts();
  const claudeMdStatus = checkClaudeMdStatus();
  const legacySkills = checkLegacySkills();
  const envFlags = checkEnvFlags();
  const configIssues = checkConfigIssues();
  const windowsUnsafePluginHooks = checkWindowsUnsafePluginHooks();
  const mcpRegistrySync = inspectUnifiedMcpRegistrySync();
  const workspaceMarker = checkWorkspaceMarker();

  // 判定是否存在实际冲突
  const hasConflicts =
    hookConflicts.some(h => !h.isWise) || // 存在非 WISE 钩子
    legacySkills.length > 0 || // 旧版技能与插件冲突
    envFlags.disableWise || // WISE 已禁用
    envFlags.skipHooks.length > 0 || // 钩子正被跳过
    configIssues.unknownFields.length > 0 || // 未知配置字段
    windowsUnsafePluginHooks.length > 0 || // Windows 上陈旧的插件钩子仍使用 sh/find-node
    mcpRegistrySync.claudeMissing.length > 0 ||
    mcpRegistrySync.claudeMismatched.length > 0 ||
    mcpRegistrySync.codexMissing.length > 0 ||
    mcpRegistrySync.codexMismatched.length > 0;
    // 注意：缺失 WISE 标记属于提示信息（全新安装时正常），并非冲突
    // 注意：workspaceMarker.precedenceConflict 是 WARN，并非硬冲突

  return {
    hookConflicts,
    claudeMdStatus,
    legacySkills,
    envFlags,
    configIssues,
    windowsUnsafePluginHooks,
    mcpRegistrySync,
    workspaceMarker,
    hasConflicts
  };
}

/**
 * 格式化报告以供展示
 */
export function formatReport(report: ConflictReport, json: boolean): string {
  if (json) {
    return JSON.stringify(report, null, 2);
  }

  // 人类可读格式
  const lines: string[] = [];

  lines.push('');
  lines.push(colors.bold('🔍 Wise Conflict Diagnostic'));
  lines.push(colors.gray('━'.repeat(60)));
  lines.push('');

  // 钩子冲突
  if (report.hookConflicts.length > 0) {
    lines.push(colors.bold('📌 Hook Configuration'));
    lines.push('');
    for (const hook of report.hookConflicts) {
      const status = hook.isWise ? colors.green('✓ WISE') : colors.yellow('⚠ Other');
      lines.push(`  ${hook.event.padEnd(20)} ${status}`);
      lines.push(`    ${colors.gray(hook.command)}`);
    }
    lines.push('');
  } else {
    lines.push(colors.bold('📌 Hook Configuration'));
    lines.push(`  ${colors.gray('No hooks configured')}`);
    lines.push('');
  }

  // CLAUDE.md 状态
  if (report.claudeMdStatus) {
    lines.push(colors.bold('📄 CLAUDE.md Status'));
    lines.push('');

    if (report.claudeMdStatus.hasMarkers) {
      if (report.claudeMdStatus.companionFile) {
        lines.push(`  ${colors.green('✓')} WISE markers found in companion file`);
        lines.push(`    ${colors.gray(`Companion: ${report.claudeMdStatus.companionFile}`)}`);
      } else {
        lines.push(`  ${colors.green('✓')} WISE markers present`);
      }
      if (report.claudeMdStatus.hasUserContent) {
        lines.push(`  ${colors.green('✓')} User content preserved outside markers`);
      }
    } else {
      lines.push(`  ${colors.yellow('⚠')} No WISE markers found`);
      lines.push(`    ${colors.gray('Run /wise:wise-setup to add markers')}`);
      if (report.claudeMdStatus.hasUserContent) {
        lines.push(`  ${colors.blue('ℹ')} User content present - will be preserved`);
      }
    }
    lines.push(`  ${colors.gray(`Path: ${report.claudeMdStatus.path}`)}`);
    lines.push('');
  } else {
    lines.push(colors.bold('📄 CLAUDE.md Status'));
    lines.push(`  ${colors.gray('No CLAUDE.md found')}`);
    lines.push('');
  }

  // 环境标志
  lines.push(colors.bold('🔧 Environment Flags'));
  lines.push('');
  if (report.envFlags.disableWise) {
    lines.push(`  ${colors.red('✗')} DISABLE_WISE is set - WISE is disabled`);
  } else {
    lines.push(`  ${colors.green('✓')} DISABLE_WISE not set`);
  }

  if (report.envFlags.skipHooks.length > 0) {
    lines.push(`  ${colors.yellow('⚠')} WISE_SKIP_HOOKS: ${report.envFlags.skipHooks.join(', ')}`);
  } else {
    lines.push(`  ${colors.green('✓')} No hooks are being skipped`);
  }
  lines.push('');

  // 旧版技能
  if (report.legacySkills.length > 0) {
    lines.push(colors.bold('📦 Legacy Skills'));
    lines.push('');
    lines.push(`  ${colors.yellow('⚠')} Skills colliding with plugin skill names:`);
    for (const skill of report.legacySkills) {
      lines.push(`    - ${skill.name} ${colors.gray(`(${skill.path})`)}`);
    }
    lines.push(`    ${colors.gray('These legacy files shadow plugin skills. Remove them or rename to avoid conflicts.')}`);
    lines.push('');
  }

  // Windows 插件钩子可移植性
  if (report.windowsUnsafePluginHooks.length > 0) {
    lines.push(colors.bold('🪟 Windows Plugin Hooks'));
    lines.push('');
    lines.push(`  ${colors.yellow('⚠')} Plugin hooks still route through sh/find-node on native Windows:`);
    for (const hook of report.windowsUnsafePluginHooks) {
      lines.push(`    - ${hook.event} ${colors.gray(`(${hook.pluginRoot})`)}`);
      lines.push(`      ${colors.gray(hook.command)}`);
    }
    lines.push(`    ${colors.gray('Run /wise:wise-setup or update/reinstall the plugin to rewrite hooks to direct node run.cjs commands.')}`);
    lines.push('');
  }

  // 配置问题
  if (report.configIssues.unknownFields.length > 0) {
    lines.push(colors.bold('⚙️  Configuration Issues'));
    lines.push('');
    lines.push(`  ${colors.yellow('⚠')} Unknown fields in .wise-config.json:`);
    for (const field of report.configIssues.unknownFields) {
      lines.push(`    - ${field}`);
    }
    lines.push('');
  }

  // 统一 MCP 注册表同步
  lines.push(colors.bold('🧩 Unified MCP Registry'));
  lines.push('');
  if (!report.mcpRegistrySync.registryExists) {
    lines.push(`  ${colors.gray('No unified MCP registry found')}`);
    lines.push(`    ${colors.gray(`Expected path: ${report.mcpRegistrySync.registryPath}`)}`);
  } else if (report.mcpRegistrySync.serverNames.length === 0) {
    lines.push(`  ${colors.gray('Registry exists but has no MCP servers')}`);
    lines.push(`    ${colors.gray(`Path: ${report.mcpRegistrySync.registryPath}`)}`);
  } else {
    lines.push(`  ${colors.green('✓')} Registry servers: ${report.mcpRegistrySync.serverNames.join(', ')}`);
    lines.push(`    ${colors.gray(`Registry: ${report.mcpRegistrySync.registryPath}`)}`);
    lines.push(`    ${colors.gray(`Claude MCP: ${report.mcpRegistrySync.claudeConfigPath}`)}`);
    lines.push(`    ${colors.gray(`Codex: ${report.mcpRegistrySync.codexConfigPath}`)}`);

    if (report.mcpRegistrySync.claudeMissing.length > 0) {
      lines.push(`  ${colors.yellow('⚠')} Missing from Claude MCP config: ${report.mcpRegistrySync.claudeMissing.join(', ')}`);
    } else if (report.mcpRegistrySync.claudeMismatched.length > 0) {
      lines.push(`  ${colors.yellow('⚠')} Mismatched in Claude MCP config: ${report.mcpRegistrySync.claudeMismatched.join(', ')}`);
    } else {
      lines.push(`  ${colors.green('✓')} Claude MCP config is in sync`);
    }

    if (report.mcpRegistrySync.codexMissing.length > 0) {
      lines.push(`  ${colors.yellow('⚠')} Missing from Codex config.toml: ${report.mcpRegistrySync.codexMissing.join(', ')}`);
    } else if (report.mcpRegistrySync.codexMismatched.length > 0) {
      lines.push(`  ${colors.yellow('⚠')} Mismatched in Codex config.toml: ${report.mcpRegistrySync.codexMismatched.join(', ')}`);
    } else {
      lines.push(`  ${colors.green('✓')} Codex config.toml is in sync`);
    }
  }
  lines.push('');

  // 工作区标记
  lines.push(colors.bold('🗂  Workspace Marker (.wise-workspace)'));
  lines.push('');
  const wm = report.workspaceMarker;
  if (wm.markerRoot) {
    lines.push(`  ${colors.green('✓')} ${WORKSPACE_MARKER} found`);
    lines.push(`    ${colors.gray(`Marker root: ${wm.markerRoot}`)}`);
  } else {
    lines.push(`  ${colors.gray('ℹ')} No ${WORKSPACE_MARKER} marker found (single-repo mode)`);
  }
  if (wm.stateDirEnvSet) {
    lines.push(`  ${colors.green('✓')} WISE_STATE_DIR is set: ${wm.stateDirEnvValue}`);
  } else {
    lines.push(`  ${colors.gray('ℹ')} WISE_STATE_DIR not set`);
  }
  if (wm.precedenceConflict) {
    lines.push(`  ${colors.yellow('⚠')} Both WISE_STATE_DIR and ${WORKSPACE_MARKER} are active.`);
    lines.push(`    ${colors.gray('WISE_STATE_DIR takes precedence (resolution order: WISE_STATE_DIR > .wise-workspace > git > cwd).')}`);
    lines.push(`    ${colors.gray('If you intended .wise-workspace to anchor state, unset WISE_STATE_DIR.')}`);
  }
  lines.push('');

  // 汇总
  lines.push(colors.gray('━'.repeat(60)));
  if (report.hasConflicts) {
    lines.push(`${colors.yellow('⚠')} Potential conflicts detected`);
    lines.push(`${colors.gray('Review the issues above and run /wise:wise-setup if needed')}`);
  } else {
    lines.push(`${colors.green('✓')} No conflicts detected`);
    lines.push(`${colors.gray('WISE is properly configured')}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Doctor 冲突命令
 */
export async function doctorConflictsCommand(options: { json?: boolean }): Promise<number> {
  const report = runConflictCheck();
  console.log(formatReport(report, options.json ?? false));
  return report.hasConflicts ? 1 : 0;
}
