/**
 * 自动斜杠命令执行器
 *
 * 从多个来源发现并执行斜杠命令。
 *
 * 改编自 oh-my-opencode 的 auto-slash-command 钩子。
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import { getWiseRoot } from '../../lib/worktree-paths.js';
import type {
  ParsedSlashCommand,
  CommandInfo,
  CommandMetadata,
  CommandScope,
  ExecuteResult,
} from './types.js';
import { resolveLiveData } from './live-data.js';
import { parseFrontmatter, parseFrontmatterAliases, stripOptionalQuotes } from '../../utils/frontmatter.js';
import { rewriteWiseCliInvocations } from '../../utils/wise-cli-rendering.js';
import { parseSkillPipelineMetadata, renderSkillPipelineGuidance } from '../../utils/skill-pipeline.js';
import { renderSkillResourcesGuidance } from '../../utils/skill-resources.js';
import { renderSkillRuntimeGuidance } from '../../features/builtin-skills/runtime-guidance.js';
import { getSkillsDir, renderBundledSkillBody } from '../../features/builtin-skills/skills.js';

/** Claude 配置目录 */
const CLAUDE_CONFIG_DIR = getClaudeConfigDir();

/**
 * 不可被用户技能遮蔽的 Claude Code 原生命令。
 * 规范名或别名命中其中之一的技能会被加上 `wise-` 前缀，
 * 以免覆盖内置的 CC 斜杠命令。
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

function toSafeSkillName(name: string): string {
  const normalized = name.trim();
  return CC_NATIVE_COMMANDS.has(normalized.toLowerCase())
    ? `wise-${normalized}`
    : normalized;
}

function getFrontmatterString(
  data: Record<string, string>,
  key: string,
): string | undefined {
  const value = data[key];
  if (!value) return undefined;
  const normalized = stripOptionalQuotes(value);
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * 从目录中发现命令
 */
