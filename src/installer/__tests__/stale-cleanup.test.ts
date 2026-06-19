/**
 * Stale WISE Agent/Skill Cleanup Tests
 *
 * Verifies that the installer removes stale WISE-created files from the config
 * directory while preserving user-created files.
 *
 * Contract: setup must clean up ~/.claude/agents and ~/.claude/skills that were
 * created by WISE in previous versions but are no longer shipped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test the exported cleanup functions directly
import { cleanupStaleAgents, cleanupStaleSkills, prunePluginDuplicateSkills, prunePluginDuplicateAgents } from '../index.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function createAgentFile(dir: string, filename: string, name: string): void {
  writeFileSync(join(dir, filename), `---\nname: ${name}\ndescription: Test agent\nmodel: claude-sonnet-4-6\n---\n\n# ${name}\nTest content.\n`);
}

function createSkillDir(dir: string, skillName: string, name: string): void {
  const skillDir = join(dir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\n\n# ${name}\nTest content.\n`);
}

function createUserFile(dir: string, filename: string): void {
  // User-created file without WISE frontmatter
  writeFileSync(join(dir, filename), `# My Custom Agent\n\nThis is a user-created agent definition.\n`);
}

function createUserSkillDir(dir: string, skillName: string): void {
  const skillDir = join(dir, skillName);
  mkdirSync(skillDir, { recursive: true });
  // No frontmatter — just user prose
  writeFileSync(join(skillDir, 'SKILL.md'), `# My Custom Skill\n\nThis is a user-created skill.\n`);
}

function createManagedSkillMarker(dir: string, skillName: string): void {
  writeFileSync(join(dir, skillName, '.wise-managed'), 'wise-managed\n');
}

// ── Stale Agent Cleanup ──────────────────────────────────────────────────────

describe('cleanupStaleAgents', () => {
  let tempDir: string;
  let originalConfigDir: string | undefined;
  const log = vi.fn();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wise-stale-agents-'));
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    log.mockClear();
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes agent files that have WISE frontmatter but are no longer in the package', async () => {
    // Re-import with fresh CLAUDE_CONFIG_DIR
    vi.resetModules();
    const { cleanupStaleAgents: cleanup, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });

    // Create a fake "stale" agent that looks like WISE-created but isn't in current package
    createAgentFile(agentsDir, 'removed-agent.md', 'removed-agent');

    const removed = cleanup(log);

    expect(removed).toContain('removed-agent.md');
    expect(existsSync(join(agentsDir, 'removed-agent.md'))).toBe(false);
  });

  it('preserves agent files that are in the current package', async () => {
    vi.resetModules();
    const { cleanupStaleAgents: cleanup, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });

    // Create an agent that matches a real current agent name (architect)
    createAgentFile(agentsDir, 'architect.md', 'architect');

    const removed = cleanup(log);

    expect(removed).not.toContain('architect.md');
    expect(existsSync(join(agentsDir, 'architect.md'))).toBe(true);
  });

  it('preserves user-created files without WISE frontmatter', async () => {
    vi.resetModules();
    const { cleanupStaleAgents: cleanup, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });

    // User-created file with no frontmatter
    createUserFile(agentsDir, 'my-custom-agent.md');

    const removed = cleanup(log);

    expect(removed).not.toContain('my-custom-agent.md');
    expect(existsSync(join(agentsDir, 'my-custom-agent.md'))).toBe(true);
  });

  it('preserves AGENTS.md even though it is not a current agent definition', async () => {
    vi.resetModules();
    const { cleanupStaleAgents: cleanup, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'AGENTS.md'), '# Agent Catalog\nDocumentation file.\n');

    const removed = cleanup(log);

    expect(removed).not.toContain('AGENTS.md');
    expect(existsSync(join(agentsDir, 'AGENTS.md'))).toBe(true);
  });

  it('returns empty array when agents directory does not exist', () => {
    const removed = cleanupStaleAgents(log);
    // No agents dir at the temp path — should not error
    expect(removed).toEqual([]);
  });
});

// ── Stale Skill Cleanup ──────────────────────────────────────────────────────

describe('cleanupStaleSkills', () => {
  let tempDir: string;
  let originalConfigDir: string | undefined;
  const log = vi.fn();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wise-stale-skills-'));
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    log.mockClear();
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes stale skills only when WISE ownership is explicitly marked', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    createSkillDir(skillsDir, 'removed-skill', 'removed-skill');
    createManagedSkillMarker(skillsDir, 'removed-skill');

    const removed = cleanup(log);

    expect(removed).toContain('removed-skill');
    expect(existsSync(join(skillsDir, 'removed-skill'))).toBe(false);
  });

  it('preserves skill directories that are in the current package', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    // Create a skill that matches a real current skill name (ralph)
    createSkillDir(skillsDir, 'ralph', 'ralph');

    const removed = cleanup(log);

    expect(removed).not.toContain('ralph');
    expect(existsSync(join(skillsDir, 'ralph'))).toBe(true);
  });

  it('preserves user-created skill directories without WISE frontmatter', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    createUserSkillDir(skillsDir, 'my-custom-skill');

    const removed = cleanup(log);

    expect(removed).not.toContain('my-custom-skill');
    expect(existsSync(join(skillsDir, 'my-custom-skill'))).toBe(true);
  });

  it('preserves third-party skills with standard frontmatter when no WISE marker is present', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });
    createSkillDir(skillsDir, 'gstack', 'gstack');

    const removed = cleanup(log);

    expect(removed).not.toContain('gstack');
    expect(existsSync(join(skillsDir, 'gstack'))).toBe(true);
  });

  it('preserves symlinked skill directories without an WISE marker', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    const externalRoot = mkdtempSync(join(tmpdir(), 'wise-third-party-skill-'));
    const externalSkillDir = join(externalRoot, 'linked-skill');
    mkdirSync(externalSkillDir, { recursive: true });
    writeFileSync(join(externalSkillDir, 'SKILL.md'), '---\nname: linked-skill\ndescription: external\n---\n\n# linked-skill\n');
    symlinkSync(externalSkillDir, join(skillsDir, 'linked-skill'), 'dir');

    try {
      const removed = cleanup(log);
      expect(removed).not.toContain('linked-skill');
      expect(existsSync(join(skillsDir, 'linked-skill'))).toBe(true);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it('preserves wise-learned directory (user-created skills)', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    // wise-learned is the user skills directory — must never be removed
    createSkillDir(skillsDir, 'wise-learned', 'wise-learned');

    const removed = cleanup(log);

    expect(removed).not.toContain('wise-learned');
    expect(existsSync(join(skillsDir, 'wise-learned'))).toBe(true);
  });

  it('returns empty array when skills directory does not exist', () => {
    const removed = cleanupStaleSkills(log);
    expect(removed).toEqual([]);
  });

  it('does not remove directories without SKILL.md', async () => {
    vi.resetModules();
    const { cleanupStaleSkills: cleanup, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    // Directory with no SKILL.md — not a skill, should be left alone
    const randomDir = join(skillsDir, 'random-directory');
    mkdirSync(randomDir, { recursive: true });
    writeFileSync(join(randomDir, 'notes.txt'), 'some notes');

    const removed = cleanup(log);

    expect(removed).not.toContain('random-directory');
    expect(existsSync(randomDir)).toBe(true);
  });
});

// ── Plugin Duplicate Skill Pruning (#2252) ──────────────────────────────────

describe('prunePluginDuplicateSkills', () => {
  let tempDir: string;
  let originalConfigDir: string | undefined;
  const log = vi.fn();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wise-prune-dupes-'));
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    log.mockClear();
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes standalone skills that match plugin-provided skills when marked as WISE-owned', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    // Create a standalone copy of 'ralph' (which the plugin also provides)
    // and mark it as WISE-owned — this is what a prior `wise setup` would have done
    createSkillDir(skillsDir, 'ralph', 'ralph');
    createManagedSkillMarker(skillsDir, 'ralph');

    const removed = prune(log);

    expect(removed).toContain('ralph');
    expect(existsSync(join(skillsDir, 'ralph'))).toBe(false);
  });

  it('preserves user-authored skills without WISE frontmatter even if name matches', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    // User-created skill with a name that collides with plugin skill but no WISE frontmatter
    createUserSkillDir(skillsDir, 'ralph');

    const removed = prune(log);

    expect(removed).not.toContain('ralph');
    expect(existsSync(join(skillsDir, 'ralph'))).toBe(true);
  });

  it('preserves user skills with standard frontmatter that have different content from plugin version (issue #2573)', async () => {
    // Regression: the old `isWiseCreated` heuristic treated any skill with
    // `---\nname:` frontmatter as WISE-owned and deleted it during update,
    // even when the content differed from the plugin's copy.
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    // User's custom version of 'ralph' — standard frontmatter, but unique body
    const customSkillDir = join(skillsDir, 'ralph');
    mkdirSync(customSkillDir, { recursive: true });
    writeFileSync(
      join(customSkillDir, 'SKILL.md'),
      '---\nname: ralph\ndescription: My custom ralph workflow\n---\n\n# My Custom Ralph\nThis is my personalized version.\n',
    );
    // No .wise-managed marker — this is user-owned

    const removed = prune(log);

    expect(removed).not.toContain('ralph');
    expect(existsSync(join(skillsDir, 'ralph'))).toBe(true);
  });

  it('removes exact-match standalone alias duplicates like wise-plan while preserving alias lookup behavior', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    const packagePlanSkill = readFileSync(join(process.cwd(), 'skills', 'plan', 'SKILL.md'), 'utf-8');
    const aliasSkillDir = join(skillsDir, 'wise-plan');
    mkdirSync(aliasSkillDir, { recursive: true });
    writeFileSync(join(aliasSkillDir, 'SKILL.md'), packagePlanSkill);

    const removed = prune(log);

    expect(removed).toContain('wise-plan');
    expect(existsSync(aliasSkillDir)).toBe(false);
  });

  it('preserves user-authored standalone alias skills like wise-plan when content differs from plugin copy', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });

    const aliasSkillDir = join(skillsDir, 'wise-plan');
    mkdirSync(aliasSkillDir, { recursive: true });
    writeFileSync(
      join(aliasSkillDir, 'SKILL.md'),
      '---\nname: plan\ndescription: My custom alias skill\n---\n\n# Custom wise-plan\nUser-authored content.\n',
    );

    const removed = prune(log);

    expect(removed).not.toContain('wise-plan');
    expect(existsSync(aliasSkillDir)).toBe(true);
  });

  it('preserves wise-learned directory', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });
    createSkillDir(skillsDir, 'wise-learned', 'wise-learned');

    const removed = prune(log);

    expect(removed).not.toContain('wise-learned');
    expect(existsSync(join(skillsDir, 'wise-learned'))).toBe(true);
  });

  it('does not remove skills whose name does not match any plugin skill', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });
    createSkillDir(skillsDir, 'my-private-skill', 'my-private-skill');

    const removed = prune(log);

    expect(removed).not.toContain('my-private-skill');
    expect(existsSync(join(skillsDir, 'my-private-skill'))).toBe(true);
  });

  it('returns empty when skills directory does not exist', () => {
    const removed = prunePluginDuplicateSkills(log);
    expect(removed).toEqual([]);
  });

  it('is idempotent — second run is a no-op', async () => {
    vi.resetModules();
    const { prunePluginDuplicateSkills: prune, SKILLS_DIR: skillsDir } = await import('../index.js');

    mkdirSync(skillsDir, { recursive: true });
    createSkillDir(skillsDir, 'ralph', 'ralph');
    createManagedSkillMarker(skillsDir, 'ralph');

    const first = prune(log);
    expect(first).toContain('ralph');

    const second = prune(log);
    expect(second).toEqual([]);
  });
});

// ── Plugin Duplicate Agent Pruning (#2252) ──────────────────────────────────

describe('prunePluginDuplicateAgents', () => {
  let tempDir: string;
  let originalConfigDir: string | undefined;
  const log = vi.fn();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wise-prune-agent-dupes-'));
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    log.mockClear();
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes standalone agents that match plugin-provided agents', async () => {
    vi.resetModules();
    const { prunePluginDuplicateAgents: prune, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });
    createAgentFile(agentsDir, 'architect.md', 'architect');

    const removed = prune(log);

    expect(removed).toContain('architect.md');
    expect(existsSync(join(agentsDir, 'architect.md'))).toBe(false);
  });

  it('preserves user-created agents without WISE frontmatter', async () => {
    vi.resetModules();
    const { prunePluginDuplicateAgents: prune, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });
    createUserFile(agentsDir, 'architect.md');

    const removed = prune(log);

    expect(removed).not.toContain('architect.md');
    expect(existsSync(join(agentsDir, 'architect.md'))).toBe(true);
  });

  it('does not remove agents not in the current package', async () => {
    vi.resetModules();
    const { prunePluginDuplicateAgents: prune, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });
    createAgentFile(agentsDir, 'my-custom-agent.md', 'my-custom-agent');

    const removed = prune(log);

    expect(removed).not.toContain('my-custom-agent.md');
    expect(existsSync(join(agentsDir, 'my-custom-agent.md'))).toBe(true);
  });

  it('preserves AGENTS.md documentation file', async () => {
    vi.resetModules();
    const { prunePluginDuplicateAgents: prune, AGENTS_DIR: agentsDir } = await import('../index.js');

    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'AGENTS.md'), '# Agent Catalog\nDocumentation.\n');

    const removed = prune(log);

    expect(removed).not.toContain('AGENTS.md');
    expect(existsSync(join(agentsDir, 'AGENTS.md'))).toBe(true);
  });

  it('returns empty when agents directory does not exist', () => {
    const removed = prunePluginDuplicateAgents(log);
    expect(removed).toEqual([]);
  });
});
