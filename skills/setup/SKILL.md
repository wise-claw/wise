---
name: setup
description: Use first for install/update routing — sends setup, doctor, or MCP requests to the correct WISE setup flow
level: 2
---

# Setup

Use `/wise:setup` as the unified setup/configuration entrypoint.

## Usage

```bash
/wise:setup                # full setup wizard
/wise:setup doctor         # installation diagnostics
/wise:setup mcp            # MCP server configuration
/wise:setup wizard --local # explicit wizard path
```

## Routing

Process the request by the **first argument only** so install/setup questions land on the right flow immediately:

- No argument, `wizard`, `local`, `global`, or `--force` -> route to `/wise:wise-setup` with the same remaining args
- `doctor` -> route to `/wise:wise-doctor` with everything after the `doctor` token
- `mcp` -> route to `/wise:mcp-setup` with everything after the `mcp` token

Examples:

```bash
/wise:setup --local          # => /wise:wise-setup --local
/wise:setup doctor --json    # => /wise:wise-doctor --json
/wise:setup mcp github       # => /wise:mcp-setup github
```

## Notes

- `/wise:wise-setup`, `/wise:wise-doctor`, and `/wise:mcp-setup` remain valid compatibility entrypoints.
- Prefer `/wise:setup` in new documentation and user guidance.

Task: {{ARGUMENTS}}
