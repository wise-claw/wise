export const AUTORESEARCH_HELP = `wise autoresearch - 已硬弃用

此命令不再是 autoresearch 的权威工作流。

请改用以下流程：
  1. /deep-interview --autoresearch "<mission 想法>"
     - 使用 deep-interview 生成/设置 mission 和评估器
  2. /wise:autoresearch
     - 运行有状态的单任务 autoresearch skill

关键行为：
  - v1 仅支持单任务
  - 运行时需要明确的评估器脚本/命令
  - 未通过的迭代不会停止运行
  - 运行在明确的 max-runtime 上限处停止

旧版 CLI 示例如：
  wise autoresearch --mission "..." --eval "..."
  wise autoresearch init ...
  wise autoresearch --resume ...
均为硬弃用垫片，不再启动旧版运行时。
`;

function renderDeprecationMessage(args: readonly string[]): string {
  const suffix = args.length > 0
    ? `\n收到旧版参数：${args.join(' ')}\n`
    : '\n';

  return `${AUTORESEARCH_HELP}${suffix}`;
}

export function normalizeAutoresearchClaudeArgs(claudeArgs: readonly string[]): string[] {
  return [...claudeArgs];
}

export interface ParsedAutoresearchArgs {
  args: string[];
  deprecated: true;
}

export function parseAutoresearchArgs(args: readonly string[]): ParsedAutoresearchArgs {
  return {
    args: [...args],
    deprecated: true,
  };
}

export async function autoresearchCommand(args: string[]): Promise<void> {
  console.log(renderDeprecationMessage(args));
}
