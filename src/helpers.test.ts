import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  chmodSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  tryParseJson,
  expandHome,
  computeContextHash,
  managedSectionReplace,
  managedSectionExtract,
  toMergeableStatus,
  deriveRepoSlug,
  deriveShortName,
  composeBranchFromTask,
  isSmokeTestWorktree,
  parseCreateFlags,
  parseCleanFlags,
  formatDuration,
  parseDuration,
  compareDatesDesc,
  getStatusFromPlan,
  getProgressEntries,
  getLastProgress,
  scanForGitRepos,
  validateBranchName,
  cleanStaleSessionFiles,
  loadRepoSlugs,
  mergeWorklogHooks,
  HooksConfigSchema,
  compareWorktreeEntries,
  computeReviewDecision,
  prNeedsAttention,
  upsertPlanSection,
  getTargetFromPlan,
  getBranchFromPlan,
  getPlanSection,
  computeWorklogEvents,
  statusBadge,
  reviewSuffix,
  prStateLabel,
  prBadge,
  generatePlanContent,
  matchesSearch,
  sortBranchesDefaultFirst,
  type PRStatus,
  type WorktreeSortEntry,
  type ReviewInfo,
} from "./helpers.js";
import pico from "picocolors";
import type { Colors } from "picocolors/types";

const TEST_TMP = join(import.meta.dirname!, "..", ".test-tmp");

beforeAll(() => {
  mkdirSync(TEST_TMP, { recursive: true });
});

