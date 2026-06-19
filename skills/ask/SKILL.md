---
name: ask
description: Process-first advisor routing for Claude, Codex, Gemini, Grok, or Cursor via `wise ask`, with artifact capture and no raw CLI assembly
---

# Ask

Use WISE's canonical advisor skill to route a prompt through the local Claude, Codex, Gemini, Grok, or Cursor CLI and persist the result as an ask artifact.

## Usage

```bash
/wise:ask <claude|codex|gemini|grok|cursor> <question or task>
```

Examples:

```bash
/wise:ask codex "review this patch from a security perspective"
/wise:ask gemini "suggest UX improvements for this flow"
/wise:ask claude "draft an implementation plan for issue #123"
/wise:ask cursor "apply this implementation plan"
```

## Routing

**Required execution path — always use this command:**

```bash
wise ask {{ARGUMENTS}}
```

**Do NOT manually construct raw provider CLI commands.** Never run `codex`, `claude`, `gemini`, `grok`, or `cursor-agent` directly to fulfill this skill. The `wise ask` wrapper handles correct flag selection, artifact persistence, and provider-version compatibility automatically. Manually assembling provider CLI flags will produce incorrect or outdated invocations.

## Requirements

- The selected local CLI must be installed and authenticated.
- Verify availability with the matching command:

```bash
claude --version
codex --version
gemini --version
grok --version
cursor-agent --version
```

## Artifacts

`wise ask` writes artifacts to:

```text
.wise/artifacts/ask/<provider>-<slug>-<timestamp>.md
```

Task: {{ARGUMENTS}}
