import { spawnSync } from 'child_process';

const WISE_CLI_BINARY = 'wise';
const WISE_PLUGIN_BRIDGE_PREFIX = 'node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs';

export interface WiseCliRenderOptions {
  env?: NodeJS.ProcessEnv;
  wiseAvailable?: boolean;
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookupCommand, [command], {
    stdio: 'ignore',
    env,
  });
  return result.status === 0;
}

export function resolveWiseCliPrefix(options: WiseCliRenderOptions = {}): string {
  const env = options.env ?? process.env;
  const wiseAvailable = options.wiseAvailable ?? commandExists(WISE_CLI_BINARY, env);
  if (wiseAvailable) {
    return WISE_CLI_BINARY;
  }

  const pluginRoot = typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT.trim() : '';
  if (pluginRoot) {
    return WISE_PLUGIN_BRIDGE_PREFIX;
  }

  return WISE_CLI_BINARY;
}

function resolveInvocationPrefix(
  commandSuffix: string,
  options: WiseCliRenderOptions = {},
): string {
  void commandSuffix;
  return resolveWiseCliPrefix(options);
}

export function formatWiseCliInvocation(
  commandSuffix: string,
  options: WiseCliRenderOptions = {},
): string {
  const suffix = commandSuffix.trim().replace(/^wise\s+/, '');
  return `${resolveInvocationPrefix(suffix, options)} ${suffix}`.trim();
}

export function rewriteWiseCliInvocations(
  text: string,
  options: WiseCliRenderOptions = {},
): string {
  if (!text.includes('wise ')) {
    return text;
  }

  return text
    .replace(/`wise ([^`\r\n]+)`/g, (_match, suffix: string) => {
      const prefix = resolveInvocationPrefix(suffix, options);
      return `\`${prefix} ${suffix}\``;
    })
    .replace(/(^|\n)([ \t>*-]*)wise ([^\n]+)/g, (_match, lineStart: string, leader: string, suffix: string) => {
      const prefix = resolveInvocationPrefix(suffix, options);
      return `${lineStart}${leader}${prefix} ${suffix}`;
    });
}
