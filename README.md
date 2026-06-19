## Quick Start

**Step 1: Install**
```bash
/plugin marketplace add https://github.com/Yeachan-Heo/wise
/plugin install wise
```

**Step 2: Configure**
```bash
/wise-setup
```

If you run WISE via `wise --plugin-dir <path>` or `claude --plugin-dir <path>`, add `--plugin-dir-mode` to `wise setup` (or export `WISE_PLUGIN_ROOT` beforehand) to avoid copying skills/agents the plugin already provides at runtime. See [Plugin directory flags in REFERENCE.md](./docs/REFERENCE.md#plugin-directory-flags) for the full decision matrix and all available flags.

**Step 3: Start building**
```
autopilot: build a REST API for managing tasks
```

That's it. The rest is automatic.
