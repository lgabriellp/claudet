## Worktree Workflow

See [claudet/worktree-workflow.md](./claudet/worktree-workflow.md) for full conventions.

- Sessions are started via `claudet` which selects the worktree and launches Claude inside it
- Read the worktree's plan file from `.claude/rules/session.md` at session start
- Append to the plan's Progress section at the start and end of each session
- If status is `pending`, start planning. If `in-progress`, continue from last progress entry.
- ALL change requests must be logged in the plan's Progress section, even when outside plan mode
- Plans are stored at `~/.claude/plans/<name>.md`
- Required fields: Context, Objective, Ticket, Target Branch, Key Files, Test Scenarios, Status, Progress

## Planning

See [claudet/planning-guide.md](./claudet/planning-guide.md) for the full methodology.

- Every plan requires **Context** (why) and **Objective** (what) — no exceptions
- Testable plans must include **Test Scenarios** using the AAA format (Arrange, Act, Assert)
- Architectural decisions require an **ADR-first** workflow: write the ADR in `DECISIONS.md` before implementing
- Every plan must include a **Verification** section describing how to confirm the changes work
- PRs follow a standard structure: Context & Objective, Changes, Test Specifications, Test Results
- Projects should layer docs: `CLAUDE.md` (concise) → `ARCHITECTURE.md`, `PATTERNS.md`, `DECISIONS.md`, `rules/*.md`
