/**
 * 内置技能定义
 *
 * 从 skills 目录下打包的 SKILL.md 文件加载技能。
 * 这为技能定义提供了唯一的真相来源。
 *
 * 技能从 project_root/skills/SKILLNAME/SKILL.md 加载
 *
 * 改编自 oh-my-opencode 的 builtin-skills 特性。
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute, win32 } from 'path';
import { fileURLToPath } from 'url';
import type { BuiltinSkill } from './types.js';
import { parseFrontmatter, parseFrontmatterAliases } from '../../utils/frontmatter.js';
import { rewriteWiseCliInvocations } from '../../utils/wise-cli-rendering.js';
import { parseSkillPipelineMetadata, renderSkillPipelineGuidance } from '../../utils/skill-pipeline.js';
import { renderSkillResourcesGuidance } from '../../utils/skill-resources.js';
import { renderSkillRuntimeGuidance } from './runtime-guidance.js';
import { isSkininthegamebrosUser } from '../../utils/skininthegamebros-user.js';
import { getClaudeConfigDir } from '../../utils/config-dir.js';

function getPackageDir(): string {
  if (typeof __dirname !== 'undefined' && __dirname) {
    const currentDirName = basename(__dirname);
    const parentDirName = basename(dirname(__dirname));
    const grandparentDirName = basename(dirname(dirname(__dirname)));

    if (currentDirName === 'bridge') {
      return join(__dirname, '..');
    }

    if (
      currentDirName === 'builtin-skills'
      && parentDirName === 'features'
      && (grandparentDirName === 'src' || grandparentDirName === 'dist')
    ) {
      return join(__dirname, '..', '..', '..');
    }
  }

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return join(__dirname, '..', '..', '..');
  } catch {
    return process.cwd();
  }
}

const SKILLS_DIR = join(getPackageDir(), 'skills');

/**
 * 不可被 WISE 技能短名遮蔽的 Claude Code 原生命令。
 * 具有这些名称的技能仍会加载，但其名称会加上 'wise-' 前缀，
 * 以避免覆盖内置的 /review、/plan、/security-review 等。
 */
const CC_NATIVE_COMMANDS = new Set([
  'review',
  'plan',
  'security-review',
  'init',
  'doctor',
  'help',
  'config',
  'clear',
  'compact',
  'memory',
]);

const SKININTHEGAMEBROS_ONLY_SKILLS = new Set([
  'remember',
  'verify',
  'debug',
]);

const DEFAULT_DEEP_INTERVIEW_AMBIGUITY_THRESHOLD = 0.2;

