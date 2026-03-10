// ---------------------------------------------------------------------------
// Pure helper functions extracted from claudet.ts for testability
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { z } from "zod";

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
// Context doc helpers
// ---------------------------------------------------------------------------

const MARKER_START = "<!-- claudet:start -->";
const MARKER_END = "<!-- claudet:end -->";

export function computeContextHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function managedSectionReplace(
  claudeMd: string,
  section: string,
): string {
  const block = `${MARKER_START}\n${section}\n${MARKER_END}`;
  const startIdx = claudeMd.indexOf(MARKER_START);
  const endIdx = claudeMd.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const sep = claudeMd.length > 0 && !claudeMd.endsWith("\n") ? "\n\n" : "\n";
    return claudeMd + sep + block + "\n";
  }

  return (
    claudeMd.slice(0, startIdx) +
    block +
    claudeMd.slice(endIdx + MARKER_END.length)
  );
}

export function managedSectionExtract(claudeMd: string): string | null {
  const startIdx = claudeMd.indexOf(MARKER_START);
  const endIdx = claudeMd.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const inner = claudeMd.slice(startIdx + MARKER_START.length, endIdx).trim();
  return inner || null;
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
// Review decision helpers
// ---------------------------------------------------------------------------

export type ReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUESTED"
  | "NONE";

export interface ReviewInfo {
  user: string;
  state: string;
}

export function computeReviewDecision(
  reviews: ReviewInfo[],
  requestedReviewerCount: number,
): ReviewDecision {
  const tracked = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
  const latest = new Map<string, string>();
  for (const r of reviews) {
    if (tracked.has(r.state)) {
      latest.set(r.user, r.state);
    }
  }

  for (const state of latest.values()) {
    if (state === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  }
  if (requestedReviewerCount > 0) return "REVIEW_REQUESTED";
  for (const state of latest.values()) {
    if (state === "APPROVED") return "APPROVED";
  }
  return "NONE";
}

export function prNeedsAttention(
  pr: {
    mergeable: string;
    reviewDecision: ReviewDecision;
    state: string;
  } | null,
): boolean {
  if (!pr || pr.state !== "OPEN") return false;
  return (
    pr.mergeable === "CONFLICTING" || pr.reviewDecision === "CHANGES_REQUESTED"
  );
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

// ---------------------------------------------------------------------------
// Worktree sort helpers
// ---------------------------------------------------------------------------

export interface WorktreeSortEntry {
  target: string;
  lastAccessedAt: string;
  needsAttention?: boolean;
}

export function compareWorktreeEntries(
  highPriorityTarget: string,
): (a: WorktreeSortEntry, b: WorktreeSortEntry) => number {
  return (a, b) => {
    const aAttn = a.needsAttention ? 0 : 1;
    const bAttn = b.needsAttention ? 0 : 1;
    if (aAttn !== bAttn) return aAttn - bAttn;
    const aHigh = a.target === highPriorityTarget ? 0 : 1;
    const bHigh = b.target === highPriorityTarget ? 0 : 1;
    if (aHigh !== bHigh) return aHigh - bHigh;
    return compareDatesDesc(a.lastAccessedAt, b.lastAccessedAt);
  };
}

export function getProgressEntries(content: string): string[] {
  const progressSection = content.split("## Progress")[1];
  if (!progressSection) return [];
  return progressSection
    .split("\n")
    .filter((l) => l.startsWith("- ") && !l.startsWith("<!-- "))
    .map((l) => l.replace(/^- /, ""));
}

export function getLastProgress(content: string): string | null {
  const entries = getProgressEntries(content);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Git repo discovery
// ---------------------------------------------------------------------------

export function scanForGitRepos(scanDirs: string[], maxDepth = 2): string[] {
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

export interface HookMatcherGroup {
  matcher?: Record<string, unknown>;
  hooks: HookDefinition[];
}

const HookDefinitionSchema = z.object({
  type: z.string(),
  command: z.string(),
  timeout: z.number(),
});

const HookMatcherGroupSchema = z.object({
  matcher: z.record(z.string(), z.unknown()).optional(),
  hooks: z.array(HookDefinitionSchema),
});

export const HooksConfigSchema = z.record(
  z.string(),
  z.array(HookMatcherGroupSchema),
);

export function mergeWorklogHooks(settings: Record<string, unknown>): {
  settings: Record<string, unknown>;
  changed: boolean;
} {
  const requiredHooks: Record<string, HookDefinition> = {
    SessionStart: {
      type: "command",
      command: "claudet worklog start",
      timeout: 10,
    },
    Stop: { type: "command", command: "claudet worklog tick", timeout: 10 },
  };

  const hooks =
    (settings.hooks as Record<string, HookMatcherGroup[]> | undefined) ?? {};
  let changed = false;

  // Migrate flat HookDefinition entries to matcher groups
  for (const event of Object.keys(hooks)) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    hooks[event] = entries.map((entry: any) => {
      if (Array.isArray(entry.hooks)) return entry; // already a matcher group
      if (typeof entry.type === "string" && typeof entry.command === "string") {
        changed = true;
        return { hooks: [entry] }; // wrap flat entry
      }
      return entry; // unknown shape — leave as-is
    });
  }

  // Deduplicate matcher groups by command string within each event
  for (const event of Object.keys(hooks)) {
    const seen = new Set<string>();
    const deduped: HookMatcherGroup[] = [];
    for (const group of hooks[event]) {
      const key = group.hooks?.map((h) => h.command).join("|") ?? "";
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(group);
      } else {
        changed = true;
      }
    }
    hooks[event] = deduped;
  }

  // Add required hooks if missing
  for (const [event, hookDef] of Object.entries(requiredHooks)) {
    const existing: HookMatcherGroup[] = hooks[event] || [];
    const hasOurHook = existing.some((group) =>
      group.hooks?.some(
        (h) => h.type === "command" && h.command === hookDef.command,
      ),
    );

    if (!hasOurHook) {
      existing.push({ hooks: [hookDef] });
      hooks[event] = existing;
      changed = true;
    }
  }

  // Validate final shape before writing
  try {
    const validated = HooksConfigSchema.parse(hooks);
    settings.hooks = validated;
  } catch (err) {
    console.error("mergeWorklogHooks: validation failed, skipping write", err);
    return { settings, changed: false };
  }

  // Migrate legacy root-level hooks
  for (const event of ["SessionStart", "Stop"]) {
    if (Array.isArray(settings[event])) {
      delete settings[event];
      changed = true;
    }
  }

  return { settings, changed };
}
