# Architecture Decision Records

## ADR-001: AI Eval Architecture

**Status:** Accepted
**Date:** 2026-03-22

### Decision

Use `claude -p` (headless invocation) combined with a Haiku judge for behavioral evals that verify Claude follows session and plan protocols.

### Context

claudet orchestrates worktree-based sessions with plan files, progress tracking, and specific behavioral rules (e.g., read plan first, don't code when pending, use correct target branch). We need automated tests that verify Claude actually follows these rules, but no existing eval framework fits:

- Unit tests can't verify LLM behavior
- Standard eval benchmarks don't test tool-use workflows with custom session protocols
- We need cheap, fast, repeatable checks that run alongside unit tests

### Architecture

```
scenarios.ts (declarative)
  → helpers.ts (fixture setup + invocation)
    → eval.test.ts (vitest concurrent runner)
```

**Scenario flow:**

1. `setupEvalFixture()` — creates tmp dir, git repo, plan file, CLAUDE.local.md, session.md
2. `runSubject()` — invokes `claude -p` with read-only tools (Read, Glob, Grep), $0.50 budget cap, 240s timeout
3. `runJudge()` — invokes Haiku with `--json-schema` to evaluate response against criteria, $0.05 budget cap
4. Assert all verdicts are MET

**Scenario types:**

- **Positive** — Claude does the right thing (reads plan, continues from progress, logs changes)
- **Negative** — Claude does NOT do the wrong thing (resists coding when pending, refuses force push, corrects wrong target branch)
- **Judge calibration** — deliberately bad response fed to judge, verifies at least 3/4 criteria are NOT MET

### Running

- `pnpm test:evals` — runs all scenarios (~$7, ~4min) via vitest concurrent
- `pnpm test:evals:flaky` — runs each scenario N times (default 3) to detect flakiness

### Adding Scenarios

Append a new entry to the `SCENARIOS` array in `src/evals/scenarios.ts`:

```typescript
{
  name: "kebab-case-name",
  description: "What this tests",
  fixture: { planStatus: "pending" | "in-progress", targetBranch: "...", branch: "...", ... },
  prompt: "The user prompt sent to claude -p",
  judgeCriteria: ["Did Claude do X?", "Did Claude NOT do Y?"],
}
```

### Trade-offs

- **Non-deterministic:** LLM outputs vary between runs; flakiness runner helps detect unstable scenarios
- **Haiku judge:** Cheap (~$0.01/judgment) but possibly lenient; calibration test guards against rubber-stamping
- **Cost:** ~$0.55/scenario ($0.50 subject + $0.05 judge); full suite ~$7 for 13 scenarios
- **Read-only:** Subject only gets Read/Glob/Grep tools — tests behavioral intent, not file mutations
