// ---------------------------------------------------------------------------
// Pure helper functions extracted from claudet.ts for testability
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { z } from "zod";
import type { Colors } from "picocolors/types";

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
// Plan file section helpers
// ---------------------------------------------------------------------------

/**
 * Insert or update a `## Heading` section in a plan file.
 * - If the section already exists, replace its body.
 * - Otherwise insert it right after `afterHeading`'s body (before the next ##).
 * Body is trimmed; pass `null` to remove the section entirely.
 */
export function upsertPlanSection(
  content: string,
  heading: string,
  body: string | null,
  afterHeading: string,
): string {
  // Match existing section: heading line, then everything until next ## or EOF
  const sectionRe = new RegExp(
    `^## ${escapeRegex(heading)}\\s*\\n[\\s\\S]*?(?=\\n## |$)`,
    "m",
  );
  const existing = sectionRe.exec(content);

  if (body === null) {
    // Remove the section if it exists
    if (!existing) return content;
    return (
      content.slice(0, existing.index) +
      content.slice(existing.index + existing[0].length).replace(/^\n/, "")
    );
  }

  const newSection = `## ${heading}\n${body}\n`;

  if (existing) {
    // Replace existing section
    return (
      content.slice(0, existing.index) +
      newSection +
      content.slice(existing.index + existing[0].length).replace(/^\n/, "")
    );
  }

  // Insert after the anchor heading's body (before the next ## heading)
  const anchorRe = new RegExp(
    `^## ${escapeRegex(afterHeading)}\\s*\\n[\\s\\S]*?(?=\\n## )`,
    "m",
  );
  const anchorMatch = anchorRe.exec(content);
  if (!anchorMatch) return content; // anchor not found, leave unchanged

  const insertPos = anchorMatch.index + anchorMatch[0].length;
  return (
    content.slice(0, insertPos) +
    "\n\n" +
    newSection +
    content.slice(insertPos).replace(/^\n+/, "\n")
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// `claudet create` flag parsing
// ---------------------------------------------------------------------------

export interface CreateFlags {
  branch: string;
  target?: string;
  ticket?: string;
  skipSetup: boolean;
  repo?: string;
}

export function parseCreateFlags(argv: string[]): CreateFlags {
  const flags: CreateFlags = { branch: "", skipSetup: false };
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
// `claudet clean` flag parsing
// ---------------------------------------------------------------------------

export interface CleanFlags {
  merged: boolean;
}

export function parseCleanFlags(argv: string[]): CleanFlags {
  const flags: CleanFlags = { merged: false };
  for (const arg of argv) {
    if (arg === "--merged") flags.merged = true;
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

export interface PRStatus {
  state: "OPEN" | "MERGED" | "CLOSED";
  url: string;
  number: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: ReviewDecision;
}

// ---------------------------------------------------------------------------
// UI formatting
// ---------------------------------------------------------------------------

export function statusBadge(status: string, pad = 0, colors: Colors): string {
  const text = pad > 0 ? status.padEnd(pad) : status;
  switch (status) {
    case "in-progress":
      return colors.yellow(text);
    case "in-review":
      return colors.blue(text);
    case "done":
    case "merged":
      return colors.green(text);
    case "pending":
      return colors.dim(text);
    default:
      return colors.dim(text);
  }
}

export function reviewSuffix(pr: PRStatus, colors: Colors): string {
  switch (pr.reviewDecision) {
    case "APPROVED":
      return colors.green("✓ approved");
    case "CHANGES_REQUESTED":
      return colors.yellow("⚠ changes requested");
    case "REVIEW_REQUESTED":
      return colors.dim("⏳ review pending");
    default:
      return "";
  }
}

export function prStateLabel(pr: PRStatus): string {
  if (pr.state === "OPEN" && pr.mergeable === "CONFLICTING") return "conflicts";
  if (pr.state === "OPEN") return "open";
  if (pr.state === "MERGED") return "merged";
  return "closed";
}

export function prBadge(pr: PRStatus | null, colors: Colors): string {
  if (!pr) return colors.dim("no PR");
  const label = prStateLabel(pr);
  const review = pr.state === "OPEN" ? reviewSuffix(pr, colors) : "";
  const reviewPart = review ? `  ${review}` : "";
  const text = `PR #${pr.number} ${label}`;
  switch (label) {
    case "conflicts":
      return colors.red(text) + reviewPart;
    case "open":
      return colors.green(text) + reviewPart;
    case "merged":
      return colors.magenta(text);
    case "closed":
      return colors.red(text);
    default:
      return colors.dim(text);
  }
}

// ---------------------------------------------------------------------------
// Plan content generation
// ---------------------------------------------------------------------------

export function generatePlanContent(
  name: string,
  opts: { target?: string; ticket?: string },
  date: string,
  time: string,
): string {
  const ticketSection = opts.ticket ? `\n## Ticket\n${opts.ticket}\n` : "";
  return `# ${name}

## Context
<!-- Why this change is being made -->

## Objective
<!-- What will be done -->
${ticketSection}
## Target Branch
${opts.target || "dev"}

## Key Files
<!-- Files that will be created/modified -->

## Test Scenarios
<!-- Test plan grouped by tier -->

## Status
pending

## Time Tracked
0m

## Progress
<!-- Append-only log. Claude and user append entries as work progresses. -->
<!-- ALL change requests must be logged here, even when requested outside Claude plan mode. -->
- ${date} ${time}: Created worktree, started planning
`;
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

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { basename, dirname, join, resolve } from "path";

export function deriveRepoSlug(repoRoot: string): string {
  return `${basename(dirname(repoRoot))}--${basename(repoRoot)}`;
}

// ---------------------------------------------------------------------------
// Sandbox settings
// ---------------------------------------------------------------------------

export interface SandboxConfig {
  enabled: boolean;
  allowedDomains: string[];
  extraAllowWrite?: string[];
}

/**
 * Writes `.claude/settings.local.json` inside a worktree with the Claude Code
 * sandbox enabled and `permissions.defaultMode: "bypassPermissions"`. If the
 * destination is a symlink (e.g. into the source repo), the link is
 * materialized first so the source repo is never mutated. Existing unrelated
 * keys (hooks, mcpServers, …) are preserved.
 *
 * Also appends `.claude/settings.local.json` to the git common dir's
 * `info/exclude` so git never shows it as modified.
 */
export function writeWorktreeSandboxSettings(
  wtPath: string,
  sandbox: SandboxConfig | undefined,
): void {
  if (!sandbox?.enabled) return;
  const claudeDir = resolve(wtPath, ".claude");
  const destPath = resolve(claudeDir, "settings.local.json");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(destPath)) {
    const isSymlink = (() => {
      try {
        return lstatSync(destPath).isSymbolicLink();
      } catch {
        return false;
      }
    })();
    try {
      // readFileSync follows symlinks, so this reads the original target.
      existing = tryParseJson<Record<string, unknown>>(
        readFileSync(destPath, "utf-8"),
        {},
      );
    } catch {
      existing = {};
    }
    if (isSymlink) {
      // Materialize: break the symlink so our writes don't propagate back to
      // the source repo.
      unlinkSync(destPath);
    }
  }

  const allowedDomains = sandbox?.allowedDomains ?? [];
  const extraAllowWrite = sandbox?.extraAllowWrite ?? [];
  const worktreesRoot = dirname(wtPath);

  const merged: Record<string, unknown> = {
    ...existing,
    sandbox: {
      enabled: true,
      filesystem: {
        allowWrite: [wtPath, worktreesRoot, ...extraAllowWrite],
      },
      network: { allowedDomains },
      failIfUnavailable: false,
    },
    permissions: {
      ...((existing.permissions as Record<string, unknown> | undefined) ?? {}),
      defaultMode: "bypassPermissions",
    },
  };

  writeFileSync(destPath, JSON.stringify(merged, null, 2) + "\n");

  // Use the common git dir so the exclude entry is shared across worktrees.
  try {
    const gitCommonDir = execFileSync(
      "git",
      ["rev-parse", "--git-common-dir"],
      { cwd: wtPath, encoding: "utf-8" },
    ).trim();
    const excludeDir = resolve(
      gitCommonDir.startsWith("/")
        ? gitCommonDir
        : resolve(wtPath, gitCommonDir),
      "info",
    );
    if (existsSync(excludeDir)) {
      const excludeFile = resolve(excludeDir, "exclude");
      const entry = ".claude/settings.local.json";
      const current = existsSync(excludeFile)
        ? readFileSync(excludeFile, "utf-8")
        : "";
      if (!current.split("\n").some((line) => line.trim() === entry)) {
        const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
        appendFileSync(excludeFile, `${sep}${entry}\n`);
      }
    }
  } catch {
    // Non-fatal: if we can't write to info/exclude the settings file still
    // works — it'll just show up as untracked in `git status`.
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export const TRACKER_PREFIXES = [
  "jira",
  "clickup",
  "linear",
  "github",
] as const;
export type TrackerPrefix = (typeof TRACKER_PREFIXES)[number];

export function composeBranchFromTask(
  tracker: TrackerPrefix,
  taskId: string,
): string {
  return `${tracker}/${taskId}`;
}

export function deriveShortName(branch: string): string {
  return branch
    .replace(/^(feat|fix|chore|feature|test|jira|clickup|linear|github)\//, "")
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

export function getTargetFromPlan(content: string): string {
  const match = content.match(/^## Target Branch\s*\n([^\n#]+)/m);
  return match ? match[1].trim() : "unknown";
}

export function getBranchFromPlan(content: string): string {
  const match = content.match(/^## Branch\s*\n([^\n#]+)/m);
  return match ? match[1].trim() : "unknown";
}

export function getPlanSection(
  content: string,
  heading: string,
): string | null {
  const marker = `## ${heading}`;
  const idx = content.indexOf(`\n${marker}\n`);
  const start =
    idx === -1 ? (content.startsWith(`${marker}\n`) ? 0 : -1) : idx + 1;
  if (start === -1) return null;
  const bodyStart = content.indexOf("\n", start) + 1;
  const nextHeading = content.indexOf("\n## ", bodyStart);
  const body =
    nextHeading === -1
      ? content.slice(bodyStart)
      : content.slice(bodyStart, nextHeading);
  const text = body
    .trim()
    .replace(/^<!--.*?-->\s*/gm, "")
    .trim();
  return text || null;
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

// ---------------------------------------------------------------------------
// computeWorklogEvents — pure decision logic extracted from worklogTick
// ---------------------------------------------------------------------------

export interface WorklogEvent {
  event: string;
  [key: string]: unknown;
}

export interface WorklogTickResult {
  events: WorklogEvent[];
  stateUpdates: {
    context?: string | null;
    objective?: string | null;
    progressCount?: number;
  };
  updatedPlanContent: string | null; // non-null only if pending→in-progress
}

export function computeWorklogEvents(
  state: {
    slug: string;
    plan: string;
    branch: string;
    target: string;
    context: string | null;
    objective: string | null;
    progressCount: number;
  },
  planContent: string,
  now: number,
): WorklogTickResult {
  const events: WorklogEvent[] = [];
  const stateUpdates: WorklogTickResult["stateUpdates"] = {};
  let updatedPlanContent: string | null = null;

  if (!planContent) {
    return { events, stateUpdates, updatedPlanContent };
  }

  let content = planContent;

  // 1. Promote pending → in-progress → emit plan_accepted
  let planAccepted = false;
  const statusMatch = content.match(/^## Status\s*\n([^\n#]+)/m);
  if (statusMatch && statusMatch[1].trim() === "pending") {
    content = content.replace(/^(## Status\s*\n)pending/m, "$1in-progress");
    updatedPlanContent = content;

    const curCtx = getPlanSection(content, "Context");
    const curObj = getPlanSection(content, "Objective");
    events.push({
      event: "plan_accepted",
      timestamp: now,
      datetime: new Date(now).toISOString(),
      plan: state.plan,
      slug: state.slug,
      branch: state.branch,
      target: state.target,
      context: curCtx,
      objective: curObj,
    });
    stateUpdates.context = curCtx;
    stateUpdates.objective = curObj;
    planAccepted = true;
  }

  // 2. Detect context/objective changes (skip if plan_accepted) → emit plan_updated
  if (!planAccepted) {
    const curCtx = getPlanSection(content, "Context");
    const curObj = getPlanSection(content, "Objective");
    if (curCtx !== state.context || curObj !== state.objective) {
      events.push({
        event: "plan_updated",
        timestamp: now,
        datetime: new Date(now).toISOString(),
        plan: state.plan,
        slug: state.slug,
        branch: state.branch,
        target: state.target,
        context: curCtx,
        objective: curObj,
      });
      stateUpdates.context = curCtx;
      stateUpdates.objective = curObj;
    }
  }

  // 3. Detect new progress entries → emit progress events
  const progressEntries = getProgressEntries(content);
  const prevCount = state.progressCount ?? 0;
  if (progressEntries.length > prevCount) {
    const newEntries = progressEntries.slice(prevCount);
    for (const entry of newEntries) {
      events.push({
        event: "progress",
        timestamp: now,
        datetime: new Date(now).toISOString(),
        plan: state.plan,
        slug: state.slug,
        branch: state.branch,
        target: state.target,
        message: entry,
      });
    }
  }

  // 4. Math.max for progressCount
  stateUpdates.progressCount = Math.max(prevCount, progressEntries.length);

  return { events, stateUpdates, updatedPlanContent };
}

// ---------------------------------------------------------------------------
// Progress entry helpers
// ---------------------------------------------------------------------------

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
// Autocomplete / branch selection helpers
// ---------------------------------------------------------------------------

export function matchesSearch(search: string, ...targets: string[]): boolean {
  const s = search.toLowerCase();
  return targets.some((t) => t.toLowerCase().includes(s));
}

export function sortBranchesDefaultFirst(
  branches: string[],
  defaultBranch: string,
): string[] {
  if (!branches.includes(defaultBranch)) return branches;
  return [defaultBranch, ...branches.filter((b) => b !== defaultBranch)];
}

// ---------------------------------------------------------------------------
// Branch name validation
// ---------------------------------------------------------------------------

export function validateBranchName(
  name: string | undefined,
): string | undefined {
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