// ---------------------------------------------------------------------------
// tryParseJson
// ---------------------------------------------------------------------------

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseJson('{"a":1}', {})).toEqual({ a: 1 });
  });

  it("returns fallback for invalid JSON", () => {
    expect(tryParseJson("not json", { ok: false })).toEqual({ ok: false });
  });

  it("returns fallback for empty string", () => {
    expect(tryParseJson("", [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// expandHome
// ---------------------------------------------------------------------------

describe("expandHome", () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  it("expands leading tilde", () => {
    expect(expandHome("~/foo/bar")).toBe(`${home}/foo/bar`);
  });

  it("does not expand tilde mid-string", () => {
    expect(expandHome("/foo/~/bar")).toBe("/foo/~/bar");
  });

  it("returns path unchanged when no tilde", () => {
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });

  it("expands bare tilde", () => {
    expect(expandHome("~")).toBe(home);
  });
});

// ---------------------------------------------------------------------------
// computeContextHash
// ---------------------------------------------------------------------------

describe("computeContextHash", () => {
  it("returns consistent results for the same content", () => {
    expect(computeContextHash("hello world")).toBe(
      computeContextHash("hello world"),
    );
  });

  it("returns different hashes for different content", () => {
    expect(computeContextHash("hello")).not.toBe(computeContextHash("world"));
  });

  it("returns a 12-char hex string", () => {
    expect(computeContextHash("test")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("handles empty string", () => {
    expect(computeContextHash("")).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// managedSectionReplace
// ---------------------------------------------------------------------------

describe("managedSectionReplace", () => {
  it("appends when no markers exist", () => {
    const result = managedSectionReplace("user content\n", "managed");
    expect(result).toContain("user content");
    expect(result).toContain("<!-- claudet:start -->");
    expect(result).toContain("managed");
    expect(result).toContain("<!-- claudet:end -->");
  });

  it("replaces between existing markers", () => {
    const input =
      "before\n<!-- claudet:start -->\nold\n<!-- claudet:end -->\nafter\n";
    const result = managedSectionReplace(input, "new");
    expect(result).toContain("before\n");
    expect(result).toContain("new");
    expect(result).not.toContain("old");
    expect(result).toContain("after\n");
  });

  it("preserves surrounding content", () => {
    const input =
      "# Header\nsome stuff\n<!-- claudet:start -->\nold\n<!-- claudet:end -->\n# Footer\n";
    const result = managedSectionReplace(input, "replaced");
    expect(result).toContain("# Header\nsome stuff\n");
    expect(result).toContain("\n# Footer\n");
  });

  it("handles empty input", () => {
    const result = managedSectionReplace("", "section");
    expect(result).toContain("<!-- claudet:start -->");
    expect(result).toContain("section");
    expect(result).toContain("<!-- claudet:end -->");
  });

  it("handles input without trailing newline", () => {
    const result = managedSectionReplace("no newline", "section");
    expect(result).toContain("no newline");
    expect(result).toContain("<!-- claudet:start -->");
  });

  it("is idempotent", () => {
    const input = "user content\n";
    const result1 = managedSectionReplace(input, "managed section");
    const result2 = managedSectionReplace(result1, "managed section");
    expect(result1).toBe(result2);
  });
});

// ---------------------------------------------------------------------------
// managedSectionExtract
// ---------------------------------------------------------------------------

describe("managedSectionExtract", () => {
  it("extracts content between markers", () => {
    const input =
      "before\n<!-- claudet:start -->\nmanaged content\n<!-- claudet:end -->\nafter\n";
    expect(managedSectionExtract(input)).toBe("managed content");
  });

  it("returns null when no markers", () => {
    expect(managedSectionExtract("no markers here")).toBeNull();
  });

  it("returns null when only start marker", () => {
    expect(
      managedSectionExtract("before\n<!-- claudet:start -->\nstuff"),
    ).toBeNull();
  });

  it("returns null when markers are reversed", () => {
    expect(
      managedSectionExtract(
        "<!-- claudet:end -->\ncontent\n<!-- claudet:start -->",
      ),
    ).toBeNull();
  });

  it("trims whitespace from extracted content", () => {
    const input =
      "<!-- claudet:start -->\n  spaced content  \n<!-- claudet:end -->";
    expect(managedSectionExtract(input)).toBe("spaced content");
  });
});

// ---------------------------------------------------------------------------
// toMergeableStatus
// ---------------------------------------------------------------------------

describe("toMergeableStatus", () => {
  it("returns MERGEABLE for true", () => {
    expect(toMergeableStatus(true)).toBe("MERGEABLE");
  });

  it("returns CONFLICTING for false", () => {
    expect(toMergeableStatus(false)).toBe("CONFLICTING");
  });

  it("returns UNKNOWN for null", () => {
    expect(toMergeableStatus(null)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for undefined", () => {
    expect(toMergeableStatus(undefined)).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// deriveRepoSlug
// ---------------------------------------------------------------------------

describe("deriveRepoSlug", () => {
  it("derives slug from normal path", () => {
    expect(deriveRepoSlug("/Users/dev/repos/my-project")).toBe(
      "repos--my-project",
    );
  });

  it("derives slug from nested path", () => {
    expect(deriveRepoSlug("/home/user/work/org/service")).toBe("org--service");
  });
});

// ---------------------------------------------------------------------------
// deriveShortName
// ---------------------------------------------------------------------------

describe("deriveShortName", () => {
  it("strips feat/ prefix", () => {
    expect(deriveShortName("feat/cool-thing")).toBe("cool-thing");
  });

  it("strips fix/ prefix", () => {
    expect(deriveShortName("fix/bug-123")).toBe("bug-123");
  });

  it("strips chore/ prefix", () => {
    expect(deriveShortName("chore/cleanup")).toBe("cleanup");
  });

  it("strips feature/ prefix", () => {
    expect(deriveShortName("feature/new-thing")).toBe("new-thing");
  });

  it("strips test/ prefix", () => {
    expect(deriveShortName("test/add-specs")).toBe("add-specs");
  });

  it("returns branch unchanged when no known prefix", () => {
    expect(deriveShortName("release/v2")).toBe("release-v2");
  });

  it("converts nested slashes to dashes", () => {
    expect(deriveShortName("feat/scope/detail")).toBe("scope-detail");
  });

  it("strips jira/ prefix", () => {
    expect(deriveShortName("jira/PROJ-123")).toBe("PROJ-123");
  });

  it("strips clickup/ prefix", () => {
    expect(deriveShortName("clickup/CU-abc")).toBe("CU-abc");
  });

  it("strips linear/ prefix", () => {
    expect(deriveShortName("linear/LIN-42")).toBe("LIN-42");
  });

  it("strips github/ prefix", () => {
    expect(deriveShortName("github/42")).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// composeBranchFromTask
// ---------------------------------------------------------------------------

describe("composeBranchFromTask", () => {
  it("composes jira branch", () => {
    expect(composeBranchFromTask("jira", "PROJ-123")).toBe("jira/PROJ-123");
  });

  it("composes clickup branch", () => {
    expect(composeBranchFromTask("clickup", "CU-abc")).toBe("clickup/CU-abc");
  });

  it("composes linear branch", () => {
    expect(composeBranchFromTask("linear", "LIN-42")).toBe("linear/LIN-42");
  });

  it("composes github branch", () => {
    expect(composeBranchFromTask("github", "42")).toBe("github/42");
  });
});

// ---------------------------------------------------------------------------
// isSmokeTestWorktree
// ---------------------------------------------------------------------------

describe("isSmokeTestWorktree", () => {
  it("matches worktree-smoke- prefix", () => {
    expect(isSmokeTestWorktree("worktree-smoke-abc123")).toBe(true);
  });

  it("matches test-worktree-smoke- prefix", () => {
    expect(isSmokeTestWorktree("test-worktree-smoke-xyz")).toBe(true);
  });

  it("rejects non-matching names", () => {
    expect(isSmokeTestWorktree("my-feature")).toBe(false);
  });

  it("rejects partial prefix match", () => {
    expect(isSmokeTestWorktree("worktree-smok")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseCreateFlags
// ---------------------------------------------------------------------------

describe("parseCreateFlags", () => {
  it("parses all flags", () => {
    const result = parseCreateFlags([
      "--branch",
      "feat/x",
      "--target",
      "main",
      "--ticket",
      "PROJ-123",
      "--skip-setup",
      "--repo",
      "/path/to/repo",
    ]);
    expect(result).toEqual({
      branch: "feat/x",
      target: "main",
      ticket: "PROJ-123",
      skipSetup: true,
      repo: "/path/to/repo",
    });
  });

  it("parses short flags", () => {
    const result = parseCreateFlags(["-b", "fix/y", "-t", "dev"]);
    expect(result.branch).toBe("fix/y");
    expect(result.target).toBe("dev");
  });

  it("defaults branch to empty string", () => {
    const result = parseCreateFlags([]);
    expect(result.branch).toBe("");
  });

  it("defaults boolean flags to false", () => {
    const result = parseCreateFlags(["-b", "x"]);
    expect(result.skipSetup).toBe(false);
  });

  it("handles mixed order", () => {
    const result = parseCreateFlags(["-b", "feat/z", "--ticket", "T-1"]);
    expect(result.branch).toBe("feat/z");
    expect(result.ticket).toBe("T-1");
  });
});

// ---------------------------------------------------------------------------
// parseCleanFlags
// ---------------------------------------------------------------------------

describe("parseCleanFlags", () => {
  it("defaults merged to false", () => {
    const result = parseCleanFlags([]);
    expect(result).toEqual({ merged: false });
  });

  it("parses --merged flag", () => {
    const result = parseCleanFlags(["--merged"]);
    expect(result).toEqual({ merged: true });
  });

  it("ignores unknown flags", () => {
    const result = parseCleanFlags(["--foo", "--merged"]);
    expect(result).toEqual({ merged: true });
  });
});

// ---------------------------------------------------------------------------
// formatDuration / parseDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
  });

  it("formats minutes", () => {
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(5_400_000)).toBe("1h 30m");
  });

  it("formats exact hours", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("parseDuration", () => {
  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("30m")).toBe(1_800_000);
  });

  it("parses seconds", () => {
    expect(parseDuration("45s")).toBe(45_000);
  });

  it("parses combined", () => {
    expect(parseDuration("1h 30m")).toBe(5_400_000);
  });

  it("returns 0 for empty string", () => {
    expect(parseDuration("")).toBe(0);
  });
});

describe("formatDuration / parseDuration round-trip", () => {
  it.each([60_000, 3_600_000, 5_400_000, 5000])("round-trips %i ms", (ms) => {
    expect(parseDuration(formatDuration(ms))).toBe(ms);
  });
});

// ---------------------------------------------------------------------------
// compareDatesDesc
// ---------------------------------------------------------------------------

describe("compareDatesDesc", () => {
  it("sorts more recent date first (returns negative)", () => {
    expect(
      compareDatesDesc("2026-03-05T12:00:00Z", "2026-03-01T12:00:00Z"),
    ).toBeLessThan(0);
  });

  it("sorts older date second (returns positive)", () => {
    expect(
      compareDatesDesc("2026-03-01T12:00:00Z", "2026-03-05T12:00:00Z"),
    ).toBeGreaterThan(0);
  });

  it("returns 0 for identical dates", () => {
    expect(
      compareDatesDesc("2026-03-05T12:00:00Z", "2026-03-05T12:00:00Z"),
    ).toBe(0);
  });

  it("sorts defined before undefined", () => {
    expect(compareDatesDesc("2026-03-05T12:00:00Z", undefined)).toBeLessThan(0);
  });

  it("returns 0 when both undefined", () => {
    expect(compareDatesDesc(undefined, undefined)).toBe(0);
  });

  it("sorts null after defined", () => {
    expect(compareDatesDesc(null, "2026-03-05T12:00:00Z")).toBeGreaterThan(0);
  });

  it("sorts array of objects with mixed dates correctly", () => {
    const items = [
      { name: "old", date: "2026-01-01T00:00:00Z" },
      { name: "none", date: undefined as string | undefined },
      { name: "recent", date: "2026-03-05T00:00:00Z" },
      { name: "mid", date: "2026-02-15T00:00:00Z" },
    ];
    items.sort((a, b) => compareDatesDesc(a.date, b.date));
    expect(items.map((i) => i.name)).toEqual(["recent", "mid", "old", "none"]);
  });
});

// ---------------------------------------------------------------------------
// computeReviewDecision
// ---------------------------------------------------------------------------

describe("computeReviewDecision", () => {
  it("returns NONE with no reviews and no requested reviewers", () => {
    expect(computeReviewDecision([], 0)).toBe("NONE");
  });

  it("returns REVIEW_REQUESTED when there are requested reviewers", () => {
    expect(computeReviewDecision([], 2)).toBe("REVIEW_REQUESTED");
  });

  it("returns APPROVED when a reviewer approved", () => {
    const reviews: ReviewInfo[] = [{ user: "alice", state: "APPROVED" }];
    expect(computeReviewDecision(reviews, 0)).toBe("APPROVED");
  });

  it("returns CHANGES_REQUESTED when a reviewer requested changes", () => {
    const reviews: ReviewInfo[] = [
      { user: "alice", state: "CHANGES_REQUESTED" },
    ];
    expect(computeReviewDecision(reviews, 0)).toBe("CHANGES_REQUESTED");
  });

  it("uses latest state per user (override earlier review)", () => {
    const reviews: ReviewInfo[] = [
      { user: "alice", state: "CHANGES_REQUESTED" },
      { user: "alice", state: "APPROVED" },
    ];
    expect(computeReviewDecision(reviews, 0)).toBe("APPROVED");
  });

  it("returns CHANGES_REQUESTED with mixed reviewers", () => {
    const reviews: ReviewInfo[] = [
      { user: "alice", state: "APPROVED" },
      { user: "bob", state: "CHANGES_REQUESTED" },
    ];
    expect(computeReviewDecision(reviews, 0)).toBe("CHANGES_REQUESTED");
  });

  it("ignores COMMENTED reviews", () => {
    const reviews: ReviewInfo[] = [{ user: "alice", state: "COMMENTED" }];
    expect(computeReviewDecision(reviews, 0)).toBe("NONE");
  });

  it("DISMISSED clears a previous approval", () => {
    const reviews: ReviewInfo[] = [
      { user: "alice", state: "APPROVED" },
      { user: "alice", state: "DISMISSED" },
    ];
    expect(computeReviewDecision(reviews, 0)).toBe("NONE");
  });

  it("CHANGES_REQUESTED beats REVIEW_REQUESTED", () => {
    const reviews: ReviewInfo[] = [
      { user: "alice", state: "CHANGES_REQUESTED" },
    ];
    expect(computeReviewDecision(reviews, 3)).toBe("CHANGES_REQUESTED");
  });
});

// ---------------------------------------------------------------------------
// prNeedsAttention
// ---------------------------------------------------------------------------

describe("prNeedsAttention", () => {
  it("returns false for null PR", () => {
    expect(prNeedsAttention(null)).toBe(false);
  });

  it("returns false for merged PR", () => {
    expect(
      prNeedsAttention({
        state: "MERGED",
        mergeable: "UNKNOWN",
        reviewDecision: "NONE",
      }),
    ).toBe(false);
  });

  it("returns true for open PR with conflicts", () => {
    expect(
      prNeedsAttention({
        state: "OPEN",
        mergeable: "CONFLICTING",
        reviewDecision: "NONE",
      }),
    ).toBe(true);
  });

  it("returns true for open PR with changes requested", () => {
    expect(
      prNeedsAttention({
        state: "OPEN",
        mergeable: "MERGEABLE",
        reviewDecision: "CHANGES_REQUESTED",
      }),
    ).toBe(true);
  });

  it("returns false for open PR with review pending", () => {
    expect(
      prNeedsAttention({
        state: "OPEN",
        mergeable: "MERGEABLE",
        reviewDecision: "REVIEW_REQUESTED",
      }),
    ).toBe(false);
  });

  it("returns false for open PR that is approved and mergeable", () => {
    expect(
      prNeedsAttention({
        state: "OPEN",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compareWorktreeEntries
// ---------------------------------------------------------------------------

describe("compareWorktreeEntries", () => {
  const EPOCH = "1970-01-01T00:00:00.000Z";

  it("sorts high-priority target before normal target", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "dev", lastAccessedAt: "2026-03-05T12:00:00Z" },
      { target: "main", lastAccessedAt: "2026-03-01T12:00:00Z" },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].target).toBe("main");
    expect(entries[1].target).toBe("dev");
  });

  it("falls through to recency when priority is equal", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "main", lastAccessedAt: "2026-03-01T12:00:00Z" },
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].lastAccessedAt).toBe("2026-03-05T12:00:00Z");
    expect(entries[1].lastAccessedAt).toBe("2026-03-01T12:00:00Z");
  });

  it("works with custom highPriorityTarget value", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
      { target: "dev", lastAccessedAt: "2026-03-01T12:00:00Z" },
    ];
    entries.sort(compareWorktreeEntries("dev"));
    expect(entries[0].target).toBe("dev");
    expect(entries[1].target).toBe("main");
  });

  it("sorts epoch default last within priority group", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "main", lastAccessedAt: EPOCH },
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].lastAccessedAt).toBe("2026-03-05T12:00:00Z");
    expect(entries[1].lastAccessedAt).toBe(EPOCH);
  });

  it("sorts full realistic list correctly", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "dev", lastAccessedAt: "2026-03-04T10:00:00Z" },
      { target: "main", lastAccessedAt: "2026-03-01T08:00:00Z" },
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
      { target: "dev", lastAccessedAt: EPOCH },
      { target: "main", lastAccessedAt: EPOCH },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries.map((e) => `${e.target}:${e.lastAccessedAt}`)).toEqual([
      "main:2026-03-05T12:00:00Z",
      "main:2026-03-01T08:00:00Z",
      "main:1970-01-01T00:00:00.000Z",
      "dev:2026-03-04T10:00:00Z",
      "dev:1970-01-01T00:00:00.000Z",
    ]);
  });

  it("keeps order stable when entries are identical", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries).toHaveLength(2);
    expect(entries[0].lastAccessedAt).toBe("2026-03-05T12:00:00Z");
  });

  it("sorts needsAttention before highPriorityTarget", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
      {
        target: "dev",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        needsAttention: true,
      },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].target).toBe("dev");
    expect(entries[0].needsAttention).toBe(true);
  });

  it("sub-sorts within needsAttention by priority then recency", () => {
    const entries: WorktreeSortEntry[] = [
      {
        target: "dev",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        needsAttention: true,
      },
      {
        target: "main",
        lastAccessedAt: "2026-03-05T12:00:00Z",
        needsAttention: true,
      },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].target).toBe("main");
  });

  it("does not affect order when no entries have needsAttention", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "dev", lastAccessedAt: "2026-03-04T10:00:00Z" },
      { target: "main", lastAccessedAt: "2026-03-01T08:00:00Z" },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].target).toBe("main");
    expect(entries[1].target).toBe("dev");
  });

  it("treats undefined needsAttention as false", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
      {
        target: "dev",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        needsAttention: true,
      },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(entries[0].needsAttention).toBe(true);
    expect(entries[1].needsAttention).toBeUndefined();
  });

  it("sorts full realistic list with mixed attention correctly", () => {
    const entries: WorktreeSortEntry[] = [
      { target: "dev", lastAccessedAt: "2026-03-04T10:00:00Z" },
      {
        target: "dev",
        lastAccessedAt: "2026-03-02T10:00:00Z",
        needsAttention: true,
      },
      { target: "main", lastAccessedAt: "2026-03-05T12:00:00Z" },
      {
        target: "main",
        lastAccessedAt: "2026-03-01T08:00:00Z",
        needsAttention: true,
      },
      { target: "dev", lastAccessedAt: EPOCH },
    ];
    entries.sort(compareWorktreeEntries("main"));
    expect(
      entries.map(
        (e) => `${e.needsAttention ? "!" : " "}${e.target}:${e.lastAccessedAt}`,
      ),
    ).toEqual([
      "!main:2026-03-01T08:00:00Z",
      "!dev:2026-03-02T10:00:00Z",
      " main:2026-03-05T12:00:00Z",
      " dev:2026-03-04T10:00:00Z",
      " dev:1970-01-01T00:00:00.000Z",
    ]);
  });
});

