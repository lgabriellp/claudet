<div align="center">

# claudet

**Give every Claude Code session its own worktree and plan file.**\
Run parallel AI-assisted tasks without branch conflicts.

[![npm version](https://img.shields.io/npm/v/@lgabriellp/claudet)](https://www.npmjs.com/package/@lgabriellp/claudet)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen)](#install)
[![macOS | Linux](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](#install)

</div>

---

## The problem

**Without claudet**, each new task means: `git worktree add`, create a branch, copy `.env` files, run install, write notes somewhere. Switching tasks means stashing changes and re-orienting. Context for Claude? Re-explain the task every session. Cleanup? `git worktree remove` one at a time, remember to delete branches.

**With claudet**, you run one command. It creates the worktree, sets up symlinks and dependencies, and generates a plan file. Switching tasks is just picking a different worktree from the list. Claude loads the plan automatically — Context, Objective, Progress all there. PR status and review state show up inline. Time is tracked by session hooks. And `claudet clean --merged` archives everything that's been merged.

> [!TIP]
> **What it looks like:** Run `claudet`, pick a repo, select a worktree (or create one). You see PR status, review decisions, and merge conflicts right in the selector. Hit enter and Claude opens with your plan already loaded — Context, Objective, Progress, all there. When you're done, `claudet clean` shows which worktrees have merged PRs and lets you archive them in one step.
>
> <!-- TODO: Record a demo GIF showing the full interactive flow. Recommended tool: https://github.com/charmbracelet/vhs -->

## Feature highlights

- **Parallel sessions, zero conflicts** — Each task gets its own worktree directory. No stashing, no branch switching, no stepping on your own work.
- **Structured plan files** — Every worktree gets a plan with Context, Objective, Key Files, Test Scenarios, and a Progress log. Claude reads it automatically at session start.
- **Live PR dashboard** — The worktree selector shows PR status, review decisions, and merge conflicts inline. Know where every task stands at a glance.
- **Session resumption** — Reopen a worktree and Claude picks up where it left off. The plan file is the shared memory between sessions.
- **Automatic time tracking** — Session hooks log start and tick events. Time tracked shows up in the plan file.
- **One-command cleanup** — `claudet clean --merged` finds all worktrees with merged PRs and archives them. Branches deleted, directories removed.

## Why claudet?

You can use `git worktree` by itself — it's a great tool. But managing worktrees for AI-assisted development involves more than just directories and branches. You need to pass context to Claude, track what happened across sessions, know which worktrees have open PRs, and clean up when you're done.

claudet layers all of that on top of git worktree: structured plan files that Claude reads automatically, a worktree selector that shows live PR and review status, automatic time tracking via session hooks, and one-command cleanup for merged branches. It turns a manual multi-step workflow into a single command.

If you only run one Claude Code session at a time and don't care about session continuity, you probably don't need claudet. If you regularly juggle multiple features, bugfixes, or refactors with Claude, it removes the friction.

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Commands](#commands)
- [Configuration](#configuration)
- [Plan files](#plan-files)
- [Context docs](#context-docs)
- [License](#license)

## Install

> [!IMPORTANT]
> **Prerequisites:** [Node.js 22+](https://nodejs.org/) &middot; [Git](https://git-scm.com/) &middot; [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) installed and authenticated

```bash
curl -fsSL https://raw.githubusercontent.com/lgabriellp/claudet/main/scripts/install-global.sh | bash
```

This checks prerequisites, installs the package globally, and runs post-install setup.

<details>
<summary><strong>Alternative install methods</strong></summary>

### npm

```bash
npm install -g @lgabriellp/claudet
claudet install
```

### From source

```bash
git clone https://github.com/lgabriellp/claudet.git
cd claudet
npm run setup
```

The setup script runs `npm install`, `npm run build`, `npm install -g .`, and `claudet install`. Any package manager works (npm, pnpm, yarn, bun).

### Updating

```bash
npm install -g @lgabriellp/claudet@latest
```

Or from source:

```bash
git pull && npm install && npm run build && npm install -g .
```

</details>

## Quick start

### 1. First run — configure claudet

```bash
claudet init
```

You'll be prompted to set your scan directories (where claudet looks for git repos) and a data directory (where plans, worklogs, and config are stored).

### 2. Start a session

```bash
claudet
```

```
claudet v2.10.4

◆  Select a repo
│  ● my-app           3 worktrees · 2 PRs open
│  ○ api-service      1 worktree
│  ○ design-system    no worktrees
│
◆  Select a worktree — my-app
│  ● add-oauth         PR #42 ✓ approved    in-progress  2h 15m
│  ○ fix-nav-bug       PR #38 ⏳ pending     in-review    45m
│  ○ refactor-auth     no PR                 pending      0m
│  ○ + Create new worktree
│
◇  Launching Claude in ~/repos/my-app/worktrees/add-oauth ...
```

Claude opens with the plan file loaded — Context, Objective, Progress, ready to go.

### 3. Clean up

```bash
claudet clean --merged   # Auto-archive all worktrees with merged PRs
claudet clean            # Interactive: pick which worktrees to archive
```

## How it works

```mermaid
graph LR
    A["claudet"] --> B["Create worktree"]
    B --> C["Work with Claude"]
    C --> D["Open PR"]
    D --> E["Review"]
    E --> F["Merge"]
    F --> G["claudet clean"]

    style A fill:#4a9eff,color:#fff
    style C fill:#10b981,color:#fff
    style G fill:#f59e0b,color:#fff
```

Each worktree moves through: **pending** &rarr; **in-progress** &rarr; **in-review** &rarr; **merged**. claudet updates the plan status automatically when PRs are opened and merged.

### Directory layout

```
~/.claudet/
├── config.json              # Global config (scanDirs, dataDir, defaultTarget)
└── repos/
    └── owner--repo/
        ├── config.json      # Per-project config (defaultTarget, setup, protectedBranches)
        ├── meta.json        # Repo root path
        ├── worktrees.json   # Worktree state
        ├── plans/
        │   ├── add-oauth.md
        │   └── fix-nav-bug.md
        └── worktrees/
            ├── add-oauth/
            └── fix-nav-bug/
```

## Commands

| Command                  | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `claudet`                | Interactive: select repo &rarr; worktree &rarr; launch Claude |
| `claudet init`           | Configure global settings (scan dirs, data dir)               |
| `claudet install`        | Configure statusline, remove legacy files, verify setup       |
| `claudet create`         | Non-interactive: create worktree + plan (JSON output)         |
| `claudet clean`          | Select worktrees to archive                                   |
| `claudet clean --merged` | Auto-archive all worktrees with merged PRs                    |
| `claudet context`        | Sync context docs to `~/.claude/claudet/`                     |
| `claudet statusline`     | Output status line (reads JSON from stdin)                    |
| `claudet worklog start`  | Log session start (called by hook)                            |
| `claudet worklog tick`   | Log tick + update time (called by hook)                       |
| `claudet --version`      | Show version                                                  |
| `claudet --help`         | Show help                                                     |

<details>
<summary><strong><code>claudet create</code> flags</strong></summary>

| Flag                    | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `--branch, -b <name>`   | Branch name (required)                                  |
| `--target, -t <branch>` | Base branch (default: project `defaultTarget` or `dev`) |
| `--ticket <id>`         | Issue tracker ticket ID                                 |
| `--skip-setup`          | Skip setup commands                                     |
| `--repo <path>`         | Main repo root (auto-detected from worktrees)           |

</details>

## Configuration

### Global config (`~/.claudet/config.json`)

| Key             | Type       | Default       | Description                                  |
| --------------- | ---------- | ------------- | -------------------------------------------- |
| `scanDirs`      | `string[]` | `["~/repos"]` | Directories to scan for git repos            |
| `dataDir`       | `string`   | `~/.claudet`  | Where plans, worklogs, and config are stored |
| `defaultTarget` | `string`   | `"dev"`       | Default base branch for new worktrees        |

### Per-project config (`~/.claudet/repos/<slug>/config.json`)

| Key                 | Type       | Default                   | Description                                    |
| ------------------- | ---------- | ------------------------- | ---------------------------------------------- |
| `defaultTarget`     | `string`   | global `defaultTarget`    | Base branch override for this project          |
| `setup`             | `string[]` | `[]`                      | Commands to run after creating a worktree      |
| `protectedBranches` | `string[]` | `["main", "dev", "prod"]` | Branches that cannot be used as worktree names |

> [!NOTE]
> Set `CLAUDET_DATA_DIR` to override the data directory location.

## Plan files

Each worktree gets a plan file that Claude reads automatically at session start. Here's a filled example:

```markdown
# add-oauth

## Context

Users currently sign in with email/password only. Adding OAuth (Google, GitHub)
reduces friction and improves conversion on the signup page.

## Objective

Implement OAuth login flow with Google and GitHub providers, including account
linking for existing email users.

## Ticket

PROJ-142

## Target Branch

dev

## Key Files

- src/auth/oauth.ts
- src/auth/providers/google.ts
- src/auth/providers/github.ts
- src/components/LoginPage.tsx

## Test Scenarios

- Arrange: user with no account; Act: sign in with Google; Assert: account created, redirected to dashboard
- Arrange: existing email user; Act: sign in with GitHub using same email; Assert: accounts linked
- Arrange: OAuth token expired; Act: refresh; Assert: new token issued transparently

## Status

in-progress

## Time Tracked

2h 15m

## Progress

- 2026-03-20 09:00: Created worktree, started planning
- 2026-03-20 10:30: Implemented Google OAuth provider, basic flow working
- 2026-03-21 14:00: Added GitHub provider, account linking logic
- 2026-03-22 09:00: Session resumed — fixing token refresh edge case
```

### Status transitions

| Status        | Meaning                                |
| ------------- | -------------------------------------- |
| `pending`     | Worktree created, planning not started |
| `in-progress` | Active development                     |
| `in-review`   | PR open, waiting for review            |
| `merged`      | PR merged, ready for cleanup           |

## Context docs

claudet installs shared context documents to `~/.claude/claudet/` that Claude reads across all sessions. These include the worktree workflow conventions and the planning guide.

claudet also manages a section in your global `~/.claude/CLAUDE.md` that references these docs. Run `claudet context` to sync them manually, or `claudet install` to set everything up.

## License

[MIT](LICENSE)

> [!NOTE]
> **Disclaimer:** claudet is an independent, community-built tool. It is not made by, endorsed by, sponsored by, or affiliated with Anthropic, PBC. "Claude" and "Claude Code" are trademarks of [Anthropic, PBC](https://www.anthropic.com).
