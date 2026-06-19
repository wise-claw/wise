# Phase 4: Completion

## Detect Upgrade from 2.x

Check if user has existing 2.x configuration:

```bash
ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/commands/ralph-loop.md 2>/dev/null || ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/commands/ultrawork.md 2>/dev/null
```

If found, this is an upgrade from 2.x. Set `IS_UPGRADE=true`.

## Show Welcome Message

### For New Users (IS_UPGRADE is not true):

```
WISE Setup Complete!

You don't need to learn any commands. I now have intelligent behaviors that activate automatically.

WHAT HAPPENS AUTOMATICALLY:
- Complex tasks -> I parallelize and delegate to specialists
- "plan this" -> I start a planning interview
- "don't stop until done" -> I persist until verified complete
- "stop" or "cancel" -> I intelligently stop current operation

MAGIC KEYWORDS (optional power-user shortcuts):
Just include these words naturally in your request:

| Keyword | Effect | Example |
|---------|--------|---------|
| ralph | Persistence mode | "ralph: fix the auth bug" |
| ralplan | Iterative planning | "ralplan this feature" |
| ulw | Max parallelism | "ulw refactor the API" |
| plan | Planning interview | "plan the new endpoints" |
| team | Coordinated agents | "/team 3:executor fix errors" |

**ralph includes ultrawork:** When you activate ralph mode, it automatically includes ultrawork's parallel execution. No need to combine keywords.

TEAMS:
Spawn coordinated agents with shared task lists and real-time messaging:
- /wise:team 3:executor "fix all TypeScript errors"
- /wise:team 5:debugger "fix build errors in src/"
Teams use Claude Code native tools (TeamCreate/SendMessage/TaskCreate).

MCP SERVERS:
Run /wise:mcp-setup to add tools like web search, GitHub, etc.

HUD STATUSLINE:
The status bar now shows WISE state. Restart Claude Code to see it.

WISE CLI HELPERS (if installed):
- wise hud         - Render the current HUD statusline
- wise teleport    - Create an isolated git worktree
- wise team status - Inspect a running team job
- Session summaries are written to `.wise/sessions/*.json`

That's it! Just use Claude Code normally.
```

### For Users Upgrading from 2.x (IS_UPGRADE is true):

```
WISE Setup Complete! (Upgraded from 2.x)

GOOD NEWS: Your existing commands still work!
- /ralph, /ultrawork, /wise-plan, etc. all still function

WHAT'S NEW in 3.0:
You no longer NEED those commands. Everything is automatic now:
- Just say "don't stop until done" instead of /ralph
- Just say "fast" or "parallel" instead of /ultrawork
- Just say "plan this" instead of /wise-plan
- Just say "stop" instead of /cancel

MAGIC KEYWORDS (power-user shortcuts):
| Keyword | Same as old... | Example |
|---------|----------------|---------|
| ralph | /ralph | "ralph: fix the bug" |
| ralplan | /ralplan | "ralplan this feature" |
| ulw | /ultrawork | "ulw refactor API" |
| wise-plan | /wise-plan | "plan the endpoints" |
| team | (new!) | "/team 3:executor fix errors" |

TEAMS (NEW!):
Spawn coordinated agents with shared task lists and real-time messaging:
- /wise:team 3:executor "fix all TypeScript errors"
- Uses Claude Code native tools (TeamCreate/SendMessage/TaskCreate)

HUD STATUSLINE:
The status bar now shows WISE state. Restart Claude Code to see it.

WISE CLI HELPERS (if installed):
- wise hud         - Render the current HUD statusline
- wise teleport    - Create an isolated git worktree
- wise team status - Inspect a running team job
- Session summaries are written to `.wise/sessions/*.json`

Your workflow won't break - it just got easier!
```

## Optional Rule Templates

WISE includes rule templates you can copy to your project's `.claude/rules/` directory for automatic context injection:

| Template | Purpose |
|----------|---------|
| `coding-style.md` | Code style, immutability, file organization |
| `testing.md` | TDD workflow, 80% coverage target |
| `security.md` | Secret management, input validation |
| `performance.md` | Model selection, context management |
| `git-workflow.md` | Commit conventions, PR workflow |
| `karpathy-guidelines.md` | Coding discipline -- think before coding, simplicity, surgical changes |

Copy with:
```bash
mkdir -p .claude/rules
cp "${WISE_SETUP_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/templates/rules/"*.md .claude/rules/
```

See `templates/rules/README.md` for details.

## Ask About Starring Repository

First, check if `gh` CLI is available and authenticated:

```bash
gh auth status &>/dev/null
```

### If gh is available and authenticated:

**Before prompting, check if the repository is already starred:**

```bash
gh api user/starred/Yeachan-Heo/wise &>/dev/null
```

**If already starred (exit code 0):**
- Skip the prompt entirely
- Continue to completion silently

**If NOT starred (exit code non-zero):**

Use AskUserQuestion:

**Question:** "If you're enjoying wise, would you like to support the project by starring it on GitHub?"

**Options:**
1. **Yes, star it!** - Star the repository
2. **No thanks** - Skip without further prompts
3. **Maybe later** - Skip without further prompts

If user chooses "Yes, star it!":

```bash
gh api -X PUT /user/starred/Yeachan-Heo/wise 2>/dev/null && echo "Thanks for starring!" || true
```

**Note:** Fail silently if the API call doesn't work - never block setup completion.

### If gh is NOT available or not authenticated:

```bash
echo ""
echo "If you enjoy wise, consider starring the repo:"
echo "  https://github.com/Yeachan-Heo/wise"
echo ""
```

## Mark Completion

Get the current WISE version and mark setup complete:

```bash
# Get current WISE version from CLAUDE.md
WISE_VERSION=""
if [ -f ".claude/CLAUDE.md" ]; then
  WISE_VERSION=$(grep -m1 'WISE:VERSION:' .claude/CLAUDE.md 2>/dev/null | sed -E 's/.*WISE:VERSION:([^ ]+).*/\1/' || true)
elif [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md" ]; then
  WISE_VERSION=$(grep -m1 'WISE:VERSION:' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md" 2>/dev/null | sed -E 's/.*WISE:VERSION:([^ ]+).*/\1/' || true)
fi
if [ -z "$WISE_VERSION" ]; then
  WISE_VERSION=$(wise --version 2>/dev/null | head -1 || true)
fi
if [ -z "$WISE_VERSION" ]; then
  WISE_VERSION="unknown"
fi

bash "${WISE_SETUP_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/setup-progress.sh" complete "$WISE_VERSION"
```
