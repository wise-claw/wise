/**
 * Tests for Safe Installer (Task T2)
 * Tests hook conflict detection and forceHooks option
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isWiseHook, InstallOptions } from '../index.js';

/**
 * Detect hook conflicts using the real isWiseHook function.
 * Mirrors the install() logic to avoid test duplication.
 */
function detectConflicts(
  hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>
): Array<{ eventType: string; existingCommand: string }> {
  const conflicts: Array<{ eventType: string; existingCommand: string }> = [];
  for (const [eventType, eventHooks] of Object.entries(hooks)) {
    for (const hookGroup of eventHooks) {
      for (const hook of hookGroup.hooks) {
        if (hook.type === 'command' && !isWiseHook(hook.command)) {
          conflicts.push({ eventType, existingCommand: hook.command });
        }
      }
    }
  }
  return conflicts;
}

const TEST_CLAUDE_DIR = join(homedir(), '.claude-test-safe-installer');
const TEST_SETTINGS_FILE = join(TEST_CLAUDE_DIR, 'settings.json');

describe('isWiseHook', () => {
  it('returns true for commands containing "wise"', () => {
    expect(isWiseHook('node ~/.claude/hooks/wise-hook.mjs')).toBe(true);
    expect(isWiseHook('bash $HOME/.claude/hooks/wise-detector.sh')).toBe(true);
    expect(isWiseHook('/usr/bin/wise-tool')).toBe(true);
  });

  it('returns true for commands containing "wise"', () => {
    expect(isWiseHook('node ~/.claude/hooks/wise-hook.mjs')).toBe(true);
    expect(isWiseHook('bash $HOME/.claude/hooks/wise.sh')).toBe(true);
  });

  it('returns false for commands not containing wise or wise', () => {
    expect(isWiseHook('node ~/.claude/hooks/other-plugin.mjs')).toBe(false);
    expect(isWiseHook('bash $HOME/.claude/hooks/beads-hook.sh')).toBe(false);
    expect(isWiseHook('python /usr/bin/custom-hook.py')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isWiseHook('node ~/.claude/hooks/WISE-hook.mjs')).toBe(true);
    expect(isWiseHook('bash $HOME/.claude/hooks/WISE.sh')).toBe(true);
  });
});

describe('isWiseHook detection', () => {
  it('detects real WISE hooks correctly', () => {
    expect(isWiseHook('node ~/.claude/hooks/wise-hook.mjs')).toBe(true);
    expect(isWiseHook('node ~/.claude/hooks/wise-hook.mjs')).toBe(true);
    expect(isWiseHook('node ~/.claude/hooks/wise-pre-tool-use.mjs')).toBe(true);
    expect(isWiseHook('/usr/local/bin/wise')).toBe(true);
  });

  it('detects actual WISE hook commands from settings.json (issue #606)', () => {
    // These are the real commands WISE installs into settings.json
    expect(isWiseHook('node "$HOME/.claude/hooks/keyword-detector.mjs"')).toBe(true);
    expect(isWiseHook('node "$HOME/.claude/hooks/session-start.mjs"')).toBe(true);
    expect(isWiseHook('node "$HOME/.claude/hooks/pre-tool-use.mjs"')).toBe(true);
    expect(isWiseHook('node "$HOME/.claude/hooks/post-tool-use.mjs"')).toBe(true);
    expect(isWiseHook('node "$HOME/.claude/hooks/post-tool-use-failure.mjs"')).toBe(true);
    expect(isWiseHook('node "$HOME/.claude/hooks/persistent-mode.mjs"')).toBe(true);
  });

  it('detects custom-profile WISE hook commands by hook filename', () => {
    expect(isWiseHook('node "/tmp/custom-claude/hooks/keyword-detector.mjs"')).toBe(true);
  });

  it('detects CLAUDE_CONFIG_DIR-aware hook commands', () => {
    expect(isWiseHook('node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/keyword-detector.mjs"')).toBe(true);
    expect(isWiseHook('node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/pre-tool-use.mjs"')).toBe(true);
    expect(isWiseHook('node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/persistent-mode.mjs"')).toBe(true);
  });

  it('detects Windows-style WISE hook commands (issue #606)', () => {
    expect(isWiseHook('node "%USERPROFILE%\\.claude\\hooks\\keyword-detector.mjs"')).toBe(true);
    expect(isWiseHook('node "%USERPROFILE%\\.claude\\hooks\\pre-tool-use.mjs"')).toBe(true);
  });

  it('rejects non-WISE hooks correctly', () => {
    expect(isWiseHook('eslint --fix')).toBe(false);
    expect(isWiseHook('prettier --write')).toBe(false);
    expect(isWiseHook('node custom-hook.mjs')).toBe(false);
    expect(isWiseHook('node ~/other-plugin/hooks/detector.mjs')).toBe(false);
  });

  it('uses case-insensitive matching', () => {
    expect(isWiseHook('node ~/.claude/hooks/WISE-hook.mjs')).toBe(true);
    expect(isWiseHook('WISE-detector.sh')).toBe(true);
  });
});

describe('Safe Installer - Hook Conflict Detection', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_CLAUDE_DIR)) {
      rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_CLAUDE_DIR, { recursive: true });

    // Mock CLAUDE_CONFIG_DIR for testing
    process.env.TEST_CLAUDE_CONFIG_DIR = TEST_CLAUDE_DIR;
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_CLAUDE_DIR)) {
      rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
    }
    delete process.env.TEST_CLAUDE_CONFIG_DIR;
  });

  it('detects conflict when PreToolUse is owned by another plugin', () => {
    // Create settings.json with non-WISE hook
    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node ~/.claude/hooks/beads-hook.mjs'
              }
            ]
          }
        ]
      }
    };
    writeFileSync(TEST_SETTINGS_FILE, JSON.stringify(existingSettings, null, 2));

    const _options: InstallOptions = {
      verbose: true,
      skipClaudeCheck: true
    };

    // Simulate install logic (we'd need to mock or refactor install function for full test)
    // For now, test the detection logic directly
    const conflicts = detectConflicts(existingSettings.hooks);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].eventType).toBe('PreToolUse');
    expect(conflicts[0].existingCommand).toBe('node ~/.claude/hooks/beads-hook.mjs');
  });

  it('does not detect conflict when hook is WISE-owned', () => {
    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node "$HOME/.claude/hooks/pre-tool-use.mjs"'
              }
            ]
          }
        ]
      }
    };

    const conflicts = detectConflicts(existingSettings.hooks);

    expect(conflicts).toHaveLength(0);
  });

  it('detects multiple conflicts across different hook events', () => {
    const existingSettings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node ~/.claude/hooks/beads-pre-tool-use.mjs'
              }
            ]
          }
        ],
        PostToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: 'python ~/.claude/hooks/custom-post-tool.py'
              }
            ]
          }
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node "$HOME/.claude/hooks/keyword-detector.mjs"'
              }
            ]
          }
        ]
      }
    };

    const conflicts = detectConflicts(existingSettings.hooks);

    expect(conflicts).toHaveLength(2);
    expect(conflicts.map(c => c.eventType)).toContain('PreToolUse');
    expect(conflicts.map(c => c.eventType)).toContain('PostToolUse');
    expect(conflicts.map(c => c.eventType)).not.toContain('UserPromptSubmit');
  });
});
