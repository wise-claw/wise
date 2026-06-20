/**
 * 注释检查器钩子
 *
 * 检测代码变更中的注释与文档字符串，并提示 Claude
 * 说明理由或移除不必要的注释。
 *
 * 改编自 oh-my-opencode 的 comment-checker 钩子。
 * 该实现不再使用外部 CLI 二进制，而是直接在 TypeScript 中
 * 进行注释检测。
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  HOOK_MESSAGE_HEADER,
  LINE_COMMENT_PATTERNS,
  EXTENSION_TO_LANGUAGE,
} from './constants.js';
import { applyFilters } from './filters.js';
import type { CommentInfo, CommentCheckResult, PendingCall } from './types.js';

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === '1';
const DEBUG_FILE = path.join(tmpdir(), 'comment-checker-debug.log');

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker] ${args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
      .join(' ')}\n`;
    fs.appendFileSync(DEBUG_FILE, msg);
  }
}

/**
 * 根据文件扩展名获取语言
 */
function getLanguageFromPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext];
}

/**
 * 使用正则模式检测内容中的注释
 */
function detectComments(content: string, filePath: string): CommentInfo[] {
  const language = getLanguageFromPath(filePath);
  if (!language) {
    debugLog('unsupported language for:', filePath);
    return [];
  }

  const pattern = LINE_COMMENT_PATTERNS[language];
  if (!pattern) {
    debugLog('no pattern for language:', language);
    return [];
  }

  const comments: CommentInfo[] = [];

  // 重置正则状态
  pattern.lastIndex = 0;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];

    // 计算行号
    const beforeMatch = content.substring(0, matchStart);
    const lineNumber = beforeMatch.split('\n').length;

    // 确定注释类型
    let commentType: 'line' | 'block' | 'docstring' = 'line';
    let isDocstring = false;

    if (matchText.startsWith('/*') || matchText.startsWith('<!--')) {
      commentType = 'block';
    } else if (
      matchText.startsWith("'''") ||
      matchText.startsWith('"""') ||
      matchText.startsWith('=begin')
    ) {
      commentType = 'docstring';
      isDocstring = true;
    }

    comments.push({
      text: matchText.trim(),
      lineNumber,
      filePath,
      commentType,
      isDocstring,
    });
  }

  return comments;
}

/**
 * 从新内容中提取注释（用于 Write 工具）
 */
function extractCommentsFromContent(
  content: string,
  filePath: string
): CommentInfo[] {
  return detectComments(content, filePath);
}

/**
 * 从新字符串中提取注释（用于 Edit 工具）
 */
function extractCommentsFromEdit(
  newString: string,
  filePath: string,
  oldString?: string
): CommentInfo[] {
  // 仅检查新增的注释
  const newComments = detectComments(newString, filePath);

  if (oldString) {
    const oldComments = detectComments(oldString, filePath);
    const oldTexts = new Set(oldComments.map((c) => c.text));

    // 过滤掉之前已存在的注释
    return newComments.filter((c) => !oldTexts.has(c.text));
  }

  return newComments;
}

/**
 * 格式化注释以用于输出消息
 */
function formatCommentMessage(comments: CommentInfo[]): string {
  if (comments.length === 0) {
    return '';
  }

  const grouped = new Map<string, CommentInfo[]>();
  for (const comment of comments) {
    const existing = grouped.get(comment.filePath) || [];
    existing.push(comment);
    grouped.set(comment.filePath, existing);
  }

  let message = HOOK_MESSAGE_HEADER;

  for (const [filePath, fileComments] of grouped) {
    message += `\nFile: ${filePath}\n`;
    for (const comment of fileComments) {
      const typeLabel = comment.isDocstring ? 'docstring' : comment.commentType;
      message += `  Line ${comment.lineNumber} (${typeLabel}): ${comment.text.substring(0, 100)}${comment.text.length > 100 ? '...' : ''}\n`;
    }
  }

  return message;
}

/**
 * 检查内容中的注释
 */
export function checkForComments(
  filePath: string,
  content?: string,
  oldString?: string,
  newString?: string,
  edits?: Array<{ old_string: string; new_string: string }>
): CommentCheckResult {
  let allComments: CommentInfo[] = [];

  if (content) {
    // Write 工具——检查整个内容
    allComments = extractCommentsFromContent(content, filePath);
  } else if (newString) {
    // Edit 工具——检查新内容
    allComments = extractCommentsFromEdit(newString, filePath, oldString);
  } else if (edits && edits.length > 0) {
    // MultiEdit 工具——检查所有编辑
    for (const edit of edits) {
      const editComments = extractCommentsFromEdit(
        edit.new_string,
        filePath,
        edit.old_string
      );
      allComments.push(...editComments);
    }
  }

  // 应用过滤器以移除可接受的注释
  const flaggedComments = applyFilters(allComments);

  debugLog(
    `found ${allComments.length} comments, ${flaggedComments.length} flagged after filtering`
  );

  if (flaggedComments.length === 0) {
    return {
      hasComments: false,
      count: 0,
      comments: [],
    };
  }

  return {
    hasComments: true,
    count: flaggedComments.length,
    message: formatCommentMessage(flaggedComments),
    comments: flaggedComments,
  };
}

