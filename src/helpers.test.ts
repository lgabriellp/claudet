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
import {
  tryParseJson,
  expandHome,
  toMergeableStatus,
  deriveRepoSlug,
  deriveShortName,
  isSmokeTestWorktree,
  parseCreateFlags,
  formatDuration,
  parseDuration,
  compareDatesDesc,
  getStatusFromPlan,
  getLastProgress,
  scanForGitRepos,
  validateBranchName,
  cleanStaleSessionFiles,
  loadRepoSlugs,
  mergeWorklogHooks,
  compareWorktreeEntries,
  computeReviewDecision,
  prNeedsAttention,
  type WorktreeSortEntry,
  type ReviewInfo,
} from "./helpers.js";

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
      "--draft-pr",
      "--skip-setup",
      "--repo",
      "/path/to/repo",
    ]);
    expect(result).toEqual({
      branch: "feat/x",
      target: "main",
      ticket: "PROJ-123",
      draftPR: true,
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
    expect(result.draftPR).toBe(false);
    expect(result.skipSetup).toBe(false);
  });

  it("handles mixed order", () => {
    const result = parseCreateFlags([
      "--draft-pr",
      "-b",
      "feat/z",
      "--ticket",
      "T-1",
    ]);
    expect(result.branch).toBe("feat/z");
    expect(result.ticket).toBe("T-1");
    expect(result.draftPR).toBe(true);
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
      { type: string; command: string; timeout: number }[]
    >;
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionStart[0].command).toBe("claudet worklog start");
    expect(hooks.Stop).toHaveLength(1);
    expect(hooks.Stop[0].command).toBe("claudet worklog tick");
  });

  it("detects existing hooks and doesn't duplicate", () => {
    const initial = {
      hooks: {
        SessionStart: [
          { type: "command", command: "claudet worklog start", timeout: 10 },
        ],
        Stop: [
          { type: "command", command: "claudet worklog tick", timeout: 10 },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(initial);

    expect(changed).toBe(false);
    const hooks = settings.hooks as Record<
      string,
      { type: string; command: string; timeout: number }[]
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
    const hooks = settings.hooks as Record<string, { command: string }[]>;
    expect(hooks.SessionStart[0].command).toBe("claudet worklog start");
    expect(hooks.Stop[0].command).toBe("claudet worklog tick");
    expect(settings).not.toHaveProperty("SessionStart");
    expect(settings).not.toHaveProperty("Stop");
    expect(settings).toHaveProperty("permissions");
  });

  it("merges into settings with other existing hooks", () => {
    const initial = {
      hooks: {
        SessionStart: [
          { type: "command", command: "some-other-tool start", timeout: 5 },
        ],
      },
    };

    const { settings, changed } = mergeWorklogHooks(initial);

    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<
      string,
      { type: string; command: string; timeout: number }[]
    >;
    // Original hook preserved
    expect(hooks.SessionStart).toHaveLength(2);
    expect(hooks.SessionStart[0].command).toBe("some-other-tool start");
    // Our hook added
    expect(hooks.SessionStart[1].command).toBe("claudet worklog start");
    // Stop added fresh
    expect(hooks.Stop).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// E2E: compilation / startup smoke test
// ---------------------------------------------------------------------------

describe("e2e smoke test", () => {
  const projectRoot = join(import.meta.dirname!, "..");

  it("compiles and runs --help without error", () => {
    const result = execSync("pnpm exec tsx src/claudet.ts --help", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 30_000,
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
