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

import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";

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

// ---------------------------------------------------------------------------
// Git repo discovery
// ---------------------------------------------------------------------------

export function scanForGitRepos(
  scanDirs: string[],
  maxDepth = 2,
): string[] {
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      if (existsSync(join(dir, ".git"))) {
        found.add(resolve(dir));
        return; // stop descending into discovered repos
      }
      if (depth === maxDepth) return;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue; // skip hidden dirs
        const full = join(dir, entry);
        try {
          if (statSync(full).isDirectory()) {
            walk(full, depth + 1);
          }
        } catch {
          // permission error — skip
        }
      }
    } catch {
      // non-existent or unreadable dir — skip
    }
  }

  for (const raw of scanDirs) {
    const dir = expandHome(raw);
    walk(dir, 0);
  }

  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Branch name validation
// ---------------------------------------------------------------------------

export function validateBranchName(name: string): string | undefined {
  if (!name) return "Branch name is required";
  if (name.startsWith("-")) return "Branch name cannot start with '-'";
  if (name.endsWith(".lock")) return "Branch name cannot end with '.lock'";
  if (name.includes("..")) return "Branch name cannot contain '..'";
  if (name.includes(" ")) return "Branch name cannot contain spaces";
  if (/[~^:\\?*\[\]@{]/.test(name))
    return "Branch name contains invalid characters";
  return undefined;
}

// ---------------------------------------------------------------------------
// Stale session file cleanup
// ---------------------------------------------------------------------------

export function cleanStaleSessionFiles(tmpDir: string): void {
  const prefix = "claudet-worklog-";
  try {
    for (const entry of readdirSync(tmpDir)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(".json")) continue;
      const filePath = join(tmpDir, entry);
      try {
        const stats = statSync(filePath);
        if (Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
          unlinkSync(filePath);
        }
      } catch {
        // file vanished — skip
      }
    }
  } catch {
    // unreadable directory — skip
  }
}

// ---------------------------------------------------------------------------
// Repo slug loading
// ---------------------------------------------------------------------------

export function loadRepoSlugs(dataDir: string): string[] {
  const reposDir = resolve(dataDir, "repos");
  if (!existsSync(reposDir)) return [];
  return readdirSync(reposDir).filter((entry) => {
    const entryPath = resolve(reposDir, entry);
    try {
      return (
        statSync(entryPath).isDirectory() &&
        existsSync(resolve(reposDir, entry, "meta.json"))
      );
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Worklog hooks merge logic
// ---------------------------------------------------------------------------

export interface HookDefinition {
  type: string;
  command: string;
  timeout: number;
}

export interface HookMatcher {
  hooks?: HookDefinition[];
  [key: string]: unknown;
}

export function mergeWorklogHooks(
  settings: Record<string, HookMatcher[]>,
): { settings: Record<string, HookMatcher[]>; changed: boolean } {
  const requiredHooks: Record<string, HookDefinition> = {
    SessionStart: {
      type: "command",
      command: "claudet worklog start",
      timeout: 10,
    },
    Stop: { type: "command", command: "claudet worklog tick", timeout: 10 },
  };

  let changed = false;

  for (const [event, hookDef] of Object.entries(requiredHooks)) {
    const existing: HookMatcher[] = settings[event] || [];
    const hasOurHook = existing.some((matcher) =>
      (matcher.hooks || []).some(
        (h) => h.type === "command" && h.command === hookDef.command,
      ),
    );

    if (!hasOurHook) {
      existing.push({ hooks: [hookDef] });
      settings[event] = existing;
      changed = true;
    }
  }

  return { settings, changed };
}
