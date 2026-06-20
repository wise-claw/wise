/**
 * 自动斜杠命令钩子
 *
 * 检测并展开用户 prompt 中的斜杠命令。
 * 作为 Claude Code 原生斜杠命令系统的补充，新增：
 * - 来自 ~/.claude/skills/ 和 .claude/skills/ 的基于技能的命令
 * - 来自 .claude/commands/ 的项目级命令
 * - 支持 $ARGUMENTS 占位符的模板展开
 *
 * 改编自 oh-my-opencode 的 auto-slash-command 钩子。
 */

import {
  detectSlashCommand,
  extractPromptText,
} from './detector.js';
import {
  executeSlashCommand,
  findCommand,
  listAvailableCommands,
} from './executor.js';
import {
  HOOK_NAME,
  AUTO_SLASH_COMMAND_TAG_OPEN,
  AUTO_SLASH_COMMAND_TAG_CLOSE,
} from './constants.js';
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandResult,
} from './types.js';

// 重新导出所有子模块
export * from './types.js';
export * from './constants.js';
export {
  detectSlashCommand,
  extractPromptText,
  parseSlashCommand,
  removeCodeBlocks,
  isExcludedCommand,
} from './detector.js';
export {
  executeSlashCommand,
  findCommand,
  discoverAllCommands,
  listAvailableCommands,
} from './executor.js';

/** 记录已处理的命令以避免重复展开 */
const sessionProcessedCommands = new Set<string>();

/**
 * 创建自动斜杠命令钩子处理器
 */
export function createAutoSlashCommandHook() {
  return {
    /**
     * 钩子名称标识符
     */
    name: HOOK_NAME,

    /**
     * 处理用户消息以检测并展开斜杠命令
     */
    processMessage: (
      input: AutoSlashCommandHookInput,
      parts: Array<{ type: string; text?: string }>
    ): AutoSlashCommandResult => {
      const promptText = extractPromptText(parts);

      // 若已处理（包含我们的标签）则跳过
      if (
        promptText.includes(AUTO_SLASH_COMMAND_TAG_OPEN) ||
        promptText.includes(AUTO_SLASH_COMMAND_TAG_CLOSE)
      ) {
        return { detected: false };
      }

      const parsed = detectSlashCommand(promptText);

      if (!parsed) {
        return { detected: false };
      }

      // 会话内去重
      const commandKey = `${input.sessionId}:${input.messageId}:${parsed.command}`;
      if (sessionProcessedCommands.has(commandKey)) {
        return { detected: false };
      }
      sessionProcessedCommands.add(commandKey);

      // 执行命令
      const result = executeSlashCommand(parsed);

      if (result.success && result.replacementText) {
        const taggedContent = `${AUTO_SLASH_COMMAND_TAG_OPEN}\n${result.replacementText}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`;

        return {
          detected: true,
          parsedCommand: parsed,
          injectedMessage: taggedContent,
        };
      }

      // 命令未找到或出错
      const errorMessage = `${AUTO_SLASH_COMMAND_TAG_OPEN}\n[AUTO-SLASH-COMMAND ERROR]\n${result.error}\n\nOriginal input: ${parsed.raw}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`;

      return {
        detected: true,
        parsedCommand: parsed,
        injectedMessage: errorMessage,
      };
    },

    /**
     * 获取可用命令列表
     */
    listCommands: () => {
      return listAvailableCommands();
    },

    /**
     * 按名称查找指定命令
     */
    findCommand: (name: string) => {
      return findCommand(name);
    },

    /**
     * 清除某个会话的已处理命令缓存
     */
    clearSession: (sessionId: string) => {
      // 清除该会话的所有命令
      const keysToDelete: string[] = [];
      for (const key of sessionProcessedCommands) {
        if (key.startsWith(`${sessionId}:`)) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        sessionProcessedCommands.delete(key);
      }
    },
  };
}

/**
 * 处理 prompt 以展开斜杠命令（简单工具函数）
 */
export function processSlashCommand(prompt: string): AutoSlashCommandResult {
  const hook = createAutoSlashCommandHook();
  return hook.processMessage(
    {},
    [{ type: 'text', text: prompt }]
  );
}