function discoverCommandsFromDir(
  commandsDir: string,
  scope: CommandScope
): CommandInfo[] {
  if (!existsSync(commandsDir)) {
    return [];
  }

  let entries;
  try {
    entries = readdirSync(commandsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const commands: CommandInfo[] = [];

  for (const entry of entries) {
    // 仅处理 .md 文件
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const commandPath = join(commandsDir, entry.name);
    const commandName = basename(entry.name, '.md');

    try {
      const content = readFileSync(commandPath, 'utf-8');
      const { metadata: fm, body } = parseFrontmatter(content);

      const commandMetadata: CommandMetadata = {
        name: commandName,
        description: fm.description || '',
        argumentHint: fm['argument-hint'],
        model: fm.model,
        agent: fm.agent,
      };

      commands.push({
        name: commandName,
        path: commandPath,
        metadata: commandMetadata,
        content: body,
        scope,
      });
    } catch {
      continue;
    }
  }

  return commands;
}

function discoverSkillsFromDir(skillsDir: string): CommandInfo[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skillCommands: CommandInfo[] = [];

  try {
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true });
    for (const dir of skillDirs) {
      if (!dir.isDirectory()) continue;

      const skillPath = join(skillsDir, dir.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      try {
        const content = readFileSync(skillPath, 'utf-8');
        const { metadata: fm, body } = parseFrontmatter(content);

        const rawName = getFrontmatterString(fm, 'name') || dir.name;
        const canonicalName = toSafeSkillName(rawName);
        const aliases = Array.from(new Set(
          parseFrontmatterAliases(fm.aliases)
            .map((alias: string) => toSafeSkillName(alias))
            .filter((alias: string) => alias.toLowerCase() !== canonicalName.toLowerCase())
        ));
        const commandNames = [canonicalName, ...aliases];
        const description = getFrontmatterString(fm, 'description') || '';
        const argumentHint = getFrontmatterString(fm, 'argument-hint');
        const model = getFrontmatterString(fm, 'model');
        const agent = getFrontmatterString(fm, 'agent');
        const pipeline = parseSkillPipelineMetadata(fm);

        for (const commandName of commandNames) {
          const isAlias = commandName !== canonicalName;
          const metadata: CommandMetadata = {
            name: commandName,
            description,
            argumentHint,
            model,
            agent,
            pipeline: isAlias ? undefined : pipeline,
            aliases: isAlias ? undefined : aliases,
            aliasOf: isAlias ? canonicalName : undefined,
            deprecatedAlias: isAlias || undefined,
            deprecationMessage: isAlias
              ? `Alias "/${commandName}" is deprecated. Use "/${canonicalName}" instead.`
              : undefined,
          };

          skillCommands.push({
            name: commandName,
            path: skillPath,
            metadata,
            content: body,
            scope: 'skill',
          });
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return skillCommands;
}

/**
 * 从多个来源发现所有可用命令
 */
export function discoverAllCommands(): CommandInfo[] {
  const userCommandsDir = join(CLAUDE_CONFIG_DIR, 'commands');
  const projectCommandsDir = join(process.cwd(), '.claude', 'commands');
  const projectClaudeSkillsDir = join(process.cwd(), '.claude', 'skills');
  const projectWiseSkillsDir = join(getWiseRoot(), 'skills');
  const projectAgentSkillsDir = join(process.cwd(), '.agents', 'skills');
  const userSkillsDir = join(CLAUDE_CONFIG_DIR, 'skills');

  const userCommands = discoverCommandsFromDir(userCommandsDir, 'user');
  const projectCommands = discoverCommandsFromDir(projectCommandsDir, 'project');
  const projectClaudeSkills = discoverSkillsFromDir(projectClaudeSkillsDir);
  const projectWiseSkills = discoverSkillsFromDir(projectWiseSkillsDir);
  const projectAgentSkills = discoverSkillsFromDir(projectAgentSkillsDir);
  const userSkills = discoverSkillsFromDir(userSkillsDir);
  const builtinSkills = discoverSkillsFromDir(getSkillsDir());

  // 优先级：项目命令 > 用户命令 > 项目 Claude Code 技能 > 项目 WISE 技能 > 项目兼容技能 > 用户技能 > 内置技能
  const prioritized = [
    ...projectCommands,
    ...userCommands,
    ...projectClaudeSkills,
    ...projectWiseSkills,
    ...projectAgentSkills,
    ...userSkills,
    ...builtinSkills,
  ];
  const seen = new Set<string>();

  return prioritized.filter((command) => {
    const key = command.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 按名称查找指定命令
 */
export function findCommand(commandName: string): CommandInfo | null {
  const allCommands = discoverAllCommands();
  return (
    allCommands.find(
      (cmd) => cmd.name.toLowerCase() === commandName.toLowerCase()
    ) ?? null
  );
}

/**
 * 解析命令内容中的 $ARGUMENTS 占位符
 */
function resolveArguments(content: string, args: string): string {
  return content.replace(/\$ARGUMENTS/g, args || '(no arguments provided)');
}

function hasInvocationFlag(args: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(args);
}

function stripInvocationFlag(args: string, flag: string): string {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return args
    .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderDeepInterviewAutoresearchGuidance(args: string): string {
  const missionSeed = stripInvocationFlag(args, '--autoresearch');
  const lines = [
    '## Autoresearch Setup Mode',
    'This deep-interview invocation was launched as the zero-learning-curve setup lane for the stateful `autoresearch` skill.',
    '',
    'Required behavior in this mode:',
    '- If the mission is not already clear, start by asking: "What should autoresearch improve or prove for this repo?"',
    '- Treat evaluator clarity as a required readiness gate before launch.',
    '- When the mission and evaluator are ready, write setup artifacts and hand off with:',
    '  `Skill("wise:autoresearch")`',
    '- Do **not** hand off to `wise-plan`, `autopilot`, `ralph`, `team`, or the hard-deprecated `wise autoresearch` CLI in this mode.',
  ];

  if (missionSeed) {
    lines.push('', `Mission seed from invocation: \`${missionSeed}\``);
  }

  return lines.join('\n');
}

/**
 * 用元数据头部格式化命令模板
 */
function formatCommandTemplate(cmd: CommandInfo, args: string): string {
  const sections: string[] = [];
  const isDeepInterviewAutoresearch = cmd.scope === 'skill'
    && cmd.metadata.name.toLowerCase() === 'deep-interview'
    && hasInvocationFlag(args, '--autoresearch');
  const displayArgs = isDeepInterviewAutoresearch
    ? stripInvocationFlag(args, '--autoresearch')
    : args;

  sections.push(`<command-name>/${cmd.name}</command-name>\n`);

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`);
  }

  if (displayArgs) {
    sections.push(`**Arguments**: ${displayArgs}\n`);
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`);
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`);
  }

  sections.push(`**Scope**: ${cmd.scope}\n`);

  if (cmd.metadata.aliasOf) {
    sections.push(
      `⚠️ **Deprecated Alias**: \`/${cmd.name}\` is deprecated and will be removed in a future release. Use \`/${cmd.metadata.aliasOf}\` instead.\n`
    );
  }

  sections.push('---\n');

  // 解析内容中的参数，再执行任何 live-data 命令
  const resolvedContent = resolveArguments(cmd.content || '', displayArgs);
  const baseContent = resolveLiveData(resolvedContent);
  const injectedContent = cmd.scope === 'skill'
    ? renderBundledSkillBody(cmd.metadata.name, baseContent)
    : rewriteWiseCliInvocations(baseContent);
  const runtimeGuidance = cmd.scope === 'skill' && !isDeepInterviewAutoresearch
    ? renderSkillRuntimeGuidance(cmd.metadata.name)
    : '';
  const pipelineGuidance = cmd.scope === 'skill' && !isDeepInterviewAutoresearch
    ? renderSkillPipelineGuidance(cmd.metadata.name, cmd.metadata.pipeline)
    : '';
  const resourceGuidance = cmd.scope === 'skill' && cmd.path
    ? renderSkillResourcesGuidance(cmd.path)
    : '';
  const invocationGuidance = isDeepInterviewAutoresearch
    ? renderDeepInterviewAutoresearchGuidance(args)
    : '';
  sections.push(
    [injectedContent.trim(), invocationGuidance, runtimeGuidance, pipelineGuidance, resourceGuidance]
      .filter((section) => section.trim().length > 0)
      .join('\n\n')
  );

  if (displayArgs && !cmd.content?.includes('$ARGUMENTS')) {
    sections.push('\n\n---\n');
    sections.push('## User Request\n');
    sections.push(displayArgs);
  }

  return sections.join('\n');
}

/**
 * 执行斜杠命令并返回替换文本
 */
export function executeSlashCommand(parsed: ParsedSlashCommand): ExecuteResult {
  const command = findCommand(parsed.command);

  if (!command) {
    return {
      success: false,
      error: `Command "/${parsed.command}" not found. Available commands are in ${CLAUDE_CONFIG_DIR}/commands/ or .claude/commands/`,
    };
  }

  try {
    const template = formatCommandTemplate(command, parsed.args);
    return {
      success: true,
      replacementText: template,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load command "/${parsed.command}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * 列出所有可用命令
 */
export function listAvailableCommands(): Array<{
  name: string;
  description: string;
  scope: CommandScope;
}> {
  return listAvailableCommandsWithOptions();
}

export function listAvailableCommandsWithOptions(options?: {
  includeAliases?: boolean;
}): Array<{
  name: string;
  description: string;
  scope: CommandScope;
}> {
  const { includeAliases = false } = options ?? {};
  const commands = discoverAllCommands();
  const visibleCommands = includeAliases
    ? commands
    : commands.filter((cmd) => !cmd.metadata.aliasOf);

  return visibleCommands.map((cmd) => ({
    name: cmd.name,
    description: cmd.metadata.description,
    scope: cmd.scope,
  }));
}
