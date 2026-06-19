import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'path';
import { validateToolPath } from '../tools/ast-tools.js';
import { clearSecurityConfigCache } from '../lib/security-config.js';

describe('validateToolPath', () => {
  const originalSecurity = process.env.WISE_SECURITY;

  afterEach(() => {
    if (originalSecurity === undefined) {
      delete process.env.WISE_SECURITY;
    } else {
      process.env.WISE_SECURITY = originalSecurity;
    }
    clearSecurityConfigCache();
    vi.restoreAllMocks();
  });

  describe('when WISE_SECURITY is not set (default)', () => {
    beforeEach(() => {
      delete process.env.WISE_SECURITY;
      clearSecurityConfigCache();
    });

    it('allows any path without restriction', () => {
      const result = validateToolPath('/etc/passwd');
      expect(result).toBe(resolve('/etc/passwd'));
    });

    it('allows relative paths', () => {
      const result = validateToolPath('.');
      expect(result).toBe(resolve('.'));
    });
  });

  describe('when WISE_SECURITY=strict', () => {
    beforeEach(() => {
      process.env.WISE_SECURITY = 'strict';
      clearSecurityConfigCache();
    });

    it('allows paths within project root', () => {
      const result = validateToolPath('.');
      expect(result).toBe(resolve('.'));
    });

    it('allows subdirectory paths', () => {
      const result = validateToolPath('src');
      expect(result).toBe(resolve('src'));
    });

    it('rejects absolute paths outside project root', () => {
      expect(() => validateToolPath('/etc/passwd')).toThrow('Path restricted');
    });

    it('rejects paths that traverse above project root', () => {
      expect(() => validateToolPath('../../.ssh/id_rsa')).toThrow('Path restricted');
    });

    it('rejects home directory paths', () => {
      expect(() => validateToolPath('/Users/someone/.ssh')).toThrow('Path restricted');
    });

    it('includes helpful message in error', () => {
      expect(() => validateToolPath('/etc')).toThrow('WISE_SECURITY');
    });
  });
});