function toSafeSkillName(name: string): string {
  const normalized = name.trim();
  return CC_NATIVE_COMMANDS.has(normalized.toLowerCase())
    ? `wise-${normalized}`
    : normalized;
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readDeepInterviewThresholdFromSettings(path: string): number | null {
  const settings = readJsonObject(path);
  const wise = settings?.wise;
  if (!wise || typeof wise !== 'object' || Array.isArray(wise)) {
    return null;
  }

  const deepInterview = (wise as Record<string, unknown>).deepInterview;
  if (!deepInterview || typeof deepInterview !== 'object' || Array.isArray(deepInterview)) {
    return null;
  }

  const threshold = (deepInterview as Record<string, unknown>).ambiguityThreshold;
  return typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
    ? threshold
    : null;
}

type DeepInterviewThresholdResolution = {
  threshold: number;
  source: string;
};

function getDeepInterviewAmbiguityThresholdResolution(): DeepInterviewThresholdResolution {
  const profileSettingsPath = join(getClaudeConfigDir(), 'settings.json');
  const projectSettingsPath = join(process.cwd(), '.claude', 'settings.json');
  const profileThreshold = readDeepInterviewThresholdFromSettings(profileSettingsPath);
  const projectThreshold = readDeepInterviewThresholdFromSettings(projectSettingsPath);

  if (projectThreshold !== null) {
    return { threshold: projectThreshold, source: './.claude/settings.json' };
  }

  if (profileThreshold !== null) {
    return { threshold: profileThreshold, source: '[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json' };
  }

  return { threshold: DEFAULT_DEEP_INTERVIEW_AMBIGUITY_THRESHOLD, source: 'default' };
}

function formatThresholdPercent(threshold: number): string {
  return `${(threshold * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function pathLooksWindows(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const pathApi = pathLooksWindows(parentPath) || pathLooksWindows(candidatePath) ? win32 : { relative, isAbsolute };
  const rel = pathApi.relative(parentPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel));
}

function getFrontmatterString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readSkillBodyOverride(skillPath: string, metadata: Record<string, unknown>, fallbackBody: string): string {
  const bodyPath = getFrontmatterString(metadata, 'wise-full-body');
  if (!bodyPath) {
    return fallbackBody;
  }

  const skillDir = dirname(skillPath);
  const resolvedBodyPath = resolve(skillDir, bodyPath);
  const packageRoot = resolve(getPackageDir());

  if (!isPathInsideOrEqual(packageRoot, resolvedBodyPath)) {
    return fallbackBody;
  }

  try {
    const fullContent = readFileSync(resolvedBodyPath, 'utf-8');
    const { body } = parseFrontmatter(fullContent);
    return body;
  } catch {
    return fallbackBody;
  }
}

function applyDeepInterviewRuntimeSettings(template: string): string {
  const { threshold, source } = getDeepInterviewAmbiguityThresholdResolution();
  const percent = formatThresholdPercent(threshold);

  const withResolvedPlaceholders = template
    .replaceAll('<resolvedThreshold>', `${threshold}`)
    .replaceAll('<resolvedThresholdPercent>', percent)
    .replaceAll('<resolvedThresholdSource>', source);

  const withRuntimeSettings = withResolvedPlaceholders.includes('3.5. **Load runtime settings**:')
    || withResolvedPlaceholders.includes('## Phase 0: Resolve Ambiguity Threshold')
    ? withResolvedPlaceholders
    : withResolvedPlaceholders.replace(
      '4. **Initialize state** via `state_write(mode="deep-interview")`:',
      [
        `3.5. **Load runtime settings** from \`~/.claude/settings.json\` and \`./.claude/settings.json\` before state init (project overrides profile). For this run, use \`ambiguityThreshold = ${threshold}\`.`,
        '4. **Initialize state** via `state_write(mode="deep-interview")`:',
      ].join('\n'),
    );

  return withRuntimeSettings
    .replace('"threshold": 0.2,', `"threshold": ${threshold},`)
    .replace(
      'We\'ll proceed to execution once ambiguity drops below 20%.',
      `We'll proceed to execution once ambiguity drops below ${percent}.`,
    )
    // 修复 #2545：替换与运行时阈值注入冲突的其余硬编码 20%/0.2 引用
    .replace('(default: 20%)', `(default: ${percent})`)
    .replace('(default 0.2)', `(default ${threshold})`)
    .replace('"ambiguityThreshold": 0.2,', `"ambiguityThreshold": ${threshold},`)
    .replace('Gate: ≤20% ambiguity', `Gate: ≤${percent} ambiguity`)
    .replace('(threshold: 20%).', `(threshold: ${percent}).`)
    .replace('ambiguity ≤ 20%', `ambiguity ≤ ${percent}`);
}

function normalizeSkillNameForRuntimeRendering(skillName: string): string {
  return skillName.trim().toLowerCase().replace(/^wise:/, '').replace(/^wise:/, '');
}

export function renderBundledSkillBody(skillName: string, body: string): string {
  const normalizedSkillName = normalizeSkillNameForRuntimeRendering(skillName);
  const rewrittenBody = rewriteWiseCliInvocations(body.trim());
  return normalizedSkillName === 'deep-interview' || normalizedSkillName === 'deep-dive'
    ? applyDeepInterviewRuntimeSettings(rewrittenBody)
    : rewrittenBody;
}

/**
 * 从 SKILL.md 文件加载单个技能
 */
