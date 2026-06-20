import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(PROJECT_ROOT, ...segments), "utf-8");
}

describe("Claude Code /goal adapter docs contract", () => {
  const adapterDoc = readProjectFile(
    "docs",
    "design",
    "CLAUDE_CODE_GOAL_ADAPTER.md",
  );
  const referenceDoc = readProjectFile("docs", "参考.md");

  it("documents Claude/Anthropic as the only authority for Claude Code /goal facts", () => {
    expect(adapterDoc).toContain("https://code.claude.com/docs/en/goal");
    expect(adapterDoc).toContain(
      "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    );
    expect(adapterDoc).toContain(
      "它们并非 Claude Code `/goal` 事实的权威来源",
    );
  });

  it("documents the hidden-state non-mutation boundary", () => {
    expect(adapterDoc).toContain(
      "它不会变更隐藏的 Claude Code goal 状态",
    );
    expect(adapterDoc).toContain(
      "而非直接写入隐藏的 Claude Code 会话状态",
    );
    expect(referenceDoc).toContain(
      "不得直接变更隐藏 Claude Code 会话 state",
    );
  });

  it("locks deterministic loop conflict policy values and forbids warn-and-continue behavior", () => {
    for (const policy of ["`refuse`", "`adopt_existing`", "`artifact_only`"]) {
      expect(adapterDoc).toContain(policy);
    }

    expect(adapterDoc).toContain("绝不可与竞争循环“警告并继续”");
    expect(adapterDoc).toContain("任何未知策略均无效");
  });

  it("keeps evaluator success separate from WISE final completion", () => {
    expect(adapterDoc).toContain("`evaluator_passed` 不等于 `complete`");
    expect(adapterDoc).toContain(
      "直接的 `evaluator_passed -> complete` 转换无效",
    );
    expect(adapterDoc).toContain(
      "`/goal` 评估器判定的是浮现的会话证据",
    );
    expect(adapterDoc).not.toContain(
      "the evaluator independently reads files and runs commands",
    );
  });

  it("links the adapter design from 参考.md", () => {
    expect(referenceDoc).toContain(
      "[Claude Code `/goal` 适配器设计](#claude-code-goal-adapter-design)",
    );
    expect(referenceDoc).toContain("./design/CLAUDE_CODE_GOAL_ADAPTER.md");
  });
});
