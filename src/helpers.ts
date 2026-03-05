// ---------------------------------------------------------------------------
// Pure helper functions extracted from claudet.ts for testability
// ---------------------------------------------------------------------------

const HOME = process.env.HOME || process.env.USERPROFILE || "";

// ---------------------------------------------------------------------------
// JSON / string helpers
// ---------------------------------------------------------------------------

export function tryParseJson<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export function expandHome(input: string): string {
  return input.replace(/^~(?=$|\/)/, HOME);
}

// ---------------------------------------------------------------------------
// `claudet create` flag parsing
// ---------------------------------------------------------------------------

export interface CreateFlags {
  branch: string;
  target?: string;
  ticket?: string;
  draftPR: boolean;
  skipSetup: boolean;
  repo?: string;
}

export function parseCreateFlags(argv: string[]): CreateFlags {
  const flags: CreateFlags = { branch: "", draftPR: false, skipSetup: false };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--branch":
      case "-b":
        flags.branch = argv[++i] ?? "";
        break;
      case "--target":
      case "-t":
        flags.target = argv[++i] ?? "";
        break;
      case "--ticket":
        flags.ticket = argv[++i] ?? "";
        break;
      case "--draft-pr":
        flags.draftPR = true;
        break;
      case "--skip-setup":
        flags.skipSetup = true;
        break;
      case "--repo":
        flags.repo = argv[++i] ?? "";
        break;
      default:
        break;
    }
    i++;
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export function toMergeableStatus(
  m: boolean | null | undefined,
): "MERGEABLE" | "CONFLICTING" | "UNKNOWN" {
  if (m === true) return "MERGEABLE";
  if (m === false) return "CONFLICTING";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

import { basename, dirname } from "path";

export function deriveRepoSlug(repoRoot: string): string {
  return `${basename(dirname(repoRoot))}--${basename(repoRoot)}`;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export function deriveShortName(branch: string): string {
  return branch
    .replace(/^(feat|fix|chore|feature|test)\//, "")
    .replace(/\//g, "-");
}

export function isSmokeTestWorktree(name: string): boolean {
  return (
    name.startsWith("worktree-smoke-") ||
    name.startsWith("test-worktree-smoke-")
  );
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function parseDuration(str: string): number {
  let ms = 0;
  const hourMatch = str.match(/(\d+)h/);
  const minMatch = str.match(/(\d+)m/);
  const secMatch = str.match(/(\d+)s/);
  if (hourMatch) ms += parseInt(hourMatch[1], 10) * 3600000;
  if (minMatch) ms += parseInt(minMatch[1], 10) * 60000;
  if (secMatch) ms += parseInt(secMatch[1], 10) * 1000;
  return ms;
}

// ---------------------------------------------------------------------------
// Plan file content parsing (pure — operates on string content, not files)
// ---------------------------------------------------------------------------

export function getStatusFromPlan(content: string): string {
  const match = content.match(/^## Status\s*\n([^\n#]+)/m);
  return match ? match[1].trim() : "unknown";
}

// ---------------------------------------------------------------------------
// Date comparator
// ---------------------------------------------------------------------------

export function compareDatesDesc(
  a: string | undefined | null,
  b: string | undefined | null,
): number {
  if (a && b) return new Date(b).getTime() - new Date(a).getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
}

export function getLastProgress(content: string): string | null {
  const progressSection = content.split("## Progress")[1];
  if (!progressSection) return null;
  const lines = progressSection
    .split("\n")
    .filter((l) => l.startsWith("- ") && !l.startsWith("<!-- "));
  return lines.length > 0 ? lines[lines.length - 1].replace(/^- /, "") : null;
}
