# Planning Guide

General-purpose planning methodology for structured Claude sessions.

## Plan File Template

Every plan file must include these sections:

```markdown
# <Plan Title>

## Context

Why this change is needed — the problem or opportunity.

## Objective

What will be done — deliverables and scope.

## ClickUp Ticket

Link or ID (if applicable).

## Target Branch

Base branch for the PR (e.g., `dev`, `main`).

## Key Files

Files to be created or modified.

## Test Scenarios

Grouped by tier when testable (see Test Scenario Format below).

## Verification

How to confirm the changes work end-to-end — commands, tests, manual checks.

## Status

pending | in-progress | review | done

## Progress

Append-only log of work done each session.
```

### Required Fields

- **Context** and **Objective** are always required — they frame the "why" and "what"
- **Target Branch** and **Key Files** are required before implementation begins
- **Status** and **Progress** are required for session continuity
- **Verification** is required — every plan must describe how to confirm it works
- **Test Scenarios** are required for any plan that involves testable code

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

## Test Scenario Format

Use the AAA pattern (Arrange, Act, Assert) with numbered scenarios:

```
Test 1: "user can submit the form with valid data"
  Arrange: Navigate to /form, fill in name="John", email="john@test.com"
  Act: Click submit button [data-testid="submit-btn"]
  Assert: Success toast appears, form resets to empty state

Test 2: "validation errors show for empty required fields"
  Arrange: Navigate to /form, leave all fields empty
  Act: Click submit button [data-testid="submit-btn"]
  Assert: Error messages appear below name and email fields
```

### Rules

- Plain English steps with selectors and expected values
- No helper function calls in scenarios — helpers are listed separately
- Scenarios are preserved as doc comments above the test functions they describe
- Group scenarios by tier (unit, integration, e2e) when the plan spans multiple tiers

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

## Documentation Layering Convention

Suggested `.claude/` structure for any project:

| File              | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `CLAUDE.md`       | Main instructions, quick reference                                |
| `ARCHITECTURE.md` | System architecture, entity relationships, layer responsibilities |
| `PATTERNS.md`     | Code patterns cookbook (API, component, hook, state examples)     |
| `DECISIONS.md`    | Architecture Decision Records (ADRs)                              |
| `rules/*.md`      | Domain-specific conventions (api, components, testing, etc.)      |

### Principles

- **CLAUDE.md** stays concise — it's loaded into every conversation
- **Detailed docs** go in separate files linked from CLAUDE.md
- **Rules files** hold domain-specific conventions that only apply to certain tasks
- **DECISIONS.md** is append-only — decisions are amended, never deleted

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
