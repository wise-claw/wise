import { describe, it, expect } from 'vitest';
import { wiseToolsServer, wiseToolNames, getWiseToolNames } from '../mcp/wise-tools-server.js';

const interopEnabled = process.env.WISE_INTEROP_TOOLS_ENABLED === '1';
const totalTools = interopEnabled ? 57 : 49;
const withoutLsp = interopEnabled ? 45 : 37;
const withoutAst = interopEnabled ? 55 : 47;
const withoutPython = interopEnabled ? 56 : 48;
const withoutSkills = interopEnabled ? 54 : 46;

describe('wise-tools-server', () => {
  describe('wiseToolNames', () => {
    it('should export expected tools total', () => {
      expect(wiseToolNames).toHaveLength(totalTools);
    });

    it('should have 12 LSP tools', () => {
      const lspTools = wiseToolNames.filter(n => n.includes('lsp_'));
      expect(lspTools).toHaveLength(12);
    });

    it('should have 2 AST tools', () => {
      const astTools = wiseToolNames.filter(n => n.includes('ast_'));
      expect(astTools).toHaveLength(2);
    });

    it('should have python_repl tool', () => {
      expect(wiseToolNames).toContain('mcp__t__python_repl');
    });

    it('should have session_search tool', () => {
      expect(wiseToolNames).toContain('mcp__t__session_search');
    });

    it('should use correct MCP naming format', () => {
      wiseToolNames.forEach(name => {
        expect(name).toMatch(/^mcp__t__/);
      });
    });
  });

  describe('getWiseToolNames', () => {
    it('should return all tools by default', () => {
      const tools = getWiseToolNames();
      expect(tools).toHaveLength(totalTools);
    });

    it('should filter out LSP tools when includeLsp is false', () => {
      const tools = getWiseToolNames({ includeLsp: false });
      expect(tools.some(t => t.includes('lsp_'))).toBe(false);
      expect(tools).toHaveLength(withoutLsp);
    });

    it('should filter out AST tools when includeAst is false', () => {
      const tools = getWiseToolNames({ includeAst: false });
      expect(tools.some(t => t.includes('ast_'))).toBe(false);
      expect(tools).toHaveLength(withoutAst);
    });

    it('should filter out python_repl when includePython is false', () => {
      const tools = getWiseToolNames({ includePython: false });
      expect(tools.some(t => t.includes('python_repl'))).toBe(false);
      expect(tools).toHaveLength(withoutPython);
    });

    it('should filter out skills tools', () => {
      const names = getWiseToolNames({ includeSkills: false });
      expect(names).toHaveLength(withoutSkills);
      expect(names.every(n => !n.includes('load_wise_skills') && !n.includes('list_wise_skills'))).toBe(true);
    });

    it('should have 3 skills tools', () => {
      const skillsTools = wiseToolNames.filter(n => n.includes('load_wise_skills') || n.includes('list_wise_skills'));
      expect(skillsTools).toHaveLength(3);
    });

    it('supports includeInterop filter option', () => {
      const withInterop = getWiseToolNames({ includeInterop: true });
      const withoutInterop = getWiseToolNames({ includeInterop: false });

      if (interopEnabled) {
        expect(withInterop.some(n => n.includes('interop_'))).toBe(true);
      }
      expect(withoutInterop.some(n => n.includes('interop_'))).toBe(false);
    });
  });

  describe('wiseToolsServer', () => {
    it('should be defined', () => {
      expect(wiseToolsServer).toBeDefined();
    });
  });
});