function loadSkillFromFile(skillPath: string, skillName: string): BuiltinSkill[] {
  try {
    const content = readFileSync(skillPath, 'utf-8');
    const { metadata, body } = parseFrontmatter(content);
    const resolvedName = metadata.name || skillName;
    const safePrimaryName = toSafeSkillName(resolvedName);
    const pipeline = parseSkillPipelineMetadata(metadata);
    const fullBody = readSkillBodyOverride(skillPath, metadata, body);
    const renderedBody = renderBundledSkillBody(safePrimaryName, fullBody);
    const template = [
      renderedBody,
      renderSkillRuntimeGuidance(safePrimaryName),
      renderSkillPipelineGuidance(safePrimaryName, pipeline),
      renderSkillResourcesGuidance(skillPath),
    ].filter((section) => section.trim().length > 0).join('\n\n');

    const safeAliases = Array.from(
      new Set(
        parseFrontmatterAliases(metadata.aliases)
          .map((alias: string) => toSafeSkillName(alias))
          .filter((alias: string) => alias.length > 0 && alias.toLowerCase() !== safePrimaryName.toLowerCase())
      )
    );

    const allNames = [safePrimaryName, ...safeAliases];
    const skillEntries: BuiltinSkill[] = [];
    const seen = new Set<string>();

    for (const name of allNames) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      skillEntries.push({
        name,
        aliases: name === safePrimaryName ? safeAliases : undefined,
        aliasOf: name === safePrimaryName ? undefined : safePrimaryName,
        deprecatedAlias: name === safePrimaryName ? undefined : true,
        deprecationMessage: name === safePrimaryName
          ? undefined
          : `Skill alias "${name}" is deprecated. Use "${safePrimaryName}" instead.`,
        description: metadata.description || '',
        template,
        // 来自 frontmatter 的可选字段
        model: metadata.model,
        agent: metadata.agent,
        argumentHint: metadata['argument-hint'],
        pipeline: name === safePrimaryName ? pipeline : undefined,
      });
    }

    return skillEntries;
  } catch {
    return [];
  }
}

/**
 * 从 skills/ 目录加载所有技能
 */
function loadSkillsFromDirectory(): BuiltinSkill[] {
  if (!existsSync(SKILLS_DIR)) {
    return [];
  }

  const skills: BuiltinSkill[] = [];
  const seenNames = new Set<string>();

  try {
    const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .sort((a, b) => {
        // 公开的规范技能制作入口必须先认领其已弃用的
        // learner 别名，再处理遗留兼容技能。
        if (a.name === 'skillify') return -1;
        if (b.name === 'skillify') return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKININTHEGAMEBROS_ONLY_SKILLS.has(entry.name) && !isSkininthegamebrosUser()) {
        continue;
      }

      const skillPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (existsSync(skillPath)) {
        const skillEntries = loadSkillFromFile(skillPath, entry.name);
        for (const skill of skillEntries) {
          const key = skill.name.toLowerCase();
          if (seenNames.has(key)) continue;
          seenNames.add(key);
          skills.push(skill);
        }
      }
    }
  } catch {
    // 若目录读取失败则返回空数组
    return [];
  }

  return skills;
}

// 缓存已加载的技能以避免重复读取文件
let cachedSkills: BuiltinSkill[] | null = null;
let cachedSkillsKey: string | null = null;

function getBuiltinSkillsCacheKey(): string {
  return JSON.stringify({
    deepInterviewAmbiguityThreshold: getDeepInterviewAmbiguityThresholdResolution(),
  });
}

/**
 * 获取所有内置技能
 *
 * 技能从 skills/ 目录下打包的 SKILL.md 文件加载。
 * 首次加载后结果会被缓存。
 */
export function createBuiltinSkills(): BuiltinSkill[] {
  const cacheKey = getBuiltinSkillsCacheKey();
  if (cachedSkills === null || cachedSkillsKey !== cacheKey) {
    cachedSkills = loadSkillsFromDirectory();
    cachedSkillsKey = cacheKey;
  }
  return cachedSkills;
}

/**
 * 按名称获取技能
 */
export function getBuiltinSkill(name: string): BuiltinSkill | undefined {
  const skills = createBuiltinSkills();
  return skills.find(s => s.name.toLowerCase() === name.toLowerCase());
}

export interface ListBuiltinSkillNamesOptions {
  includeAliases?: boolean;
}

/**
 * 列出所有内置技能名称
 */
export function listBuiltinSkillNames(options?: ListBuiltinSkillNamesOptions): string[] {
  const { includeAliases = false } = options ?? {};
  const skills = createBuiltinSkills();
  if (includeAliases) {
    return skills.map((s) => s.name);
  }
  return skills.filter((s) => !s.aliasOf).map((s) => s.name);
}

/**
 * 清除技能缓存（测试时有用）
 */
export function clearSkillsCache(): void {
  cachedSkills = null;
  cachedSkillsKey = null;
}

/**
 * 获取 skills 目录路径（调试时有用）
 */
export function getSkillsDir(): string {
  return SKILLS_DIR;
}
