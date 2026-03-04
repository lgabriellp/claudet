import { describe, expect, it } from "vitest";
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
  getStatusFromPlan,
  getLastProgress,
} from "./helpers.js";

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
    expect(deriveRepoSlug("/home/user/work/org/service")).toBe(
      "org--service",
    );
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
