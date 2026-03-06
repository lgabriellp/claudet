# Worktree Workflow Conventions

## Overview

Worktree management is a user-level concern handled by the `claudet` CLI. Sessions are started via `claudet` which selects the repo, picks or creates a worktree, and launches Claude inside it.

## Directory Structure

All claudet data lives in a single configurable directory (`~/.claudet/` by default):

```
~/.claudet/                              # DATA_DIR (configurable)
├── config.json                          # Global claudet preferences
├── worklog.jsonl                        # Append-only session log (cross-repo)
└── repos/
    └── <org>--<repo>/                   # Slug from last 2 path segments
        ├── meta.json                    # { repoRoot, registeredAt }
        ├── config.json                  # Project config (defaultTarget, setup)
        ├── worktrees.json               # Worktree entries (branch, target, archivedAt)
        ├── plans/
        │   └── <name>.md
        └── worktrees/
            └── <name>/                  # Actual git worktree checkouts
```

### Configuration discovery (first match wins)

```
1. CLAUDET_DATA_DIR env var
2. ~/.claudet/config.json → { "dataDir": "..." }
3. Default: ~/.claudet/
```

### What stays in `~/.claude/`

Only Claude Code's own files: `settings.json` (hooks), `CLAUDE.md`, `CLAUDE.local.md`, `projects/`, `memory/`, etc.

## Metadata

- `~/.claudet/repos/<slug>/worktrees.json` — Per-repo worktree metadata
- `~/.claudet/repos/<slug>/meta.json` — Repo root path and registration date
- `~/.claudet/repos/<slug>/plans/<name>.md` — Plan file per worktree
- Repo slug: last 2 path components of repo root joined with `--` (e.g., `vibe--claudet`)
- No `repos.json`: the directory listing of `repos/` IS the registry
- Entries are never deleted from `worktrees.json`; archived entries have `archivedAt` set
- WorktreeEntry fields: `branch`, `target`, `archivedAt` (path/repo/planPath are derived at runtime)

## Project Config

Stored at `~/.claudet/repos/<slug>/config.json`:

```jsonc
{
  "defaultTarget": "dev", // default base branch for new worktrees
  "setup": ["pnpm install"], // commands to run after worktree creation
}
```

On first registration, legacy `.claudet.json` fields (`defaultTarget`, `setup`) are migrated automatically.

## Commands

```
claudet              # Interactive: select repo → select/create worktree → start claude
claudet clean        # Interactive: select worktrees to archive (with confirmation)
```

## Creating a New Worktree

When creating via `claudet`:

1. **Branch name** — e.g., `feat/new-feature`
2. **Target branch** — Default from project config `defaultTarget` or `dev`.
3. **Issue ticket** — Optional. Written to plan file.
4. **Create draft PR?** — Optional. Runs `gh pr create --draft`.

The script:

- Creates the git worktree at `~/.claudet/repos/<slug>/worktrees/<name>/`
- Symlinks `.env*` files and `.claude/settings.local.json` from the main repo
- Runs setup commands from project config `setup` array
- Creates a plan file from template
- Registers in `worktrees.json`
- Launches Claude in the worktree

## Plan Files

Every worktree gets `~/.claudet/repos/<slug>/plans/<name>.md` with these required fields:

- **Context** — Why this change is being made
- **Objective** — What will be done
- **Ticket** — Link or ID
- **Target Branch** — dev (default) or main
- **Key Files** — Files that will be created/modified
- **Test Scenarios** — Test plan grouped by tier
- **Status** — pending | in-progress | review | done
- **Progress** — Append-only log of work done

### Critical Rule

ALL change requests must be documented in the Progress section of the plan file — including requests made outside Claude plan mode (e.g., verbal requests, Slack messages, ad-hoc changes). This ensures the plan file is the single source of truth for what was done and why.

## Session Lifecycle

1. `claudet` selects the worktree and launches Claude
2. Claude reads the plan file (derived from slug + name) at session start
3. Claude appends to Progress at the start and end of each session
4. If status is `pending`, start planning. If `in-progress`, continue from last progress entry.

## Filesystem-wins Reconciliation

On every interactive launch, `reconcileWorktrees(slug)` runs:

1. **Scan `worktrees/` dir** — any subdirectory with a `.git` file is a live worktree. If missing from metadata, discover and add it.
2. **Validate metadata** — if an active entry's directory is gone, mark `archivedAt`.
3. **Cross-check `git worktree list`** — catch worktrees created outside claudet.

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
