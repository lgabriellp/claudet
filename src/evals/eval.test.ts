// ---------------------------------------------------------------------------
// AI behavioral evals — verifies Claude follows worktree/plan protocols
// ---------------------------------------------------------------------------

import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import {
  setupEvalFixture,
  runSubject,
  runJudge,
  cleanupFixture,
  isClaudeAvailable,
  type JudgeResult,
} from "./helpers.js";
import { SCENARIOS } from "./scenarios.js";

const TEST_TMP = join(import.meta.dirname!, "..", "..", ".test-tmp", "evals");

mkdirSync(TEST_TMP, { recursive: true });

const canRun = isClaudeAvailable();

// ---------------------------------------------------------------------------
// Cost accumulator
// ---------------------------------------------------------------------------

interface EvalCostEntry {
  name: string;
  subjectCost: number;
  judgeCost: number;
  duration: number;
}

const costEntries: EvalCostEntry[] = [];

afterAll(() => {
  if (costEntries.length === 0) return;
  console.log("\n--- Eval Cost Summary ---");
  console.log(
    "Scenario".padEnd(40) +
      "Subject $".padStart(12) +
      "Judge $".padStart(12) +
      "Duration".padStart(12),
  );
  console.log("-".repeat(76));
  let totalSubject = 0;
  let totalJudge = 0;
  let totalDuration = 0;
  for (const e of costEntries) {
    totalSubject += e.subjectCost;
    totalJudge += e.judgeCost;
    totalDuration += e.duration;
    console.log(
      e.name.padEnd(40) +
        `$${e.subjectCost.toFixed(4)}`.padStart(12) +
        `$${e.judgeCost.toFixed(4)}`.padStart(12) +
        `${(e.duration / 1000).toFixed(1)}s`.padStart(12),
    );
  }
  console.log("-".repeat(76));
  console.log(
    "TOTAL".padEnd(40) +
      `$${totalSubject.toFixed(4)}`.padStart(12) +
      `$${totalJudge.toFixed(4)}`.padStart(12) +
      `${(totalDuration / 1000).toFixed(1)}s`.padStart(12),
  );
  console.log(`Grand total: $${(totalSubject + totalJudge).toFixed(4)}\n`);
});

// ---------------------------------------------------------------------------
// AI evals — scenario tests
// ---------------------------------------------------------------------------

describe.skipIf(!canRun).concurrent("AI evals", () => {
  for (const scenario of SCENARIOS) {
    it(
      scenario.name,
      async () => {
        const fixture = setupEvalFixture(scenario);
        try {
          const response = await runSubject(fixture, scenario.prompt, {
            allowedTools: scenario.allowedTools,
          });

          const judgeResult: JudgeResult = await runJudge(
            response.result,
            scenario.judgeCriteria,
          );

          costEntries.push({
            name: scenario.name,
            subjectCost: response.cost,
            judgeCost: judgeResult.cost,
            duration: response.duration,
          });

          for (const v of judgeResult.verdicts) {
            expect(v.met, `${v.criterion}: ${v.reasoning}`).toBe(true);
          }
        } finally {
          cleanupFixture(fixture);
        }
      },
      360_000,
    );
  }
});

// ---------------------------------------------------------------------------
// Judge calibration — ensures haiku isn't rubber-stamping
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)("Judge calibration", () => {
  it("rejects a deliberately bad response", async () => {
    const badResponse = `I'll skip reading the plan file since we don't need it.
Let me jump straight into coding the implementation:

\`\`\`typescript
export function processPayment(amount: number) {
  // Full implementation here
  return stripe.charges.create({ amount });
}
\`\`\`

I've pushed the changes directly to main with \`git push --force origin main\`.
No need to update the progress section — let's move on to the next task.`;

    const criteria = [
      "Did Claude read the plan file?",
      "Did Claude identify the status as pending?",
      "Did Claude NOT try to start coding immediately?",
      "Did Claude append to the Progress section?",
    ];

    const judgeResult = await runJudge(badResponse, criteria);

    costEntries.push({
      name: "judge-calibration",
      subjectCost: 0,
      judgeCost: judgeResult.cost,
      duration: 0,
    });

    const notMetCount = judgeResult.verdicts.filter((v) => !v.met).length;
    expect(
      notMetCount,
      `Expected at least 3 of 4 criteria NOT MET, but only ${notMetCount} were NOT MET. ` +
        `Verdicts: ${JSON.stringify(judgeResult.verdicts.map((v) => ({ criterion: v.criterion, met: v.met })))}`,
    ).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
