# Worktree Workflow Conventions

## Overview

Worktree management is a user-level concern handled by the `claudet` CLI. Sessions are started via `claudet` which selects the repo, picks or creates a worktree, and launches Claude inside it.

## Directory Convention

All worktrees live in a `worktrees/` directory, sibling to the main repo:

| Location | Purpose |
|----------|---------|
| `<repo>/` | Main repo — git hub & shared config only (no development) |
| `worktrees/<name>/` | Feature/fix worktrees |

## Metadata

- `<repoRoot>/.claude/worktrees.json` — Per-repo worktree metadata (scoped to that repo)
- `~/.claude/repos.json` — Registry of known repo root paths (for repo discovery)
- `~/.claude/plans/<name>.md` — Structured plan file per worktree
- Entries are never deleted from `worktrees.json`; archived entries have `archivedAt` set
- On first run after migration, `~/.claude/worktrees.json` is split into per-repo files and renamed to `~/.claude/worktrees.json.migrated`

## Commands

```
claudet              # Interactive: select repo → select/create worktree → start claude
claudet clean        # Interactive: select worktrees to archive (with confirmation)
```

## Creating a New Worktree

When creating via `claudet`:

1. **Branch name** — e.g., `feat/new-feature`
2. **Target branch** — Default: `dev`. Use `main` for high priority.
3. **ClickUp ticket** — Optional. Written to plan file.
4. **Create draft PR?** — Optional. Runs `gh pr create --draft`.

The script:
- Creates the git worktree
- Symlinks `.env*` files and `.claude/settings.local.json` from the main repo
- Installs dependencies
- Creates a plan file from template
- Registers in `worktrees.json`
- Launches Claude in the worktree

## Plan Files

Every worktree gets `~/.claude/plans/<name>.md` with these required fields:

- **Context** — Why this change is being made
- **Objective** — What will be done
- **ClickUp Ticket** — Link or ID
- **Target Branch** — dev (default) or main
- **Key Files** — Files that will be created/modified
- **Test Scenarios** — Test plan grouped by tier
- **Status** — pending | in-progress | review | done
- **Progress** — Append-only log of work done

### Critical Rule

ALL change requests must be documented in the Progress section of the plan file — including requests made outside Claude plan mode (e.g., verbal requests, Slack messages, ad-hoc changes). This ensures the plan file is the single source of truth for what was done and why.

## Session Lifecycle

1. `claudet` selects the worktree and launches Claude
2. Claude reads the plan file (from `worktrees.json` `planPath`) at session start
3. Claude appends to Progress at the start and end of each session
4. If status is `pending`, start planning. If `in-progress`, continue from last progress entry.

## Cleaning Up

`claudet clean` offers interactive multi-select of worktrees to archive:
- Removes the git worktree directory
- Sets `archivedAt` timestamp in `worktrees.json`
- Plan file is preserved for history
- Smoke test worktrees are auto-removed on every clean

## Rules

- Never develop in the main repo — always use a worktree
- The main repo serves only as git hub and `.env*` source
- Root repo stays on `dev` (not detached HEAD) when freeing a branch
- Never check out the same branch in two worktrees simultaneously
- Each worktree runs its own dev server, tests, and builds without conflicts
- `.env*` files are symlinked from the main repo — edits propagate to all worktrees
- `.claude/settings.local.json` is symlinked (not copied) from the main repo

## Auto-Sync

On first run (empty or missing `worktrees.json`), `claudet` auto-syncs from `git worktree list`:
1. Parses each entry (path + branch)
2. Derives short name, target defaults to `dev`
3. Creates plan files for each entry
4. Filters out smoke test worktrees
