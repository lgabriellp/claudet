# Planning Guide

General-purpose planning methodology for structured Claude sessions.

## Plan File Location

Plan files are stored based on the branch name. If the branch follows the pattern `<tracking_system>/<task_id>` (e.g., `CU/abc123`, `JIRA/PROJ-456`, `LIN/issue-789`), the plan is stored at:

```
.claude/rules/claudet/<tracking_system>/<task_id>.md
```

This keeps plans organized by tracking system and task, and auto-loaded by Claude Code's rules system.

## Plan File Template

Every plan file must include these sections in this order:

```markdown
# <Plan Title>

## Context

Why this change is needed — the problem or opportunity that prompted it.

## Objective

A concise statement of what will be done. Keep it clear and to the point — one or two sentences. Details, trade-offs, and choices belong in Decisions.

## Target Branch

The base branch for the PR (e.g., dev, main).

## Decisions

Indexed list of all decisions made during planning. Each decision captures a choice, its rationale, and any constraints. New decisions are appended as they arise.

1. **<Decision title>** — <What was decided and why>
2. **<Decision title>** — <What was decided and why>

## Key Files

Files that will be created or modified.

## Test Scenarios

Each scenario must reference a decision (by number) or the objective. Use the AAA pattern (Arrange, Act, Assert).

## Manual Tests

Steps to verify the changes manually. Each test must reference a decision or the objective.

## Implementation

Key files, approach, and step-by-step plan for the changes.

## Verification

How to confirm the changes work end-to-end — commands, tests, manual checks.

## Status

pending | in-progress | review | done

## Time Tracked

Cumulative session time (e.g., 2h 45m).

## Progress

Append-only log of work done each session.
```

### Required Fields

- **Context** and **Objective** are always required — they frame the "why" and "what"
- **Decisions** is required — even if only one decision, it must be recorded
- **Test Scenarios** are required for any plan that involves testable code — each must reference a decision or the objective
- **Manual Tests** are required — steps to verify changes by hand
- **Implementation** is required before coding begins — key files, approach, steps
- **Verification** is required — how to confirm everything works end-to-end
- **Status** and **Progress** are required for session continuity

### Layered Planning Protocol

Plan sections are validated one layer at a time. For each layer, Claude explores the codebase to verify claims, then presents all statements as a multi-select checklist via `AskUserQuestion`. **Never author layer N+1 until all statements in layer N are checked.**

**Validation criteria per layer:**

**Context:**

