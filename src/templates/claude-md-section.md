## Worktree Workflow

- Sessions are started via `claudet` which selects the worktree and launches Claude inside it
- Plan and planning guides are auto-loaded from `.claude/rules/claudet/`
- Append to the plan's Progress section at the start and end of each session
- If status is `pending`, start planning. If `in-progress`, continue from last progress entry.
- ALL change requests must be logged in the plan's Progress section, even when outside plan mode
- Each worktree is scoped to one task — suggest a new worktree for unrelated work

## Planning

- Every plan requires **Context** (why) and **Objective** (what) — no exceptions
- **Objective** must be concise — details and trade-offs go in the **Decisions** section
- **Decisions** is an indexed, append-only list right after Objective
- **Test Scenarios** and **Manual Tests** must reference a decision (by number) or the objective
- **Implementation** section follows Manual Tests — no coding before the plan is complete
- Before implementing, check Context/Objective/Decisions against `DECISIONS.md` for incoherences — ask for clarification if found
- When implementation and verification are complete, ask the user to commit, push, and create a PR
- Architectural decisions require an **ADR-first** workflow: write the ADR in `DECISIONS.md` before implementing
