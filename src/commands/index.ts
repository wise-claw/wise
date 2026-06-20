/**
 * 命令展开工具
 *
 * 通过读取命令模板并用参数展开,提供与 SDK 兼容的 slash 命令访问。
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getClaudeConfigDir } from '../utils/config-dir.js';

export interface CommandInfo {
  name: string;
  description: string;
  template: string;
  filePath: string;
}

export interface ExpandedCommand {
  name: string;
  prompt: string;
  description: string;
}

/**
 * 获取 commands 目录路径
 */
export function getCommandsDir(): string {
  return join(getClaudeConfigDir(), 'commands');
}

/**
 * 解析命令 frontmatter 和内容
 */
function parseCommandFile(content: string): { description: string; template: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { description: '', template: content };
  }

  const frontmatter = frontmatterMatch[1];
  const template = frontmatterMatch[2];

  // 从 frontmatter 中提取描述
  const descMatch = frontmatter.match(/description:\s*(.+)/);
  const description = descMatch ? descMatch[1].trim() : '';

  return { description, template };
}

/**
 * 按名称获取指定命令
 */
export function getCommand(name: string): CommandInfo | null {
  const commandsDir = getCommandsDir();
  const filePath = join(commandsDir, `${name}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const { description, template } = parseCommandFile(content);

    return {
      name,
      description,
      template,
      filePath
    };
  } catch (error) {
    console.error(`Error reading command ${name}:`, error);
    return null;
  }
}

/**
 * 获取所有可用命令
 */
export function getAllCommands(): CommandInfo[] {
  const commandsDir = getCommandsDir();

  if (!existsSync(commandsDir)) {
    return [];
  }

  try {
    const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    const commands: CommandInfo[] = [];

    for (const file of files) {
      const name = file.replace('.md', '');
      const command = getCommand(name);
      if (command) {
        commands.push(command);
      }
    }

    return commands;
  } catch (error) {
    console.error('Error listing commands:', error);
    return [];
  }
}

/**
 * 列出可用的命令名
 */
export function listCommands(): string[] {
  return getAllCommands().map(c => c.name);
}

/**
 * 用参数展开命令模板
 *
 * @param name - 命令名 (不含前导斜杠)
 * @param args - 用于替换 $ARGUMENTS 的参数
 * @returns 展开后的命令,可用于 SDK query
 *
 * @example
 * ```typescript
 * import { expandCommand } from 'wise';
 *
 * const prompt = expandCommand('ralph', 'Build a REST API');
 * // 返回完整的 ralph 模板,其中 "Build a REST API" 已被替换
 * ```
 */
export function expandCommand(name: string, args: string = ''): ExpandedCommand | null {
  const command = getCommand(name);

  if (!command) {
    return null;
  }

  // 用实际参数替换 $ARGUMENTS 占位符
  const prompt = command.template.replace(/\$ARGUMENTS/g, args);

  return {
    name,
    prompt: prompt.trim(),
    description: command.description
  };
}

/**
 * 展开命令并仅返回 prompt 字符串
 * 便于直接用于 SDK query 的便捷函数
 *
 * @example
 * ```typescript
 * import { expandCommandPrompt } from 'wise';
 * import { query } from '@anthropic-ai/claude-agent-sdk';
 *
 * const prompt = expandCommandPrompt('ultrawork', 'Refactor the auth module');
 *
 * for await (const msg of query({ prompt })) {
 *   console.log(msg);
 * }
 * ```
 */
export function expandCommandPrompt(name: string, args: string = ''): string | null {
  const expanded = expandCommand(name, args);
  return expanded ? expanded.prompt : null;
}

/**
 * 检查命令是否存在
 */
export function commandExists(name: string): boolean {
  return getCommand(name) !== null;
}

/**
 * 批量展开多个命令
 */
export function expandCommands(commands: Array<{ name: string; args?: string }>): ExpandedCommand[] {
  return commands
    .map(({ name, args }) => expandCommand(name, args))
    .filter((c): c is ExpandedCommand => c !== null);
}
