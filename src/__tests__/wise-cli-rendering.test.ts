import { describe, expect, it } from 'vitest';
import {
  formatWiseCliInvocation,
  resolveWiseCliPrefix,
  rewriteWiseCliInvocations,
} from '../utils/wise-cli-rendering.js';

describe('wise CLI rendering', () => {
  it('uses wise when the binary is available', () => {
    expect(resolveWiseCliPrefix({ wiseAvailable: true, env: {} as NodeJS.ProcessEnv })).toBe('wise');
    expect(formatWiseCliInvocation('team api claim-task', { wiseAvailable: true, env: {} as NodeJS.ProcessEnv }))
      .toBe('wise team api claim-task');
  });

  it('falls back to the plugin bridge when wise is unavailable but CLAUDE_PLUGIN_ROOT is set', () => {
    const env = { CLAUDE_PLUGIN_ROOT: '/tmp/plugin-root' } as NodeJS.ProcessEnv;
    expect(resolveWiseCliPrefix({ wiseAvailable: false, env }))
      .toBe('node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs');
    expect(formatWiseCliInvocation('autoresearch --mission "m"', { wiseAvailable: false, env }))
      .toBe('node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs autoresearch --mission "m"');
  });

  it('rewrites inline and list-form wise commands for plugin installs', () => {
    const env = { CLAUDE_PLUGIN_ROOT: '/tmp/plugin-root' } as NodeJS.ProcessEnv;
    const input = [
      'Run `wise autoresearch --mission "m" --eval "e"`.',
      '- wise team api claim-task --input \'{}\' --json',
      '> wise ask codex --agent-prompt critic "check"',
    ].join('\n');

    const output = rewriteWiseCliInvocations(input, { wiseAvailable: false, env });

    expect(output).toContain('`node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs autoresearch --mission "m" --eval "e"`');
    expect(output).toContain('- node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs team api claim-task --input \'{}\' --json');
    expect(output).toContain('> node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs ask codex --agent-prompt critic "check"');
  });

  it('routes ask invocations through the plugin bridge inside an active Claude session when CLAUDE_PLUGIN_ROOT is set', () => {
    const env = {
      CLAUDE_PLUGIN_ROOT: '/tmp/plugin-root',
      CLAUDECODE: '1',
      CLAUDE_SESSION_ID: 'session-123',
    } as NodeJS.ProcessEnv;

    expect(resolveWiseCliPrefix({ wiseAvailable: false, env })).toBe('node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs');
    expect(formatWiseCliInvocation('ask codex --prompt "check"', { wiseAvailable: false, env }))
      .toBe('node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs ask codex --prompt "check"');

    const input = [
      'Run `wise ask codex "review"`.',
      '> wise ask gemini --prompt "improve docs"',
    ].join('\n');

    const output = rewriteWiseCliInvocations(input, { wiseAvailable: false, env });
    expect(output).toContain('`node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs ask codex "review"`');
    expect(output).toContain('> node "$CLAUDE_PLUGIN_ROOT"/bridge/cli.cjs ask gemini --prompt "improve docs"');
  });

  it('leaves text unchanged when wise remains the selected prefix', () => {
    const input = 'Use `wise team status demo` and\nomc team wait demo';
    expect(rewriteWiseCliInvocations(input, { wiseAvailable: true, env: {} as NodeJS.ProcessEnv })).toBe(input);
  });
});
