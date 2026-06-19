---
description: ""
---

# WISE writer-memory

This compatibility command keeps `/wise:writer-memory` available without loading the full `writer-memory` skill description in every Claude Code session.

## Dispatch

1. Read the full bundled skill instructions from the active WISE plugin/install: `skills/writer-memory/SKILL.md`.
2. Follow that SKILL.md exactly, treating the user's arguments as:

```text
$ARGUMENTS
```

If the file is not directly readable from the current working directory, locate it under the active `CLAUDE_PLUGIN_ROOT`/`WISE_PLUGIN_ROOT`, package root, or installed WISE plugin directory, then continue.