- Verify referenced systems, tools, or integrations exist in the codebase
- Confirm the problem is real (e.g., if it says "no current way to X", check that X doesn't already exist)
- Check that mentioned constraints are accurate (API limitations, architectural boundaries)

**Objective:**

- Confirm it's concise (1-2 sentences) with no embedded decisions (see Objective Guidelines)
- Verify it's achievable given the approved Context
- Check it's scoped to one worktree's worth of work

**Decisions:**

- For each decision, grep/glob the codebase to verify referenced functions, APIs, and patterns exist
- Check rationale holds given the current codebase state

**Test Scenarios:**

- Verify each scenario traces to a decision (by number) or the objective
- Check that Arrange steps are feasible (referenced utilities, data shapes exist)
- Check that Assert steps are verifiable (expected values are realistic)

**Approval flow (same for every layer):**

1. Validate all statements in the layer against the codebase
2. Present each statement as a checkbox in a multi-select `AskUserQuestion`, with validation status in the description
3. User checks correct statements, leaves incorrect ones unchecked, and may add notes or new statements via "Other"
4. For unchecked statements: revise based on user feedback, propose amendments or additions
5. Re-present the updated checklist — repeat until all statements are checked
6. **After Decisions are fully approved**, run the coherence check:
   - Check for conflicts between decisions
   - Check for conflicts with `DECISIONS.md` ADRs (if the file exists)
   - Verify decisions cover the full scope of the objective (no gaps)
   - If inconsistencies are found, propose new amendment decisions and re-present for approval

After all four layers are approved, proceed to Implementation, Manual Tests, and Verification without additional gates — they follow directly from approved decisions.

## Scope Discipline

Each worktree is scoped to one task. Follow these principles:

- **One task per worktree.** If the user asks you to work on something unrelated to the current plan's Context and Objective, suggest creating a new worktree instead of mixing concerns.
- **Minimize conflicts.** Avoid touching files that aren't necessary for the task. Fewer changed files means fewer merge conflicts.
- **Minimize changed files.** Prefer targeted edits over broad refactors. Only modify what the plan requires.
- **Quality gates must pass.** If the project has a quality command (e.g., `pnpm quality`), run it before considering implementation complete. Fix any failures before moving on.
- **New requirements update the plan.** If new requirements emerge during implementation or after completion, update the Decisions section in the plan file before acting on them. The plan is the source of truth — code follows the plan, not the other way around.

## Completion Protocol

When implementation and verification are both complete (all tests pass, manual tests verified, verification steps confirmed, quality gates green), prompt the user:

> "Implementation and verification are complete. Ready to commit, push, and create a PR?"

If a PR already exists for this branch, suggest adding a comment instead of creating a new one.

## Objective Guidelines

The Objective should answer "what will be done" in one or two sentences:

- **Good:** "Add per-worktree Claude Code sandbox configuration"
- **Bad:** "Add sandbox config using Seatbelt on macOS with bypassPermissions mode, writing to settings.local.json, with domain categories for npm/github/anthropic/cdn"

The bad example contains decisions (Seatbelt, bypassPermissions, domain categories) that belong in the Decisions section.

## Decisions Guidelines

Decisions are an indexed, append-only list. Each entry records:

- **What** was decided
- **Why** — the rationale or constraint that drove the choice
- A decision can be amended by adding a new entry that supersedes it (reference the original by number)

```markdown
## Decisions

1. **Use Seatbelt sandbox on macOS** — OS-level guardrails allow bypassPermissions mode with near-zero prompts
2. **Per-worktree settings.local.json** — isolates sandbox config from global settings and source repo
3. **All 4 domain categories enabled by default** — package registries, git hosts, Anthropic docs, CDNs cover typical dev workflows
4. **Amends #3: Make sandbox opt-in per repo** — some repos don't want sandbox; prompt at registration
```

## Test Scenario Format

Use the AAA pattern (Arrange, Act, Assert) with numbered scenarios. Each scenario must reference a decision or the objective in parentheses:

```
Test 1: "sandbox settings written to worktree" (Decision 1, 2)
  Arrange: Create a worktree with sandbox enabled
  Act: Call writeWorktreeSandboxSettings
  Assert: .claude/settings.local.json contains sandbox.enabled: true, bypassPermissions

Test 2: "sandbox disabled skips settings write" (Decision 4)
  Arrange: Create a worktree with sandbox.enabled: false
  Act: Call writeWorktreeSandboxSettings
  Assert: No .claude/settings.local.json created
```

### Rules

- Plain English steps with selectors and expected values
- Every scenario must trace to a decision number or "Objective"
- Scenarios are preserved as doc comments above the test functions they describe
- Group scenarios by tier (unit, integration, e2e) when the plan spans multiple tiers

## ADR-First Workflow

When a plan introduces or changes an architectural decision:

1. **Write the ADR first** in the project's `DECISIONS.md`
2. **Reference the ADR by number** in the plan (e.g., "See ADR-003")
3. **If execution reveals the ADR needs amendment**, update the ADR before continuing implementation

### ADR Format

```markdown
### ADR-NNN: <Title>

**Status:** proposed | accepted | amended | deprecated
**Date:** YYYY-MM-DD

**Context:** What prompted this decision.

**Decision:** What we decided and why.

**Consequences:** Trade-offs, what this enables, what it prevents.
```

### When to Write an ADR

- Choosing between competing libraries or tools
- Defining a new pattern that other code must follow
- Changing how layers communicate (API contracts, state shape, data flow)
- Introducing a new dependency or removing an existing one

## PR Body Structure

When creating a PR, use this structure:

```markdown
## Context & Objective

Copied from the plan file — why and what.

## Changes

Bulleted summary grouped by area:

- **Area 1:** What changed and why
- **Area 2:** What changed and why

## Test Specifications

Doc comments from each new or updated test — the scenario descriptions.

## Test Results

| Tier | Added | Removed | Total | Duration | ΔDuration |
| ---- | ----- | ------- | ----- | -------- | --------- |
| Unit | +3    | -0      | 42    | 8.2s     | +0.4s     |
| E2E  | +1    | -0      | 15    | 45s      | +3s       |
```

### PR Guidelines

- Title: short, imperative (under 70 characters)
- Context & Objective come directly from the plan — no rewriting
- Changes section is a summary, not a changelog — focus on what a reviewer needs to know
- Test Results table helps reviewers assess coverage impact at a glance

## Progress Tracking

All change requests — including verbal, ad-hoc, or out-of-plan-mode changes — must be logged in the plan's Progress section. The plan file is the single source of truth for what was done and why.

### Progress Entry Format

```markdown
### YYYY-MM-DD — Session N

- Started: brief description of starting point
- Did: what was accomplished
- Next: what remains (if applicable)
```

### Rules

- Append to Progress at the start and end of each session
- Never edit previous progress entries — only append
- If a change request comes in mid-session, log it before acting on it
- If status is `pending`, start planning. If `in-progress`, continue from last progress entry.
