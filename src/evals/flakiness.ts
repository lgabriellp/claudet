// ---------------------------------------------------------------------------
// Flakiness detection runner — runs each eval scenario N times and reports
// pass rates. Usage: tsx src/evals/flakiness.ts [runs=3]
// ---------------------------------------------------------------------------

import { SCENARIOS } from "./scenarios.js";
import {
  setupEvalFixture,
  runSubject,
  runJudge,
  cleanupFixture,
  isClaudeAvailable,
} from "./helpers.js";

const RUNS = parseInt(process.argv[2] ?? "3", 10);

if (!isClaudeAvailable()) {
  console.error("claude CLI not available — cannot run flakiness tests");
  process.exit(1);
}

interface ScenarioResult {
  name: string;
  passes: number;
  fails: number;
  errors: string[];
}

async function runScenarioOnce(
  scenario: (typeof SCENARIOS)[number],
): Promise<boolean> {
  const fixture = setupEvalFixture(scenario);
  try {
    const response = await runSubject(fixture, scenario.prompt, {
      allowedTools: scenario.allowedTools,
    });

    const judgeResult = await runJudge(
      response.result,
      scenario.judgeCriteria,
      fixture.sandboxHome,
    );

    return judgeResult.verdicts.every((v) => v.met);
  } finally {
    cleanupFixture(fixture);
  }
}

async function main(): Promise<void> {
  console.log(`Running ${SCENARIOS.length} scenarios × ${RUNS} runs each\n`);

  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    const result: ScenarioResult = {
      name: scenario.name,
      passes: 0,
      fails: 0,
      errors: [],
    };

    // Run N times concurrently for each scenario
    const promises = Array.from({ length: RUNS }, () =>
      runScenarioOnce(scenario).catch((err: Error) => {
        result.errors.push(err.message);
        return false;
      }),
    );

    const outcomes = await Promise.all(promises);
    for (const passed of outcomes) {
      if (passed) result.passes++;
      else result.fails++;
    }

    results.push(result);
    const rate = ((result.passes / RUNS) * 100).toFixed(0);
    console.log(
      `  ${result.name.padEnd(40)} ${result.passes}/${RUNS} (${rate}%)`,
    );
  }

  // Summary table
  console.log("\n--- Flakiness Summary ---");
  console.log(
    "Scenario".padEnd(40) +
      "Passes".padStart(8) +
      "Fails".padStart(8) +
      "Rate".padStart(8),
  );
  console.log("-".repeat(64));

  let totalPasses = 0;
  let totalFails = 0;
  for (const r of results) {
    totalPasses += r.passes;
    totalFails += r.fails;
    const rate = ((r.passes / RUNS) * 100).toFixed(0);
    console.log(
      r.name.padEnd(40) +
        String(r.passes).padStart(8) +
        String(r.fails).padStart(8) +
        `${rate}%`.padStart(8),
    );
    if (r.errors.length > 0) {
      for (const err of r.errors) {
        console.log(`    ERROR: ${err.slice(0, 120)}`);
      }
    }
  }

  console.log("-".repeat(64));
  const totalRate = ((totalPasses / (totalPasses + totalFails)) * 100).toFixed(
    0,
  );
  console.log(
    "TOTAL".padEnd(40) +
      String(totalPasses).padStart(8) +
      String(totalFails).padStart(8) +
      `${totalRate}%`.padStart(8),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
