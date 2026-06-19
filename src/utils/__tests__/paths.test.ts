import { describe, it, expect, afterEach } from 'vitest';
import {
  toForwardSlash,
  toShellPath,
  getDataDir,
  getConfigDir,
  getStateDir,
  getGlobalWiseConfigRoot,
  getGlobalWiseStateRoot,
  getGlobalWiseConfigPath,
  getGlobalWiseStatePath,
  getGlobalWiseConfigCandidates,
  getGlobalWiseStateCandidates,
  getLegacyWiseDir,
} from '../paths.js';

describe('cross-platform path utilities', () => {
  describe('toForwardSlash', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(toForwardSlash('C:\\Users\\test\\.claude')).toBe('C:/Users/test/.claude');
    });

    it('should leave forward slashes unchanged', () => {
      expect(toForwardSlash('/home/user/.claude')).toBe('/home/user/.claude');
    });

    it('should handle mixed slashes', () => {
      expect(toForwardSlash('C:\\Users/test\\.claude')).toBe('C:/Users/test/.claude');
    });

    it('should handle empty string', () => {
      expect(toForwardSlash('')).toBe('');
    });

    it('should handle UNC paths', () => {
      expect(toForwardSlash('\\\\server\\share\\path')).toBe('//server/share/path');
    });
  });

  describe('toShellPath', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(toShellPath('C:\\Users\\test')).toBe('C:/Users/test');
    });

    it('should quote paths with spaces', () => {
      expect(toShellPath('/path/with spaces/file')).toBe('"/path/with spaces/file"');
    });

    it('should quote Windows paths with spaces', () => {
      expect(toShellPath('C:\\Program Files\\app')).toBe('"C:/Program Files/app"');
    });

    it('should not quote paths without spaces', () => {
      expect(toShellPath('/simple/path')).toBe('/simple/path');
    });

    it('should handle empty string', () => {
      expect(toShellPath('')).toBe('');
    });
  });

  describe('getDataDir', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    it('should use LOCALAPPDATA on Windows when set', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local';
      expect(getDataDir()).toBe('C:\\Users\\Test\\AppData\\Local');
    });

    it('should use XDG_DATA_HOME on Unix when set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_DATA_HOME = '/custom/data';
      expect(getDataDir()).toBe('/custom/data');
    });

    it('should fall back to .local/share on Unix when XDG not set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.XDG_DATA_HOME;
      const result = getDataDir();
      expect(result).toContain('.local');
      expect(result).toContain('share');
    });
  });

  describe('getConfigDir', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    it('should use APPDATA on Windows when set', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
      expect(getConfigDir()).toBe('C:\\Users\\Test\\AppData\\Roaming');
    });

    it('should use XDG_CONFIG_HOME on Unix when set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_CONFIG_HOME = '/custom/config';
      expect(getConfigDir()).toBe('/custom/config');
    });

    it('should fall back to .config on Unix when XDG not set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.XDG_CONFIG_HOME;
      const result = getConfigDir();
      expect(result).toContain('.config');
    });
  });

  describe('getStateDir', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    it('should use LOCALAPPDATA on Windows when set', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local';
      expect(getStateDir()).toBe('C:\\Users\\Test\\AppData\\Local');
    });

    it('should use XDG_STATE_HOME on Unix when set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_STATE_HOME = '/custom/state';
      expect(getStateDir()).toBe('/custom/state');
    });

    it('should fall back to .local/state on Unix when XDG not set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.XDG_STATE_HOME;
      const result = getStateDir();
      expect(result).toContain('.local');
      expect(result).toContain('state');
    });
  });

  describe('global WISE path helpers', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    it('should use XDG config root for global WISE config on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_CONFIG_HOME = '/custom/config';
      delete process.env.WISE_HOME;

      expect(getGlobalWiseConfigRoot()).toBe('/custom/config/wise');
      expect(getGlobalWiseConfigPath('config.json')).toBe('/custom/config/wise/config.json');
    });

    it('should use XDG state root for global WISE state on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_STATE_HOME = '/custom/state';
      delete process.env.WISE_HOME;

      expect(getGlobalWiseStateRoot()).toBe('/custom/state/wise');
      expect(getGlobalWiseStatePath('daemon.json')).toBe('/custom/state/wise/daemon.json');
    });

    it('should keep WISE_HOME authoritative for config and state roots', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.WISE_HOME = '/override/wise';
      process.env.XDG_CONFIG_HOME = '/custom/config';
      process.env.XDG_STATE_HOME = '/custom/state';

      expect(getGlobalWiseConfigRoot()).toBe('/override/wise');
      expect(getGlobalWiseStateRoot()).toBe('/override/wise/state');
    });

    it('should keep explicit WISE_HOME state candidates backward compatible', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.WISE_HOME = '/override/wise';

      expect(getGlobalWiseStateCandidates('mcp-registry-state.json')).toEqual([
        '/override/wise/state/mcp-registry-state.json',
        '/override/wise/mcp-registry-state.json',
      ]);
    });

    it('should fall back to legacy ~/.wise root on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      delete process.env.WISE_HOME;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.XDG_STATE_HOME;

      expect(getGlobalWiseConfigRoot()).toBe(getLegacyWiseDir());
      expect(getGlobalWiseStateRoot()).toBe(`${getLegacyWiseDir()}/state`);
    });

    it('should include legacy fallback candidates for config and state paths', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_CONFIG_HOME = '/custom/config';
      process.env.XDG_STATE_HOME = '/custom/state';
      delete process.env.WISE_HOME;

      expect(getGlobalWiseConfigCandidates('config.json')).toEqual([
        '/custom/config/wise/config.json',
        `${getLegacyWiseDir()}/config.json`,
      ]);
      expect(getGlobalWiseStateCandidates('reply-session-registry.jsonl')).toEqual([
        '/custom/state/wise/reply-session-registry.jsonl',
        `${getLegacyWiseDir()}/state/reply-session-registry.jsonl`,
      ]);
    });
  });
});
