## Worktree Session

**Plan file:** /Users/lgabriel/.claudet/repos/vibe--claudet/plans/new-repo.md
**Branch:** feature/new-repo → dev

### Session Protocol

1. Read the plan file at session start
2. Append to Progress at start and end of each session
3. If status is `pending`, start planning. If `in-progress`, continue from last progress entry.
4. ALL change requests must be logged in the plan's Progress section, even when outside plan mode

### Planning Methodology

See `.claude/planning-guide.md` for the full methodology. Key rules:

- Every plan requires **Context** (why) and **Objective** (what)
- Every plan must include a **Verification** section
- Testable plans must include **Test Scenarios** using AAA format
- Architectural decisions require an ADR-first workflow

### Worktree Workflow

See `.claude/worktree-workflow.md` for full conventions.
