import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(PROJECT_ROOT, ...segments), 'utf-8');
}

describe('Tier-0 contract docs consistency', () => {
  const referenceDoc = readProjectFile('docs', '参考.md');
  const claudeDoc = readProjectFile('docs', 'CLAUDE.md');

  it('keeps 参考 ToC counts aligned with section headings', () => {
    const tocAgents = referenceDoc.match(/\[智能体（共 (\d+) 个）\]\(#agents-\d+-total\)/);
    const headingAgents = referenceDoc.match(/^## 智能体（共 (\d+) 个）$/m);
    const tocSkills = referenceDoc.match(/\[技能（共 (\d+) 个）\]\(#skills-\d+-total\)/);
    const headingSkills = referenceDoc.match(/^## 技能（共 (\d+) 个）$/m);

    expect(tocAgents?.[1]).toBe(headingAgents?.[1]);
    expect(tocSkills?.[1]).toBe(headingSkills?.[1]);
  });

  it('documents all Tier-0 slash commands in 参考.md', () => {
    for (const skillName of ['autopilot', 'ultrawork', 'ralph', 'team', 'ralplan']) {
      expect(referenceDoc).toContain(`/wise:${skillName}`);
    }
  });

  it('documents all Tier-0 keywords in CLAUDE.md', () => {
    for (const keyword of ['autopilot', 'ultrawork', 'ralph', 'team', 'ralplan']) {
      expect(claudeDoc).toContain(`\`${keyword}\``);
    }
  });

  it('does not contain blank placeholder rows in core skill/command docs', () => {
    expect(referenceDoc).not.toContain('| `` |');
    expect(referenceDoc).not.toContain('/wise: <task>');
    expect(referenceDoc).not.toContain('incl. )');
  });

  it('keeps ralplan documented as a keyword trigger', () => {
    expect(claudeDoc).toContain('"ralplan"→ralplan');
  });

  it('keeps deprecated compatibility aliases documented for project session manager', () => {
    // swarm 别名已在 #1131 移除
    expect(referenceDoc).toContain('project-session-manager');
    expect(referenceDoc).toContain('**已弃用** `project-session-manager` 兼容别名');
  });

  it('does not document removed wrapper slash commands as installed skills', () => {
    expect(referenceDoc).not.toContain('/wise:analyze <target>');
    expect(referenceDoc).not.toContain('/wise:tdd <feature>');
  });

  it('documents team as explicit-only rather than an auto-triggered keyword', () => {
    expect(claudeDoc).toContain('团队编排通过 `/team` 显式触发。');
    expect(referenceDoc).not.toContain('| `team`, `coordinated team`');
  });

  it('keeps install and update guidance aligned on canonical setup entrypoints', () => {
    const localPluginDoc = readProjectFile('docs', '本地插件安装.md');

    expect(claudeDoc).toContain('说 "setup wise" 或运行 `/wise:wise-setup`。');
    expect(referenceDoc).toContain('/wise:setup');
    expect(localPluginDoc).toContain('/setup');
    expect(localPluginDoc).toContain('git worktree');
  });

  it('uses the published /docs/ path instead of the removed docs.html path in README links', () => {
    // omc→wise 重命名后，多语言 README 已精简为单一规范文档（README.zh.md）。
    // 动态发现实际存在的 README* 文件，使本契约随文档清理保持同步，
    // 而非硬编码会在文件被移除时漂移的列表。
    const readmes = readdirSync(PROJECT_ROOT)
      .filter((file) => file === 'README.md' || file.startsWith('README.'))
      .filter((file) => existsSync(join(PROJECT_ROOT, file)))
      .map((file) => readProjectFile(file));

    for (const content of readmes) {
      expect(content).not.toContain('https://wise-claw.github.io/wise-website/docs.html');
      expect(content).toContain('https://wise-claw.github.io/wise-website/docs/#');
    }
  });

  it('keeps root AGENTS.md aligned with WISE branding and state paths', () => {
    const agentsDoc = readProjectFile('AGENTS.md');

    expect(agentsDoc).toContain('# wise - Intelligent Multi-Agent Orchestration');
    expect(agentsDoc).toContain('You are running with wise (WISE), a multi-agent orchestration layer for Claude Code.');
    expect(agentsDoc).toContain('`.wise/state/`');
    expect(agentsDoc).toContain('Run `wise setup` to install all components. Run `wise doctor` to verify installation.');
    expect(agentsDoc).not.toContain('oh-my-codex');
    expect(agentsDoc).not.toContain('OMX_TEAM_WORKER_LAUNCH_ARGS');
    expect(agentsDoc).not.toContain('gpt-5.3-codex-spark');
  });

  it('keeps benchmark default model references aligned across docs and scripts', () => {
    const benchmarkReadme = readProjectFile('benchmark', 'README.md');
    const benchmarkRunner = readProjectFile('benchmark', 'run_benchmark.py');
    const quickTest = readProjectFile('benchmark', 'quick_test.sh');
    const vanilla = readProjectFile('benchmark', 'run_vanilla.sh');
    const wise = readProjectFile('benchmark', 'run_wise.sh');
    const fullComparison = readProjectFile('benchmark', 'run_full_comparison.sh');
    const resultsReadme = readProjectFile('benchmark', 'results', 'README.md');
    const expectedModel = 'claude-sonnet-4-6-20260217';

    for (const content of [benchmarkReadme, benchmarkRunner, quickTest, vanilla, wise, fullComparison, resultsReadme]) {
      expect(content).toContain(expectedModel);
    }

    expect(benchmarkReadme).not.toContain('claude-sonnet-4.5-20250929');
    expect(benchmarkRunner).not.toContain('claude-sonnet-4-20250514');
    expect(resultsReadme).toContain('Claude Sonnet 4.6');
  });

  it('removes dead package build aliases', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).not.toHaveProperty('build:codex');
    expect(packageJson.scripts).not.toHaveProperty('build:gemini');
  });
});