/**
 * 注释检查器钩子配置
 */
export interface CommentCheckerConfig {
  /** 追加的自定义 prompt，替代默认值 */
  customPrompt?: string;
  /** 是否启用该钩子 */
  enabled?: boolean;
}

/**
 * 待处理调用追踪
 */
const pendingCalls = new Map<string, PendingCall>();

/**
 * 为 Claude Code shell 钩子创建注释检查器钩子
 *
 * 该钩子检查 Write/Edit 操作中的注释，并注入
 * 一条消息，提示 Claude 说明理由或移除不必要的注释。
 */
export function createCommentCheckerHook(config?: CommentCheckerConfig) {
  debugLog('createCommentCheckerHook called', { config });

  return {
    /**
     * PreToolUse——追踪待处理的 write/edit 调用
     */
    preToolUse: (input: {
      tool_name: string;
      session_id: string;
      tool_input: Record<string, unknown>;
    }): { decision: string } | null => {
      const toolLower = input.tool_name.toLowerCase();

      if (
        toolLower !== 'write' &&
        toolLower !== 'edit' &&
        toolLower !== 'multiedit'
      ) {
        return null;
      }

      const filePath = (input.tool_input.file_path ??
        input.tool_input.filePath ??
        input.tool_input.path) as string | undefined;
      const content = input.tool_input.content as string | undefined;
      const oldString = (input.tool_input.old_string ??
        input.tool_input.oldString) as string | undefined;
      const newString = (input.tool_input.new_string ??
        input.tool_input.newString) as string | undefined;
      const edits = input.tool_input.edits as
        | Array<{ old_string: string; new_string: string }>
        | undefined;

      if (!filePath) {
        return null;
      }

      // 基于会话与时间戳生成调用 ID
      const callId = `${input.session_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      debugLog('registering pendingCall:', {
        callId,
        filePath,
        tool: toolLower,
      });

      pendingCalls.set(callId, {
        filePath,
        content,
        oldString,
        newString,
        edits,
        tool: toolLower as 'write' | 'edit' | 'multiedit',
        sessionId: input.session_id,
        timestamp: Date.now(),
      });

      return null;
    },

    /**
     * PostToolUse——在成功的 write/edit 之后检查注释
     */
    postToolUse: (input: {
      tool_name: string;
      session_id: string;
      tool_input: Record<string, unknown>;
      tool_response?: string;
    }): string | null => {
      const toolLower = input.tool_name.toLowerCase();

      if (
        toolLower !== 'write' &&
        toolLower !== 'edit' &&
        toolLower !== 'multiedit'
      ) {
        return null;
      }

      // 查找该会话的待处理调用
      let pendingCall: PendingCall | undefined;
      let callIdToDelete: string | undefined;

      for (const [callId, call] of pendingCalls) {
        if (call.sessionId === input.session_id && call.tool === toolLower) {
          pendingCall = call;
          callIdToDelete = callId;
          break;
        }
      }

      if (!pendingCall) {
        // 兜底：从 tool_input 中提取
        const filePath = (input.tool_input.file_path ??
          input.tool_input.filePath ??
          input.tool_input.path) as string | undefined;

        if (!filePath) {
          return null;
        }

        pendingCall = {
          filePath,
          content: input.tool_input.content as string | undefined,
          oldString: (input.tool_input.old_string ??
            input.tool_input.oldString) as string | undefined,
          newString: (input.tool_input.new_string ??
            input.tool_input.newString) as string | undefined,
          edits: input.tool_input.edits as
            | Array<{ old_string: string; new_string: string }>
            | undefined,
          tool: toolLower as 'write' | 'edit' | 'multiedit',
          sessionId: input.session_id,
          timestamp: Date.now(),
        };
      }

      if (callIdToDelete) {
        pendingCalls.delete(callIdToDelete);
      }

      // 检查工具执行是否失败
      if (input.tool_response) {
        const responseLower = input.tool_response.toLowerCase();
        const isToolFailure =
          responseLower.includes('error:') ||
          responseLower.includes('failed to') ||
          responseLower.includes('could not') ||
          responseLower.startsWith('error');

        if (isToolFailure) {
          debugLog('skipping due to tool failure in response');
          return null;
        }
      }

      // 检查注释
      const result = checkForComments(
        pendingCall.filePath,
        pendingCall.content,
        pendingCall.oldString,
        pendingCall.newString,
        pendingCall.edits
      );

      if (result.hasComments && result.message) {
        debugLog('detected comments, returning message');
        return config?.customPrompt || result.message;
      }

      return null;
    },
  };
}

// 重新导出类型
export type { CommentInfo, CommentCheckResult, PendingCall } from './types.js';

// 重新导出过滤器
export { applyFilters } from './filters.js';

// 重新导出常量
export {
  BDD_KEYWORDS,
  TYPE_CHECKER_PREFIXES,
  HOOK_MESSAGE_HEADER,
  LINE_COMMENT_PATTERNS,
  EXTENSION_TO_LANGUAGE,
} from './constants.js';
