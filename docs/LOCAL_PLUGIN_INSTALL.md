# Local Plugin Installation

How to install wise from a local development directory as a Claude Code plugin.

## When to use this guide

Use this document for **local development checkouts and git worktrees** where you want Claude Code to load the plugin from your current repo state.

- **Marketplace/plugin users**: prefer the README quick-start flow
- **npm users**: prefer `npm i -g wise-claw@latest`; npm installs expose both `wise` and `wise` command aliases
- **Local-dev/worktree users**: use this guide so the installed plugin matches the branch/worktree you are editing

## Quick Install

```bash
# 1. Add local directory as a marketplace
claude plugin marketplace add /path/to/wise

# 2. Install the plugin from the local marketplace
claude plugin install wise@wise

# 3. Re-run setup inside Claude Code so CLAUDE.md / skills reflect this checkout
/setup

# 4. Restart Claude Code to pick up the plugin
```

## Commands Reference

```bash
# List configured marketplaces
claude plugin marketplace list

# Update marketplace (re-read from source)
claude plugin marketplace update wise

# Update the installed plugin
claude plugin update wise@wise

# List installed plugins
claude plugin list

# Uninstall
claude plugin uninstall wise@wise

# Remove marketplace
claude plugin marketplace remove wise
```

## Plugin Structure

The plugin requires a `plugin.json` manifest:

```json
{
  "name": "wise",
  "version": "3.4.0",
  "description": "Multi-agent orchestration system for Claude Code",
  "hooks": {
    "PreToolUse": ["scripts/pre-tool-enforcer.mjs"],
    "PostToolUse": ["scripts/post-tool-verifier.mjs"],
    "SessionStart": ["scripts/session-start.mjs"]
  },
  "agents": ["agents/*.md"],
  "commands": ["commands/**/*.md"],
  "skills": ["skills/*.md"]
}
```

## Development Workflow

> **Hot reload caveat**: `claude plugin marketplace add <local-folder>` copies/caches plugin contents under `~/.claude/plugins/cache/` — it does **not** watch your checkout. Every edit to agents, skills, or commands requires the explicit `marketplace update` + `plugin update` + re-run setup dance below. For a no-cache dev loop where changes are picked up without marketplace refresh, use the `--plugin-dir` flow in the [Alternative section](#alternative---plugin-dir-no-marketplace) instead.

After making changes to the plugin (including from a linked git worktree):

```bash
# 1. Build (if TypeScript changes)
npm run build

# 2. Update the marketplace cache
claude plugin marketplace update wise

# 3. Update the installed plugin
claude plugin update wise@wise

# 4. Re-run setup in Claude Code so prompts/skills match the refreshed plugin
/setup

# 5. Restart Claude Code session
```

## Vs. npm Global Install

| Method | Command | Files Location |
|--------|---------|----------------|
| Plugin | `claude plugin install` | `~/.claude/plugins/cache/` |
| npm global | `npm install -g` | `~/.claude/agents/`, `~/.claude/commands/` |

**Plugin mode is preferred** - it keeps files isolated and uses the native Claude Code plugin system with `${CLAUDE_PLUGIN_ROOT}` variable for path resolution.

## Alternative: `--plugin-dir` (no marketplace)

If you prefer not to use the marketplace system, you can launch Claude Code directly with `--plugin-dir`:

```bash
export WISE_PLUGIN_ROOT=/path/to/wise
claude --plugin-dir /path/to/wise
wise setup --plugin-dir-mode
```

Or use the npm CLI shim (`wise`, or `wise` if you prefer the long alias) which handles `--plugin-dir` automatically:

```bash
wise --plugin-dir /path/to/wise setup --plugin-dir-mode
# Equivalent long alias:
wise --plugin-dir /path/to/wise setup --plugin-dir-mode
```

**Key differences from marketplace:**
- Plugin is loaded directly from your filesystem (no cache)
- Changes to agent/skill files take effect after re-running `wise setup`
- No marketplace update step needed — just rebuild and re-run setup
- Requires manual `WISE_PLUGIN_ROOT` export if using `claude` directly (the `wise` / `wise` shims set it for you)

For the full decision matrix and authoritative plugin-dir documentation, see the [Plugin directory flags section in REFERENCE.md](./REFERENCE.md#plugin-directory-flags).

## Troubleshooting

**Plugin not loading:**
- Restart Claude Code after installation
- Check `claude plugin list` shows status as "enabled"
- Verify plugin.json exists and is valid JSON

**Old version showing:**
- The cache directory name may show old version, but the actual code is from latest commit
- Run `claude plugin marketplace update` then `claude plugin update`

**Using `--plugin-dir` or `--plugin-dir-mode`?**
- Verify `WISE_PLUGIN_ROOT` is set: `echo $WISE_PLUGIN_ROOT`
- If using `claude --plugin-dir` directly (not `wise --plugin-dir`), export `WISE_PLUGIN_ROOT` manually
- Run `wise doctor --plugin-dir /path/to/wise` (or `wise doctor --plugin-dir /path/to/wise`) to diagnose issues
