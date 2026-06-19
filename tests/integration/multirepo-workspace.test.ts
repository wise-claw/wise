/**
 * Integration tests for multi-repo workspace anchor behaviour (Wave 4).
 *
 * Verifies getWiseRoot, getProjectIdentifier, resolveSessionStatePaths,
 * findWorkspaceRoot, and WISE_STATE_DIR precedence across sibling sub-repos
 * that share a .wise-workspace marker at a common parent directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getWiseRoot,
  getProjectIdentifier,
  resolveSessionStatePaths,
  findWorkspaceRoot,
  clearWorktreeCache,
} from '../../src/lib/worktree-paths.js';

describe('multi-repo workspace anchor', () => {
  let parent: string;
  let repoA: string;
  let repoB: string;
  const savedWISE_STATE_DIR = process.env.WISE_STATE_DIR;

  beforeEach(() => {
    clearWorktreeCache();
    // Fresh temp parent dir per test — no .git, no .wise-workspace yet
    parent = mkdtempSync(join(tmpdir(), 'wise-multirepo-'));
    repoA = join(parent, 'repoA');
    repoB = join(parent, 'repoB');
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });
  });

  afterEach(() => {
    clearWorktreeCache();
    // Restore WISE_STATE_DIR
    if (savedWISE_STATE_DIR === undefined) {
      delete process.env.WISE_STATE_DIR;
    } else {
      process.env.WISE_STATE_DIR = savedWISE_STATE_DIR;
    }
    if (parent) rmSync(parent, { recursive: true, force: true });
  });

  it('sibling sub-repos both resolve .wise root to the parent workspace anchor', () => {
    writeFileSync(join(parent, '.wise-workspace'), '{}');
    clearWorktreeCache();

    const rootA = getWiseRoot(repoA);
    const rootB = getWiseRoot(repoB);
    const expected = join(parent, '.wise');

    expect(rootA).toBe(expected);
    expect(rootB).toBe(expected);
  });

  it('sibling sub-repos share the same project identifier', () => {
    writeFileSync(join(parent, '.wise-workspace'), '{}');
    clearWorktreeCache();

    const idA = getProjectIdentifier(repoA);
    const idB = getProjectIdentifier(repoB);

    expect(idA).toBe(idB);
    // Identifier starts with the parent basename (sanitized)
    const parentBase = basename(parent).replace(/[^a-zA-Z0-9_-]/g, '_');
    expect(idA.startsWith(parentBase)).toBe(true);
  });

  it('marker with {"id":"myws"} derives project identifier from sanitized id', () => {
    writeFileSync(join(parent, '.wise-workspace'), JSON.stringify({ id: 'myws' }));
    clearWorktreeCache();

    const id = getProjectIdentifier(repoA);
    expect(id.startsWith('myws')).toBe(true);
    // Must not contain the plain basename when an explicit id overrides it
    const parentBase = basename(parent).replace(/[^a-zA-Z0-9_-]/g, '_');
    // The id should derive from 'myws', not parentBase
    expect(id).not.toMatch(new RegExp(`^${parentBase}`));
  });

  it('session state paths for two sessions under the same workspace are isolated', () => {
    writeFileSync(join(parent, '.wise-workspace'), '{}');
    clearWorktreeCache();

    const pathsA = resolveSessionStatePaths('ralph', 'sessA', repoA);
    const pathsB = resolveSessionStatePaths('ralph', 'sessB', repoA);

    // Write paths must differ
    expect(pathsA.effectiveWrite).not.toBe(pathsB.effectiveWrite);

    // Both write paths must live under the shared workspace .wise/state/sessions/
    const sessionsRoot = join(parent, '.wise', 'state', 'sessions');
    expect(pathsA.effectiveWrite.startsWith(sessionsRoot)).toBe(true);
    expect(pathsB.effectiveWrite.startsWith(sessionsRoot)).toBe(true);
  });

  it('WISE_STATE_DIR overrides workspace marker and ignores .wise-workspace', () => {
    writeFileSync(join(parent, '.wise-workspace'), '{}');
    clearWorktreeCache();

    const stateDir = mkdtempSync(join(tmpdir(), 'wise-statedir-'));
    try {
      process.env.WISE_STATE_DIR = stateDir;
      clearWorktreeCache();

      const root = getWiseRoot(repoA);

      // Must resolve under WISE_STATE_DIR, not under the workspace marker parent
      expect(root.startsWith(stateDir)).toBe(true);
      expect(root.startsWith(parent)).toBe(false);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('findWorkspaceRoot walks up from a sub-repo and finds the parent marker', () => {
    writeFileSync(join(parent, '.wise-workspace'), '{}');
    clearWorktreeCache();

    const wsRoot = findWorkspaceRoot(repoA);
    expect(wsRoot).toBe(parent);
  });

  it('findWorkspaceRoot returns null when there is no marker', () => {
    // No marker written — parent is a plain directory
    clearWorktreeCache();

    const wsRoot = findWorkspaceRoot(repoA);
    expect(wsRoot).toBeNull();
  });
});
