# claudet

Interactive worktree manager and Claude Code launcher.

Claudet gives each Claude Code session its own git worktree and plan file, so you can run multiple tasks in parallel without branch conflicts. It tracks time, syncs context docs, and manages the full lifecycle — create, launch, clean.

## Prerequisites

- **Node.js 22+**
- **Claude Code CLI** (`claude`) installed and authenticated
- **Git**
- macOS or Linux (bash required)

## Install

```bash
git clone https://github.com/lgabriellp/claudet.git
cd claudet
npm install
npm run build
npm install -g .
claudet install
```

1. `npm install` — install dependencies
2. `npm run build` — bundle into `dist/`
3. `npm install -g .` — link the `claudet` binary globally so it's available on your PATH
4. `claudet install` — configure the Claude Code statusline, remove legacy files, and verify the installation

Alternatively, run `npm run setup` which executes all steps.

Any package manager works (npm, pnpm, yarn, bun).

### Updating

After pulling new changes:

```bash
npm install
npm run build
npm install -g .
```

## Usage

Run `claudet` with no arguments to start the interactive flow: pick a repo, select or create a worktree, then launch Claude Code inside it.

```
claudet                  Interactive: select repo → worktree → launch claude
claudet init             Configure global settings (scan dirs, data dir)
claudet install          Configure statusline, remove legacy files, verify
claudet create           Non-interactive: create worktree + plan (JSON output)
claudet clean            Select worktrees to archive (merged PRs pre-selected)
claudet clean --merged   Auto-archive all worktrees with merged PRs
claudet context          Sync context docs to ~/.claude/claudet/
claudet statusline       Output status line (reads JSON from stdin)
claudet worklog start    Log session start (called by hook)
claudet worklog tick     Log tick + update time (called by hook)
claudet --help           Show this help
```

### First run

On first launch, `claudet` will prompt you to configure scan directories (where it looks for git repos) and a data directory (where it stores plans, worklogs, and config).

## How it works

1. **Repo selection** — Scans configured directories for git repos, sorted by last accessed.
2. **Worktree selection** — Shows existing worktrees with PR status, review state, and merge conflicts. Create new worktrees from here.
3. **Plan file** — Each worktree gets a plan file (Context, Objective, Key Files, Test Scenarios, Progress log) that Claude reads at session start.
4. **Session launch** — Opens Claude Code in the worktree directory with the plan loaded as context.
5. **Time tracking** — Worklog hooks automatically log session start/tick events.

## License

[MIT](LICENSE)