// ---------------------------------------------------------------------------
// getStatusFromPlan
// ---------------------------------------------------------------------------

describe("getStatusFromPlan", () => {
  it("extracts pending status", () => {
    const content = "# Plan\n\n## Status\npending\n\n## Progress\n";
    expect(getStatusFromPlan(content)).toBe("pending");
  });

  it("extracts in-progress status", () => {
    const content = "# Plan\n\n## Status\nin-progress\n\n## Progress\n";
    expect(getStatusFromPlan(content)).toBe("in-progress");
  });

  it("returns unknown when section is missing", () => {
    const content = "# Plan\n\n## Progress\n- did stuff\n";
    expect(getStatusFromPlan(content)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// getLastProgress
// ---------------------------------------------------------------------------

describe("getLastProgress", () => {
  it("extracts single progress entry", () => {
    const content = "## Progress\n- 2026-01-01 10:00: Started work\n";
    expect(getLastProgress(content)).toBe("2026-01-01 10:00: Started work");
  });

  it("extracts last of multiple entries", () => {
    const content =
      "## Progress\n- 2026-01-01 10:00: First\n- 2026-01-02 09:00: Second\n";
    expect(getLastProgress(content)).toBe("2026-01-02 09:00: Second");
  });

  it("returns null when no progress section", () => {
    const content = "# Plan\n\n## Status\npending\n";
    expect(getLastProgress(content)).toBe(null);
  });

  it("skips HTML comments", () => {
    const content =
      "## Progress\n<!-- Append-only log -->\n- 2026-01-01: Real entry\n";
    expect(getLastProgress(content)).toBe("2026-01-01: Real entry");
  });

  it("returns null when only comments exist", () => {
    const content = "## Progress\n<!-- Append-only log -->\n";
    expect(getLastProgress(content)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// getProgressEntries
// ---------------------------------------------------------------------------

describe("getProgressEntries", () => {
  it("returns all progress entries", () => {
    const content =
      "## Progress\n- 2026-01-01 10:00: First\n- 2026-01-02 09:00: Second\n";
    expect(getProgressEntries(content)).toEqual([
      "2026-01-01 10:00: First",
      "2026-01-02 09:00: Second",
    ]);
  });

  it("returns empty array when no progress section", () => {
    const content = "# Plan\n\n## Status\npending\n";
    expect(getProgressEntries(content)).toEqual([]);
  });

  it("skips HTML comments", () => {
    const content =
      "## Progress\n<!-- log -->\n<!-- more -->\n- 2026-01-01: Entry\n";
    expect(getProgressEntries(content)).toEqual(["2026-01-01: Entry"]);
  });

  it("returns empty array when only comments exist", () => {
    const content = "## Progress\n<!-- Append-only log -->\n";
    expect(getProgressEntries(content)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanForGitRepos
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validateBranchName
// ---------------------------------------------------------------------------

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(validateBranchName("feat/new-feature")).toBeUndefined();
    expect(validateBranchName("fix/bug-123")).toBeUndefined();
    expect(validateBranchName("main")).toBeUndefined();
    expect(validateBranchName("release/v2.0")).toBeUndefined();
  });

  it("rejects empty name", () => {
    expect(validateBranchName("")).toBe("Branch name is required");
  });

  it("rejects leading dash", () => {
    expect(validateBranchName("-bad")).toBe(
      "Branch name cannot start with '-'",
    );
  });

  it("rejects .lock suffix", () => {
    expect(validateBranchName("branch.lock")).toBe(
      "Branch name cannot end with '.lock'",
    );
  });

  it("rejects double dots", () => {
    expect(validateBranchName("a..b")).toBe("Branch name cannot contain '..'");
  });

  it("rejects spaces", () => {
    expect(validateBranchName("bad name")).toBe(
      "Branch name cannot contain spaces",
    );
  });

  it("rejects special characters", () => {
    expect(validateBranchName("a~b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a^b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a:b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a?b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a*b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a[b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a]b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a@{b")).toBe(
      "Branch name contains invalid characters",
    );
    expect(validateBranchName("a\\b")).toBe(
      "Branch name contains invalid characters",
    );
  });
});

// ---------------------------------------------------------------------------
// scanForGitRepos
// ---------------------------------------------------------------------------

describe("scanForGitRepos", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(TEST_TMP, "scantest-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds repos at depth 1", () => {
    mkdirSync(join(tmp, "my-repo", ".git"), { recursive: true });
    const result = scanForGitRepos([tmp]);
    expect(result).toEqual([join(tmp, "my-repo")]);
  });

  it("finds repos at depth 2", () => {
    mkdirSync(join(tmp, "org", "my-repo", ".git"), { recursive: true });
    const result = scanForGitRepos([tmp]);
    expect(result).toEqual([join(tmp, "org", "my-repo")]);
  });

  it("respects maxDepth", () => {
    mkdirSync(join(tmp, "a", "b", "c", ".git"), { recursive: true });
    expect(scanForGitRepos([tmp], 2)).toEqual([]);
    expect(scanForGitRepos([tmp], 3)).toEqual([join(tmp, "a", "b", "c")]);
  });

  it("skips hidden dirs", () => {
    mkdirSync(join(tmp, ".hidden", ".git"), { recursive: true });
    const result = scanForGitRepos([tmp]);
    expect(result).toEqual([]);
  });

  it("deduplicates when same repo found via two scan dirs", () => {
    mkdirSync(join(tmp, "my-repo", ".git"), { recursive: true });
    const result = scanForGitRepos([tmp, tmp]);
    expect(result).toEqual([join(tmp, "my-repo")]);
  });

  it("skips non-existent scan dirs without error", () => {
    const result = scanForGitRepos([join(tmp, "does-not-exist")]);
    expect(result).toEqual([]);
  });

  it("stops descending at .git (no repos-in-repos)", () => {
    mkdirSync(join(tmp, "outer", ".git"), { recursive: true });
    mkdirSync(join(tmp, "outer", "inner", ".git"), { recursive: true });
    const result = scanForGitRepos([tmp]);
    expect(result).toEqual([join(tmp, "outer")]);
  });

  it("returns sorted results", () => {
    mkdirSync(join(tmp, "z-repo", ".git"), { recursive: true });
    mkdirSync(join(tmp, "a-repo", ".git"), { recursive: true });
    const result = scanForGitRepos([tmp]);
    expect(result).toEqual([join(tmp, "a-repo"), join(tmp, "z-repo")]);
  });
});

// ---------------------------------------------------------------------------
// cleanStaleSessionFiles
// ---------------------------------------------------------------------------

describe("cleanStaleSessionFiles", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(TEST_TMP, "cleantest-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("deletes .json files with claudet-worklog- prefix older than 24h", () => {
    const file = join(tmp, "claudet-worklog-abc.json");
    writeFileSync(file, "{}");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(file, twoDaysAgo, twoDaysAgo);

    cleanStaleSessionFiles(tmp);

    expect(readdirSync(tmp)).toEqual([]);
  });

  it("keeps files newer than 24h", () => {
    const file = join(tmp, "claudet-worklog-new.json");
    writeFileSync(file, "{}");

    cleanStaleSessionFiles(tmp);

    expect(readdirSync(tmp)).toEqual(["claudet-worklog-new.json"]);
  });

  it("skips files without the prefix", () => {
    const file = join(tmp, "other-file.json");
    writeFileSync(file, "{}");
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(file, old, old);

    cleanStaleSessionFiles(tmp);

    expect(readdirSync(tmp)).toEqual(["other-file.json"]);
  });

  it("skips non-.json files", () => {
    const file = join(tmp, "claudet-worklog-abc.txt");
    writeFileSync(file, "data");
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(file, old, old);

    cleanStaleSessionFiles(tmp);

    expect(readdirSync(tmp)).toEqual(["claudet-worklog-abc.txt"]);
  });

  it("tolerates files vanishing during iteration (race)", () => {
    // Create and immediately delete — the function reads the dir, then
    // tries to stat each entry. If the entry vanishes, it should not throw.
    const file = join(tmp, "claudet-worklog-gone.json");
    writeFileSync(file, "{}");
    rmSync(file);

    expect(() => cleanStaleSessionFiles(tmp)).not.toThrow();
  });

  it("tolerates unreadable directory", () => {
    expect(() =>
      cleanStaleSessionFiles(join(tmp, "no-such-dir")),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadRepoSlugs
// ---------------------------------------------------------------------------

describe("loadRepoSlugs", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(TEST_TMP, "slugtest-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty array when repos/ doesn't exist", () => {
    expect(loadRepoSlugs(tmp)).toEqual([]);
  });

  it("returns slugs for directories with meta.json", () => {
    mkdirSync(join(tmp, "repos", "org--project"), { recursive: true });
    writeFileSync(join(tmp, "repos", "org--project", "meta.json"), "{}");
    mkdirSync(join(tmp, "repos", "foo--bar"), { recursive: true });
    writeFileSync(join(tmp, "repos", "foo--bar", "meta.json"), "{}");

    const result = loadRepoSlugs(tmp);
    expect(result.sort()).toEqual(["foo--bar", "org--project"]);
  });

  it("filters out files (non-directories)", () => {
    mkdirSync(join(tmp, "repos"), { recursive: true });
    writeFileSync(join(tmp, "repos", "stray-file"), "oops");
    mkdirSync(join(tmp, "repos", "valid--repo"));
    writeFileSync(join(tmp, "repos", "valid--repo", "meta.json"), "{}");

    expect(loadRepoSlugs(tmp)).toEqual(["valid--repo"]);
  });

  it("handles entries that vanish between readdir and stat", () => {
    // Directory with no meta.json → filtered out, but shouldn't throw
    mkdirSync(join(tmp, "repos", "ghost--repo"), { recursive: true });
    // No meta.json → will be filtered by existsSync check, not an error

    expect(() => loadRepoSlugs(tmp)).not.toThrow();
    expect(loadRepoSlugs(tmp)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeWorklogHooks
// ---------------------------------------------------------------------------

describe("mergeWorklogHooks", () => {
  it("adds hooks when none exist", () => {
    const { settings, changed } = mergeWorklogHooks({});

    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { type: string; command: string; timeout: number }[] }[]
    >;
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionStart[0].hooks[0].command).toBe(
      "claudet worklog start",
    );
    expect(hooks.Stop).toHaveLength(1);
    expect(hooks.Stop[0].hooks[0].command).toBe("claudet worklog tick");
  });

  it("detects existing hooks and doesn't duplicate", () => {
    const initial = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "claudet worklog start",
                timeout: 10,
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              { type: "command", command: "claudet worklog tick", timeout: 10 },
            ],
          },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(initial);

    expect(changed).toBe(false);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { type: string; command: string; timeout: number }[] }[]
    >;
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.Stop).toHaveLength(1);
  });

  it("migrates legacy root-level hooks to hooks object", () => {
    const initial = {
      permissions: { allow: [] },
      SessionStart: [
        {
          hooks: [
            { type: "command", command: "claudet worklog start", timeout: 10 },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            { type: "command", command: "claudet worklog tick", timeout: 10 },
          ],
        },
      ],
    };
    const { settings, changed } = mergeWorklogHooks(
      initial as Record<string, unknown>,
    );
    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { command: string }[] }[]
    >;
    expect(hooks.SessionStart[0].hooks[0].command).toBe(
      "claudet worklog start",
    );
    expect(hooks.Stop[0].hooks[0].command).toBe("claudet worklog tick");
    expect(settings).not.toHaveProperty("SessionStart");
    expect(settings).not.toHaveProperty("Stop");
    expect(settings).toHaveProperty("permissions");
  });

  it("merges into settings with other existing hooks", () => {
    const initial = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "some-other-tool start", timeout: 5 },
            ],
          },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(initial);

    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { type: string; command: string; timeout: number }[] }[]
    >;
    // Original hook preserved
    expect(hooks.SessionStart).toHaveLength(2);
    expect(hooks.SessionStart[0].hooks[0].command).toBe(
      "some-other-tool start",
    );
    // Our hook added
    expect(hooks.SessionStart[1].hooks[0].command).toBe(
      "claudet worklog start",
    );
    // Stop added fresh
    expect(hooks.Stop).toHaveLength(1);
  });

  it("migrates flat HookDefinition entries to matcher groups", () => {
    const initial = {
      hooks: {
        SessionStart: [
          { type: "command", command: "claudet worklog start", timeout: 10 },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(
      initial as Record<string, unknown>,
    );

    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { command: string }[] }[]
    >;
    // Flat entry was wrapped into a matcher group
    expect(hooks.SessionStart[0]).toHaveProperty("hooks");
    expect(hooks.SessionStart[0].hooks[0].command).toBe(
      "claudet worklog start",
    );
    // Validates against the schema
    expect(() => HooksConfigSchema.parse(settings.hooks)).not.toThrow();
  });

  it("deduplicates after migration", () => {
    const initial = {
      hooks: {
        SessionStart: [
          // Flat entry (legacy)
          { type: "command", command: "claudet worklog start", timeout: 10 },
          // Matcher group (correct, duplicate)
          {
            hooks: [
              {
                type: "command",
                command: "claudet worklog start",
                timeout: 10,
              },
            ],
          },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(
      initial as Record<string, unknown>,
    );

    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<
      string,
      { hooks: { command: string }[] }[]
    >;
    // Only one matcher group should remain after migration + dedup
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionStart[0].hooks[0].command).toBe(
      "claudet worklog start",
    );
  });

  it("handles mixed flat and matcher-group entries from different tools", () => {
    const initial = {
      hooks: {
        SessionStart: [
          // Flat entry from another tool
          { type: "command", command: "other-tool init", timeout: 5 },
          // Our matcher group
          {
            hooks: [
              {
                type: "command",
                command: "claudet worklog start",
                timeout: 10,
              },
            ],
          },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(
      initial as Record<string, unknown>,
    );

    expect(changed).toBe(true); // flat entry was migrated
    const hooks = settings.hooks as Record<
      string,
      { hooks: { command: string }[] }[]
    >;
    // Both survive — different commands
    expect(hooks.SessionStart).toHaveLength(2);
    const commands = hooks.SessionStart.map((g) => g.hooks[0].command);
    expect(commands).toContain("other-tool init");
    expect(commands).toContain("claudet worklog start");
    // All entries are valid matcher groups
    expect(() => HooksConfigSchema.parse(settings.hooks)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// E2E: compilation / startup smoke test
// ---------------------------------------------------------------------------

describe("e2e smoke test", () => {
  const projectRoot = join(import.meta.dirname!, "..");
  let sandboxHome: string;

  beforeEach(() => {
    sandboxHome = mkdtempSync(join(tmpdir(), "claudet-e2e-"));
  });

  afterEach(() => {
    rmSync(sandboxHome, { recursive: true, force: true });
  });

  it("compiles and runs --help without error", () => {
    const result = execSync("pnpm exec tsx src/claudet.ts --help", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: sandboxHome },
    });
    expect(result).toContain("claudet");
  });

  it("passes typecheck with no errors", () => {
    execSync("pnpm typecheck", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 60_000,
    });
  });

  it("passes format check", () => {
    execSync("pnpm format:check", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 30_000,
    });
  });
});

// ---------------------------------------------------------------------------
// upsertPlanSection
// ---------------------------------------------------------------------------

describe("upsertPlanSection", () => {
  const plan = [
    "# My Plan",
    "",
    "## Target Branch",
    "dev",
    "",
    "## Key Files",
    "- src/foo.ts",
    "",
    "## Status",
    "pending",
    "",
    "## Progress",
    "- entry 1",
    "",
  ].join("\n");

  it("inserts a new section after the anchor", () => {
    const result = upsertPlanSection(
      plan,
      "Branch",
      "feature/my-branch",
      "Target Branch",
    );
    expect(result).toContain("## Branch\nfeature/my-branch\n");
    // Should appear between Target Branch and Key Files
    const branchIdx = result.indexOf("## Branch");
    const targetIdx = result.indexOf("## Target Branch");
    const keyFilesIdx = result.indexOf("## Key Files");
    expect(branchIdx).toBeGreaterThan(targetIdx);
    expect(branchIdx).toBeLessThan(keyFilesIdx);
  });

  it("updates an existing section", () => {
    const withBranch = upsertPlanSection(
      plan,
      "Branch",
      "feature/old",
      "Target Branch",
    );
    const updated = upsertPlanSection(
      withBranch,
      "Branch",
      "feature/new",
      "Target Branch",
    );
    expect(updated).toContain("## Branch\nfeature/new\n");
    expect(updated).not.toContain("feature/old");
    // Only one Branch heading
    expect(updated.match(/## Branch/g)?.length).toBe(1);
  });

  it("removes a section when body is null", () => {
    const withBranch = upsertPlanSection(
      plan,
      "Branch",
      "feature/x",
      "Target Branch",
    );
    expect(withBranch).toContain("## Branch");
    const removed = upsertPlanSection(
      withBranch,
      "Branch",
      null,
      "Target Branch",
    );
    expect(removed).not.toContain("## Branch");
    // Other sections remain
    expect(removed).toContain("## Target Branch");
    expect(removed).toContain("## Key Files");
    expect(removed).toContain("## Status");
  });

  it("returns content unchanged when anchor not found", () => {
    const result = upsertPlanSection(
      plan,
      "Branch",
      "feature/x",
      "Nonexistent",
    );
    expect(result).toBe(plan);
  });

  it("removes non-existent section without error", () => {
    const result = upsertPlanSection(plan, "Branch", null, "Target Branch");
    expect(result).toBe(plan);
  });

  it("handles multi-line section body", () => {
    const body =
      "- **Number:** #42\n- **State:** OPEN\n- **URL:** https://github.com/pr/42";
    const result = upsertPlanSection(plan, "PR", body, "Target Branch");
    expect(result).toContain("## PR\n" + body + "\n");
  });

  it("is idempotent for same content", () => {
    const once = upsertPlanSection(
      plan,
      "Branch",
      "feature/x",
      "Target Branch",
    );
    const twice = upsertPlanSection(
      once,
      "Branch",
      "feature/x",
      "Target Branch",
    );
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// getTargetFromPlan
// ---------------------------------------------------------------------------

describe("getTargetFromPlan", () => {
  it("extracts target branch value", () => {
    const content = "## Target Branch\nmain\n\n## Status\npending\n";
    expect(getTargetFromPlan(content)).toBe("main");
  });

  it("returns 'unknown' when section missing", () => {
    expect(getTargetFromPlan("## Status\npending\n")).toBe("unknown");
  });

  it("trims whitespace", () => {
    const content = "## Target Branch\n  dev  \n\n## Status\npending\n";
    expect(getTargetFromPlan(content)).toBe("dev");
  });
});

// ---------------------------------------------------------------------------
// getBranchFromPlan
// ---------------------------------------------------------------------------

describe("getBranchFromPlan", () => {
  it("extracts branch value", () => {
    const content = "## Branch\nfeature/foo\n\n## Status\npending\n";
    expect(getBranchFromPlan(content)).toBe("feature/foo");
  });

  it("returns 'unknown' when section missing", () => {
    expect(getBranchFromPlan("## Status\npending\n")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// getPlanSection
// ---------------------------------------------------------------------------

describe("getPlanSection", () => {
  it("extracts section content", () => {
    const content =
      "## Context\nThis is why we do it.\n\n## Objective\nBuild the thing.\n";
    expect(getPlanSection(content, "Context")).toBe("This is why we do it.");
    expect(getPlanSection(content, "Objective")).toBe("Build the thing.");
  });

  it("returns null when section missing", () => {
    expect(getPlanSection("## Status\npending\n", "Context")).toBe(null);
  });

  it("strips comment placeholders", () => {
    const content =
      "## Context\n<!-- Why this change is being made -->\n\n## Status\npending\n";
    expect(getPlanSection(content, "Context")).toBe(null);
  });

  it("strips comments but keeps real content", () => {
    const content =
      "## Context\n<!-- placeholder -->\nActual context here.\n\n## Status\npending\n";
    expect(getPlanSection(content, "Context")).toBe("Actual context here.");
  });

  it("handles multiline section content", () => {
    const content =
      "## Context\nLine one.\nLine two.\n\n## Objective\nDo stuff.\n";
    expect(getPlanSection(content, "Context")).toBe("Line one.\nLine two.");
  });

  it("finds heading at the very start of the file", () => {
    const content = "## Context\nFirst section content\n\n## Other\nStuff\n";
    expect(getPlanSection(content, "Context")).toBe("First section content");
  });

  it("extracts last section at EOF without trailing newline", () => {
    const content = "## Stuff\nBefore\n\n## Context\nAt the end";
    expect(getPlanSection(content, "Context")).toBe("At the end");
  });

  it("returns null for whitespace-only body", () => {
    const content = "## Context\n   \n\n## Other\nStuff\n";
    expect(getPlanSection(content, "Context")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// computeWorklogEvents
// ---------------------------------------------------------------------------

describe("computeWorklogEvents", () => {
  const baseState = {
    slug: "org--repo",
    plan: "my-plan",
    branch: "feature/test",
    target: "dev",
    context: null as string | null,
    objective: null as string | null,
    progressCount: 0,
  };

  const now = 1700000000000;

  function makePlan(opts: {
    status?: string;
    context?: string;
    objective?: string;
    progress?: string[];
  }): string {
    const lines = [
      "# my-plan",
      "",
      "## Context",
      opts.context ?? "<!-- placeholder -->",
      "",
      "## Objective",
      opts.objective ?? "<!-- placeholder -->",
      "",
      "## Status",
      opts.status ?? "in-progress",
      "",
      "## Progress",
      "<!-- log -->",
    ];
    if (opts.progress) {
      for (const p of opts.progress) lines.push(`- ${p}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  it("promotes pending → in-progress, emits plan_accepted", () => {
    const plan = makePlan({
      status: "pending",
      context: "Why",
      objective: "What",
    });
    const result = computeWorklogEvents(baseState, plan, now);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].event).toBe("plan_accepted");
    expect(result.events[0].context).toBe("Why");
    expect(result.events[0].objective).toBe("What");
    expect(result.updatedPlanContent).not.toBeNull();
    expect(result.updatedPlanContent).toContain("in-progress");
    expect(result.stateUpdates.context).toBe("Why");
    expect(result.stateUpdates.objective).toBe("What");
  });

  it("does not promote already in-progress", () => {
    const plan = makePlan({
      status: "in-progress",
      context: "Why",
      objective: "What",
    });
    const state = { ...baseState, context: "Why", objective: "What" };
    const result = computeWorklogEvents(state, plan, now);

    expect(result.events).toHaveLength(0);
    expect(result.updatedPlanContent).toBeNull();
  });

  it("detects context change → emits plan_updated", () => {
    const plan = makePlan({ context: "New context", objective: "Same" });
    const state = { ...baseState, context: "Old context", objective: "Same" };
    const result = computeWorklogEvents(state, plan, now);

    const updateEvents = result.events.filter(
      (e) => e.event === "plan_updated",
    );
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0].context).toBe("New context");
  });

  it("detects objective change → emits plan_updated", () => {
    const plan = makePlan({ context: "Same", objective: "New objective" });
    const state = { ...baseState, context: "Same", objective: "Old objective" };
    const result = computeWorklogEvents(state, plan, now);

    const updateEvents = result.events.filter(
      (e) => e.event === "plan_updated",
    );
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0].objective).toBe("New objective");
  });

  it("no plan_updated when nothing changed", () => {
    const plan = makePlan({ context: "Same", objective: "Same" });
    const state = { ...baseState, context: "Same", objective: "Same" };
    const result = computeWorklogEvents(state, plan, now);

    expect(
      result.events.filter((e) => e.event === "plan_updated"),
    ).toHaveLength(0);
  });

  it("skips plan_updated when plan_accepted just fired", () => {
    const plan = makePlan({
      status: "pending",
      context: "New",
      objective: "New",
    });
    const state = { ...baseState, context: "Old", objective: "Old" };
    const result = computeWorklogEvents(state, plan, now);

    expect(
      result.events.filter((e) => e.event === "plan_accepted"),
    ).toHaveLength(1);
    expect(
      result.events.filter((e) => e.event === "plan_updated"),
    ).toHaveLength(0);
  });

  it("detects new progress entries → emits progress events", () => {
    const plan = makePlan({
      progress: [
        "2026-03-01: Started",
        "2026-03-02: Continued",
        "2026-03-03: Almost done",
      ],
    });
    const state = {
      ...baseState,
      context: null,
      objective: null,
      progressCount: 1,
    };
    const result = computeWorklogEvents(state, plan, now);

    const progressEvents = result.events.filter((e) => e.event === "progress");
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].message).toBe("2026-03-02: Continued");
    expect(progressEvents[1].message).toBe("2026-03-03: Almost done");
  });

  it("no progress events when count matches", () => {
    const plan = makePlan({
      progress: ["2026-03-01: Started"],
    });
    const state = {
      ...baseState,
      context: null,
      objective: null,
      progressCount: 1,
    };
    const result = computeWorklogEvents(state, plan, now);

    expect(result.events.filter((e) => e.event === "progress")).toHaveLength(0);
  });

  it("progressCount never decreases (Math.max)", () => {
    const plan = makePlan({}); // no progress entries
    const state = {
      ...baseState,
      context: null,
      objective: null,
      progressCount: 5,
    };
    const result = computeWorklogEvents(state, plan, now);

    expect(result.stateUpdates.progressCount).toBe(5);
  });

  it("empty plan content → no events", () => {
    const result = computeWorklogEvents(baseState, "", now);

    expect(result.events).toHaveLength(0);
    expect(result.updatedPlanContent).toBeNull();
    expect(result.stateUpdates).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// statusBadge
// ---------------------------------------------------------------------------

const noColors: Colors = pico.createColors(false);

describe("statusBadge", () => {
  it("in-progress → yellow (passthrough with noColors)", () => {
    expect(statusBadge("in-progress", 0, noColors)).toBe("in-progress");
  });

  it("in-review → blue", () => {
    expect(statusBadge("in-review", 0, noColors)).toBe("in-review");
  });

  it("done → green", () => {
    expect(statusBadge("done", 0, noColors)).toBe("done");
  });

  it("merged → green", () => {
    expect(statusBadge("merged", 0, noColors)).toBe("merged");
  });

  it("pending → dim", () => {
    expect(statusBadge("pending", 0, noColors)).toBe("pending");
  });

  it("pads text to requested width", () => {
    const result = statusBadge("done", 15, noColors);
    expect(result).toBe("done".padEnd(15));
    expect(result.length).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// reviewSuffix
// ---------------------------------------------------------------------------

describe("reviewSuffix", () => {
  const makePR = (overrides: Partial<PRStatus> = {}): PRStatus => ({
    state: "OPEN",
    url: "https://github.com/test/test/pull/42",
    number: 42,
    mergeable: "MERGEABLE",
    reviewDecision: "NONE",
    ...overrides,
  });

  it("APPROVED → ✓ approved", () => {
    expect(reviewSuffix(makePR({ reviewDecision: "APPROVED" }), noColors)).toBe(
      "✓ approved",
    );
  });

  it("CHANGES_REQUESTED → ⚠ changes requested", () => {
    expect(
      reviewSuffix(makePR({ reviewDecision: "CHANGES_REQUESTED" }), noColors),
    ).toBe("⚠ changes requested");
  });

  it("REVIEW_REQUESTED → ⏳ review pending", () => {
    expect(
      reviewSuffix(makePR({ reviewDecision: "REVIEW_REQUESTED" }), noColors),
    ).toBe("⏳ review pending");
  });

  it("NONE → empty string", () => {
    expect(reviewSuffix(makePR({ reviewDecision: "NONE" }), noColors)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// prStateLabel
// ---------------------------------------------------------------------------

describe("prStateLabel", () => {
  const makePR = (overrides: Partial<PRStatus> = {}): PRStatus => ({
    state: "OPEN",
    url: "https://github.com/test/test/pull/42",
    number: 42,
    mergeable: "MERGEABLE",
    reviewDecision: "NONE",
    ...overrides,
  });

  it("OPEN + CONFLICTING → conflicts", () => {
    expect(prStateLabel(makePR({ mergeable: "CONFLICTING" }))).toBe(
      "conflicts",
    );
  });

  it("OPEN + MERGEABLE → open", () => {
    expect(prStateLabel(makePR())).toBe("open");
  });

  it("MERGED → merged", () => {
    expect(prStateLabel(makePR({ state: "MERGED" }))).toBe("merged");
  });

  it("CLOSED → closed", () => {
    expect(prStateLabel(makePR({ state: "CLOSED" }))).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// prBadge
// ---------------------------------------------------------------------------

describe("prBadge", () => {
  const makePR = (overrides: Partial<PRStatus> = {}): PRStatus => ({
    state: "OPEN",
    url: "https://github.com/test/test/pull/42",
    number: 42,
    mergeable: "MERGEABLE",
    reviewDecision: "NONE",
    ...overrides,
  });

  it("null → no PR", () => {
    expect(prBadge(null, noColors)).toBe("no PR");
  });

  it("open PR → PR #N open + review suffix", () => {
    const result = prBadge(
      makePR({ reviewDecision: "REVIEW_REQUESTED" }),
      noColors,
    );
    expect(result).toContain("PR #42 open");
    expect(result).toContain("⏳ review pending");
  });

  it("conflicting PR → PR #N conflicts + review suffix", () => {
    const result = prBadge(
      makePR({ mergeable: "CONFLICTING", reviewDecision: "APPROVED" }),
      noColors,
    );
    expect(result).toContain("PR #42 conflicts");
    expect(result).toContain("✓ approved");
  });

  it("merged PR → PR #N merged (no review suffix)", () => {
    const result = prBadge(makePR({ state: "MERGED" }), noColors);
    expect(result).toBe("PR #42 merged");
  });

  it("closed PR → PR #N closed (no review suffix)", () => {
    const result = prBadge(makePR({ state: "CLOSED" }), noColors);
    expect(result).toBe("PR #42 closed");
  });
});

// ---------------------------------------------------------------------------
// generatePlanContent
// ---------------------------------------------------------------------------

describe("generatePlanContent", () => {
  it("includes all sections in order", () => {
    const content = generatePlanContent("my-plan", {}, "2026-03-27", "10:00");
    const sections = [...content.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual([
      "Context",
      "Objective",
      "Target Branch",
      "Key Files",
      "Test Scenarios",
      "Status",
      "Time Tracked",
      "Progress",
    ]);
  });

  it("includes Ticket section when provided", () => {
    const content = generatePlanContent(
      "my-plan",
      { ticket: "PROJ-123" },
      "2026-03-27",
      "10:00",
    );
    expect(content).toContain("## Ticket\nPROJ-123");
  });

  it("omits Ticket section when absent", () => {
    const content = generatePlanContent("my-plan", {}, "2026-03-27", "10:00");
    expect(content).not.toContain("## Ticket");
  });

  it("uses provided target; defaults to dev when absent", () => {
    const withTarget = generatePlanContent(
      "my-plan",
      { target: "main" },
      "2026-03-27",
      "10:00",
    );
    expect(withTarget).toContain("## Target Branch\nmain");

    const withoutTarget = generatePlanContent(
      "my-plan",
      {},
      "2026-03-27",
      "10:00",
    );
    expect(withoutTarget).toContain("## Target Branch\ndev");
  });
});

// ---------------------------------------------------------------------------
// matchesSearch
// ---------------------------------------------------------------------------

describe("matchesSearch", () => {
  it("matches exact string", () => {
    expect(matchesSearch("hello", "hello")).toBe(true);
  });

  it("matches substring (case-insensitive)", () => {
    expect(matchesSearch("DEV", "feature/dev-branch")).toBe(true);
  });

  it("returns false for no match", () => {
    expect(matchesSearch("xyz", "hello", "world")).toBe(false);
  });

  it("matches against any of multiple targets", () => {
    expect(matchesSearch("world", "hello", "world")).toBe(true);
    expect(matchesSearch("hello", "hello", "world")).toBe(true);
  });

  it("empty search matches everything", () => {
    expect(matchesSearch("", "anything")).toBe(true);
  });

  it("handles special regex characters safely", () => {
    expect(matchesSearch("(foo)", "prefix(foo)suffix")).toBe(true);
    expect(matchesSearch("[bar]", "has[bar]inside")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sortBranchesDefaultFirst
// ---------------------------------------------------------------------------

describe("sortBranchesDefaultFirst", () => {
  it("moves default branch to front", () => {
    expect(sortBranchesDefaultFirst(["a", "main", "b"], "main")).toEqual([
      "main",
      "a",
      "b",
    ]);
  });

  it("returns branches unchanged when default not present", () => {
    const branches = ["a", "b", "c"];
    expect(sortBranchesDefaultFirst(branches, "main")).toEqual(["a", "b", "c"]);
  });

  it("handles single-element array", () => {
    expect(sortBranchesDefaultFirst(["main"], "main")).toEqual(["main"]);
  });

  it("doesn't duplicate the default branch", () => {
    const result = sortBranchesDefaultFirst(["main", "dev", "feat"], "main");
    expect(result.filter((b) => b === "main")).toHaveLength(1);
    expect(result).toEqual(["main", "dev", "feat"]);
  });
});
