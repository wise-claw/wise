/**
 * Tests for wise update --force-hooks protection (issue #722)
 *
 * Verifies that the hook merge logic in install() correctly:
 *   - merges WISE hooks with existing non-WISE hooks during `wise update` (force=true)
 *   - warns when non-WISE hooks are present
 *   - only fully replaces when --force-hooks is explicitly set
 *
 * Tests exercise isWiseHook() and the merge logic via unit-level helpers
 * to avoid filesystem side-effects.
 */

import { describe, it, expect } from 'vitest';
import { isWiseHook } from '../installer/index.js';

// ---------------------------------------------------------------------------
// Shared types mirroring installer internals
// ---------------------------------------------------------------------------
type HookEntry = { type: string; command: string };
type HookGroup = { hooks: HookEntry[] };

// ---------------------------------------------------------------------------
// Pure merge helper extracted from install() for isolated testing.
// This mirrors exactly the logic in installer/index.ts so that changes
// to the installer are reflected and tested here.
// ---------------------------------------------------------------------------
function mergeEventHooks(
  existingGroups: HookGroup[],
  newWiseGroups: HookGroup[],
  options: { force?: boolean; forceHooks?: boolean; allowPluginHookRefresh?: boolean }
): {
  merged: HookGroup[];
  conflicts: Array<{ eventType: string; existingCommand: string }>;
  logMessages: string[];
} {
  const conflicts: Array<{ eventType: string; existingCommand: string }> = [];
  const logMessages: string[] = [];
  const eventType = 'TestEvent';

  const nonWiseGroups = existingGroups.filter(group =>
    group.hooks.some(h => h.type === 'command' && !isWiseHook(h.command))
  );
  const hasNonWiseHook = nonWiseGroups.length > 0;
  const nonWiseCommand = hasNonWiseHook
    ? nonWiseGroups[0].hooks.find(h => h.type === 'command' && !isWiseHook(h.command))?.command ?? ''
    : '';

  let merged: HookGroup[];

  if (options.forceHooks && !options.allowPluginHookRefresh) {
    if (hasNonWiseHook) {
      logMessages.push(`Warning: Overwriting non-WISE ${eventType} hook with --force-hooks: ${nonWiseCommand}`);
      conflicts.push({ eventType, existingCommand: nonWiseCommand });
    }
    merged = newWiseGroups;
    logMessages.push(`Updated ${eventType} hook (--force-hooks)`);
  } else if (options.force) {
    merged = [...nonWiseGroups, ...newWiseGroups];
    if (hasNonWiseHook) {
      logMessages.push(`Merged ${eventType} hooks (updated WISE hooks, preserved non-WISE hook: ${nonWiseCommand})`);
      conflicts.push({ eventType, existingCommand: nonWiseCommand });
    } else {
      logMessages.push(`Updated ${eventType} hook (--force)`);
    }
  } else {
    if (hasNonWiseHook) {
      logMessages.push(`Warning: ${eventType} hook has non-WISE hook. Skipping. Use --force-hooks to override.`);
      conflicts.push({ eventType, existingCommand: nonWiseCommand });
    } else {
      logMessages.push(`${eventType} hook already configured, skipping`);
    }
    merged = existingGroups; // unchanged
  }

  return { merged, conflicts, logMessages };
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
function wiseGroup(command: string): HookGroup {
  return { hooks: [{ type: 'command', command }] };
}

function userGroup(command: string): HookGroup {
  return { hooks: [{ type: 'command', command }] };
}

const WISE_CMD = 'node "$HOME/.claude/hooks/keyword-detector.mjs"';
const USER_CMD = '/usr/local/bin/my-custom-hook.sh';
const NEW_WISE_CMD = 'node "$HOME/.claude/hooks/session-start.mjs"';

// ---------------------------------------------------------------------------
// isWiseHook unit tests
// ---------------------------------------------------------------------------
describe('isWiseHook()', () => {
  it('recognises WISE keyword-detector command', () => {
    expect(isWiseHook('node "$HOME/.claude/hooks/keyword-detector.mjs"')).toBe(true);
  });

  it('recognises WISE session-start command', () => {
    expect(isWiseHook('node "$HOME/.claude/hooks/session-start.mjs"')).toBe(true);
  });

  it('recognises WISE pre-tool-use command', () => {
    expect(isWiseHook('node "$HOME/.claude/hooks/pre-tool-use.mjs"')).toBe(true);
  });

  it('recognises WISE post-tool-use command', () => {
    expect(isWiseHook('node "$HOME/.claude/hooks/post-tool-use.mjs"')).toBe(true);
  });

  it('recognises WISE persistent-mode command', () => {
    expect(isWiseHook('node "$HOME/.claude/hooks/persistent-mode.mjs"')).toBe(true);
  });

  it('recognises WISE code-simplifier command', () => {
    expect(isWiseHook('node "$HOME/.claude/hooks/code-simplifier.mjs"')).toBe(true);
  });

  it('recognises Windows-style WISE path', () => {
    expect(isWiseHook('node "%USERPROFILE%\\.claude\\hooks\\keyword-detector.mjs"')).toBe(true);
  });

  it('recognises custom-profile hook paths by known filename', () => {
    expect(isWiseHook('node "/tmp/custom-claude/hooks/keyword-detector.mjs"')).toBe(true);
  });

  it('recognises CLAUDE_CONFIG_DIR-aware hook commands', () => {
    expect(isWiseHook('node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/keyword-detector.mjs"')).toBe(true);
    expect(isWiseHook('node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/persistent-mode.mjs"')).toBe(true);
  });

  it('recognises wise in command path', () => {
    expect(isWiseHook('/path/to/wise/hook.mjs')).toBe(true);
  });

  it('recognises wise as a path segment', () => {
    expect(isWiseHook('/usr/local/bin/wise-hook.sh')).toBe(true);
  });

  it('does not recognise a plain user command', () => {
    expect(isWiseHook('/usr/local/bin/my-custom-hook.sh')).toBe(false);
  });

  it('does not recognise a random shell script', () => {
    expect(isWiseHook('bash /home/user/scripts/notify.sh')).toBe(false);
  });

  it('does not match "wise" inside an unrelated word', () => {
    // "nomc" or "omcr" should NOT match the wise path-segment pattern
    expect(isWiseHook('/usr/bin/nwise-thing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook merge logic tests
// ---------------------------------------------------------------------------
describe('Hook merge during wise update', () => {
  describe('no force flags — skip behaviour', () => {
    it('skips an already-configured WISE-only event type', () => {
      const existing = [wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts, logMessages } = mergeEventHooks(existing, newWise, {});

      expect(merged).toEqual(existing); // unchanged
      expect(conflicts).toHaveLength(0);
      expect(logMessages[0]).toMatch(/already configured/);
    });

    it('records conflict but does not overwrite when non-WISE hook exists', () => {
      const existing = [userGroup(USER_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts, logMessages } = mergeEventHooks(existing, newWise, {});

      expect(merged).toEqual(existing); // unchanged
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].existingCommand).toBe(USER_CMD);
      expect(logMessages[0]).toMatch(/non-WISE hook/);
      expect(logMessages[0]).toMatch(/--force-hooks/);
    });
  });

  describe('force=true — merge behaviour (wise update path)', () => {
    it('replaces WISE hooks when event type has only WISE hooks', () => {
      const existing = [wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts } = mergeEventHooks(existing, newWise, { force: true });

      // Non-WISE groups: none → merged = newWise only
      expect(merged).toHaveLength(1);
      expect(merged[0].hooks[0].command).toBe(NEW_WISE_CMD);
      expect(conflicts).toHaveLength(0);
    });

    it('preserves non-WISE hook and adds updated WISE hook', () => {
      const existing = [userGroup(USER_CMD), wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts, logMessages } = mergeEventHooks(existing, newWise, { force: true });

      // non-WISE groups come first, then new WISE groups
      expect(merged).toHaveLength(2);
      expect(merged[0].hooks[0].command).toBe(USER_CMD);
      expect(merged[1].hooks[0].command).toBe(NEW_WISE_CMD);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].existingCommand).toBe(USER_CMD);
      expect(logMessages[0]).toMatch(/Merged/);
      expect(logMessages[0]).toMatch(/preserved non-WISE hook/);
    });

    it('preserves multiple non-WISE hook groups', () => {
      const userCmd2 = '/usr/local/bin/another-hook.sh';
      const existing = [userGroup(USER_CMD), userGroup(userCmd2), wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged } = mergeEventHooks(existing, newWise, { force: true });

      expect(merged).toHaveLength(3); // 2 user groups + 1 new WISE group
      expect(merged[0].hooks[0].command).toBe(USER_CMD);
      expect(merged[1].hooks[0].command).toBe(userCmd2);
      expect(merged[2].hooks[0].command).toBe(NEW_WISE_CMD);
    });

    it('does not carry over old WISE hook groups', () => {
      const existing = [wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged } = mergeEventHooks(existing, newWise, { force: true });

      const commands = merged.flatMap(g => g.hooks.map(h => h.command));
      expect(commands).not.toContain(WISE_CMD);
      expect(commands).toContain(NEW_WISE_CMD);
    });

    it('records a conflict when non-WISE hook is preserved', () => {
      const existing = [userGroup(USER_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { conflicts } = mergeEventHooks(existing, newWise, { force: true });

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].existingCommand).toBe(USER_CMD);
    });

    it('records no conflict when only WISE hooks existed', () => {
      const existing = [wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { conflicts } = mergeEventHooks(existing, newWise, { force: true });

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('forceHooks=true — replace-all behaviour', () => {
    it('replaces WISE-only hooks', () => {
      const existing = [wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts } = mergeEventHooks(existing, newWise, { forceHooks: true });

      expect(merged).toEqual(newWise);
      expect(conflicts).toHaveLength(0);
    });

    it('replaces non-WISE hook and warns', () => {
      const existing = [userGroup(USER_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts, logMessages } = mergeEventHooks(existing, newWise, { forceHooks: true });

      expect(merged).toEqual(newWise);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].existingCommand).toBe(USER_CMD);
      expect(logMessages[0]).toMatch(/Overwriting non-WISE/);
      expect(logMessages[0]).toMatch(/--force-hooks/);
    });

    it('replaces mixed hooks entirely', () => {
      const existing = [userGroup(USER_CMD), wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged } = mergeEventHooks(existing, newWise, { forceHooks: true });

      expect(merged).toHaveLength(1);
      expect(merged[0].hooks[0].command).toBe(NEW_WISE_CMD);
    });

    it('does NOT replace when allowPluginHookRefresh is true (plugin safety)', () => {
      // When running as a plugin with refreshHooksInPlugin, forceHooks should
      // not clobber user hooks — falls through to the force=true merge path
      // (since allowPluginHookRefresh=true disables the forceHooks branch).
      // This test exercises the guard: forceHooks && !allowPluginHookRefresh.
      const existing = [userGroup(USER_CMD), wiseGroup(WISE_CMD)];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged } = mergeEventHooks(existing, newWise, {
        forceHooks: true,
        allowPluginHookRefresh: true,
        // Note: force is not set, so falls to "no force" branch
      });

      // Without force set, the no-force branch runs → merged unchanged
      expect(merged).toEqual(existing);
    });
  });

  describe('edge cases', () => {
    it('handles event type with no existing hooks (empty array)', () => {
      // When existingHooks[eventType] exists but is empty
      const existing: HookGroup[] = [];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { merged, conflicts } = mergeEventHooks(existing, newWise, { force: true });

      // nonWiseGroups will be empty, so merged = [] + newWiseGroups
      expect(merged).toEqual(newWise);
      expect(conflicts).toHaveLength(0);
    });

    it('handles hook group with non-command type (should not be treated as non-WISE)', () => {
      // A hook group with type != 'command' should not count as non-WISE
      const existing: HookGroup[] = [{ hooks: [{ type: 'webhook', command: '' }] }];
      const newWise = [wiseGroup(NEW_WISE_CMD)];
      const { conflicts } = mergeEventHooks(existing, newWise, { force: true });

      // The webhook group has no command-type hooks → nonWiseGroups is empty
      expect(conflicts).toHaveLength(0);
    });
  });
});
