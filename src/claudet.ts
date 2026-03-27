import { execFileSync, execSync, spawn } from "child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import * as p from "@clack/prompts";
import pc from "picocolors";
import simpleGit, { type SimpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import {
  tryParseJson,
  expandHome,
  toMergeableStatus,
  deriveRepoSlug,
  deriveShortName,
  composeBranchFromTask,
  TRACKER_PREFIXES,
  type TrackerPrefix,
  isSmokeTestWorktree,
  parseCreateFlags,
  formatDuration,
  parseDuration,
  compareDatesDesc,
  getStatusFromPlan as getStatusFromPlanContent,
  getProgressEntries as getProgressEntriesContent,
  getLastProgress as getLastProgressContent,
  scanForGitRepos,
  validateBranchName,
  cleanStaleSessionFiles,
  loadRepoSlugs,
  mergeWorklogHooks,
  computeContextHash,
  managedSectionReplace,
  managedSectionExtract,
  compareWorktreeEntries,
  computeReviewDecision,
  prNeedsAttention,
  statusBadge,
  reviewSuffix,
  prStateLabel,
  prBadge,
  generatePlanContent,
  type PRStatus,
  upsertPlanSection,
  getTargetFromPlan,
  getBranchFromPlan,
  getPlanSection,
  computeWorklogEvents,
  matchesSearch,
  sortBranchesDefaultFirst,
  parseCleanFlags,
  type CleanFlags,
  type CreateFlags,
  type HookDefinition,
  type HookMatcherGroup,
  type ReviewDecision,
  type ReviewInfo,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
let PKG_VERSION: string;
try {
  PKG_VERSION = JSON.parse(
    readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
  ).version;
} catch {
  PKG_VERSION = "unknown";
}

const HOME = process.env.HOME || process.env.USERPROFILE || "";
if (!HOME) {
  console.error(
    "Fatal: HOME (or USERPROFILE) environment variable is not set.",
  );
  process.exit(1);
}
const GLOBAL_SETTINGS_FILE = resolve(HOME, ".claude", "settings.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runLoud(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function bail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}

function cancelled(value: unknown): value is symbol {
  return p.isCancel(value);
}

function tryReadFileSync(filePath: string, fallback = ""): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Configuration & path resolution
// ---------------------------------------------------------------------------

interface ProjectConfig {
  defaultTarget?: string;
  setup?: string[];
  protectedBranches?: string[];
}

interface GlobalConfig {
  dataDir?: string;
  scanDirs?: string[];
  highPriorityTarget?: string;
  defaultTarget?: string;
}

const GLOBAL_CONFIG_PATH = resolve(HOME, ".claudet", "config.json");

function loadGlobalConfig(): GlobalConfig {
  if (!existsSync(GLOBAL_CONFIG_PATH)) return {};
  return tryParseJson<GlobalConfig>(tryReadFileSync(GLOBAL_CONFIG_PATH), {});
}

function saveGlobalConfig(config: GlobalConfig): void {
  const dir = dirname(GLOBAL_CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function projectConfigPath(dataDir: string, slug: string): string {
  return resolve(dataDir, "repos", slug, "config.json");
}

function loadProjectConfig(dataDir: string, slug: string): ProjectConfig {
  const cfgPath = projectConfigPath(dataDir, slug);
  if (!existsSync(cfgPath)) return {};
  return tryParseJson<ProjectConfig>(tryReadFileSync(cfgPath), {});
}

function saveProjectConfig(
  dataDir: string,
  slug: string,
  config: ProjectConfig,
): void {
  const cfgPath = projectConfigPath(dataDir, slug);
  const dir = dirname(cfgPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
}

function resolveDataDir(): string {
  // 1. Env var (always wins)
  if (process.env.CLAUDET_DATA_DIR) {
    return resolve(expandHome(process.env.CLAUDET_DATA_DIR));
  }

  // 2. Global config
  const globalConfig = loadGlobalConfig();
  if (globalConfig.dataDir) {
    return resolve(expandHome(globalConfig.dataDir));
  }

  // 3. Default
  return resolve(HOME, ".claudet");
}

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

function repoDir(dataDir: string, slug: string): string {
  return resolve(dataDir, "repos", slug);
}

function worktreesJsonPath(dataDir: string, slug: string): string {
  return resolve(dataDir, "repos", slug, "worktrees.json");
}

function metaJsonPath(dataDir: string, slug: string): string {
  return resolve(dataDir, "repos", slug, "meta.json");
}

function plansDirPath(dataDir: string, slug: string): string {
  return resolve(dataDir, "repos", slug, "plans");
}

function planFilePath(dataDir: string, slug: string, name: string): string {
  return resolve(dataDir, "repos", slug, "plans", `${name}.md`);
}

function wtDirPath(dataDir: string, slug: string, name: string): string {
  return resolve(dataDir, "repos", slug, "worktrees", name);
}

function worklogPath(dataDir: string): string {
  return resolve(dataDir, "worklog.jsonl");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorktreeEntry {
  branch: string;
  target: string;
  archivedAt: string | null;
  lastAccessedAt?: string;
  lastSessionId?: string;
}

interface WorktreesData {
  worktrees: Record<string, WorktreeEntry>;
}

interface RepoMeta {
  repoRoot: string;
  registeredAt: string;
  lastAccessedAt?: string;
}

interface WorklogInput {
  session_id?: string;
  cwd?: string;
}

interface SessionState {
  slug: string;
  plan: string;
  planPath: string;
  startTime: number;
  lastTick: number;
  progressCount: number;
  branch: string;
  target: string;
  context: string | null;
  objective: string | null;
}

interface SessionContext {
  planPath: string;
  branch: string;
  target: string;
  status: string;
  lastProgress: string | null;
  pr: PRStatus | null;
  behindRemote?: number;
  lastSessionId?: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
}

// ---------------------------------------------------------------------------
// Repo registry (directory-based)
// ---------------------------------------------------------------------------

function loadRepoMeta(dataDir: string, slug: string): RepoMeta | null {
  const mPath = metaJsonPath(dataDir, slug);
  if (!existsSync(mPath)) return null;
  return tryParseJson<RepoMeta | null>(tryReadFileSync(mPath), null);
}

function getRepoRoot(dataDir: string, slug: string): string | null {
  return loadRepoMeta(dataDir, slug)?.repoRoot ?? null;
}

function registerRepo(dataDir: string, repoRoot: string): string {
  const slug = deriveRepoSlug(repoRoot);
  const dir = repoDir(dataDir, slug);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    mkdirSync(resolve(dir, "plans"), { recursive: true });
    mkdirSync(resolve(dir, "worktrees"), { recursive: true });
  }

  const mPath = metaJsonPath(dataDir, slug);
  if (!existsSync(mPath)) {
    const meta: RepoMeta = {
      repoRoot,
      registeredAt: new Date().toISOString(),
    };
    writeFileSync(mPath, JSON.stringify(meta, null, 2) + "\n");
  }

  // Migrate legacy .claudet.json → config.json
  const cfgPath = projectConfigPath(dataDir, slug);
  if (!existsSync(cfgPath)) {
    const legacyPath = resolve(repoRoot, ".claudet.json");
    if (existsSync(legacyPath)) {
      const legacy = tryParseJson<Record<string, unknown>>(
        tryReadFileSync(legacyPath),
        {},
      );
      const migrated: ProjectConfig = {};
      if (typeof legacy.defaultTarget === "string")
        migrated.defaultTarget = legacy.defaultTarget;
      if (Array.isArray(legacy.setup)) migrated.setup = legacy.setup;
      if (Object.keys(migrated).length > 0) {
        saveProjectConfig(dataDir, slug, migrated);
      }
    }
  }

  return slug;
}

// ---------------------------------------------------------------------------
// Worktrees.json management
// ---------------------------------------------------------------------------

function loadWorktrees(dataDir: string, slug: string): WorktreesData {
  const wtPath = worktreesJsonPath(dataDir, slug);
  if (!existsSync(wtPath)) return { worktrees: {} };
  return tryParseJson<WorktreesData>(tryReadFileSync(wtPath), {
    worktrees: {},
  });
}

function saveWorktrees(
  dataDir: string,
  slug: string,
  data: WorktreesData,
): void {
  const wtPath = worktreesJsonPath(dataDir, slug);
  const dir = dirname(wtPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(wtPath, JSON.stringify(data, null, 2) + "\n");
}

function saveMeta(dataDir: string, slug: string, meta: RepoMeta): void {
  writeFileSync(
    metaJsonPath(dataDir, slug),
    JSON.stringify(meta, null, 2) + "\n",
  );
}

// Race condition note: concurrent writes to meta/worktrees are acceptable
// for a single-user CLI — last-write-wins is fine for timestamps.
function touchLastAccessed(
  dataDir: string,
  slug: string,
  worktreeName?: string,
): void {
  const now = new Date().toISOString();

  // Update repo meta
  const meta = loadRepoMeta(dataDir, slug);
  if (meta) {
    meta.lastAccessedAt = now;
    saveMeta(dataDir, slug, meta);
  }

  // Update worktree entry
  if (worktreeName) {
    const data = loadWorktrees(dataDir, slug);
    if (data.worktrees[worktreeName]) {
      data.worktrees[worktreeName].lastAccessedAt = now;
      saveWorktrees(dataDir, slug, data);
    }
  }
}

// ---------------------------------------------------------------------------
// Git + GitHub library helpers
// ---------------------------------------------------------------------------

function git(cwd: string): SimpleGit {
  return simpleGit(cwd);
}

function resolveGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const hostsPath = join(HOME, ".config", "gh", "hosts.yml");
  try {
    const content = readFileSync(hostsPath, "utf-8");
    const match = content.match(/oauth_token:\s*(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function getOctokit(): Octokit | null {
  const token = resolveGitHubToken();
  if (!token) return null;
  return new Octokit({ auth: token });
}

// ---------------------------------------------------------------------------
// Plan file management
// ---------------------------------------------------------------------------

function createPlanFile(
  dataDir: string,
  slug: string,
  name: string,
  entry: Partial<WorktreeEntry> & { ticket?: string },
): string {
  const pPath = planFilePath(dataDir, slug, name);
  const pDir = plansDirPath(dataDir, slug);
  if (!existsSync(pDir)) mkdirSync(pDir, { recursive: true });

  if (!existsSync(pPath)) {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toTimeString().slice(0, 5);
    const content = generatePlanContent(
      name,
      { target: entry.target, ticket: entry.ticket },
      date,
      time,
    );
    writeFileSync(pPath, content);
  }

  return pPath;
}

function getStatusFromPlan(pPath: string): string {
  if (!existsSync(pPath)) return "unknown";
  return getStatusFromPlanContent(readFileSync(pPath, "utf-8"));
}

function getProgressEntries(pPath: string): string[] {
  if (!existsSync(pPath)) return [];
  return getProgressEntriesContent(readFileSync(pPath, "utf-8"));
}

function getLastProgress(pPath: string): string | null {
  if (!existsSync(pPath)) return null;
  return getLastProgressContent(readFileSync(pPath, "utf-8"));
}

// ---------------------------------------------------------------------------
// Plan status sync (PR state → plan status)
// ---------------------------------------------------------------------------

function syncPlanStatuses(
  entries: [string, WorktreeEntry][],
  prStatuses: Map<string, PRStatus | null>,
  dataDir: string,
  slug: string,
): number {
  let updated = 0;
  for (const [name] of entries) {
    const pr = prStatuses.get(name);
    if (!pr) continue;

    const pPath = planFilePath(dataDir, slug, name);
    if (!existsSync(pPath)) continue;

    const content = readFileSync(pPath, "utf-8");
    const status = getStatusFromPlanContent(content);

    let newStatus: string | null = null;
    if (status === "in-progress" && pr.state === "OPEN") {
      newStatus = "in-review";
    } else if (status === "in-review" && pr.state === "MERGED") {
      newStatus = "merged";
    }

    if (newStatus) {
      const updatedContent = content.replace(
        /^(## Status\s*\n).*$/m,
        `$1${newStatus}`,
      );
      writeFileSync(pPath, updatedContent);
      updated++;
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function getCheckedOutLocation(
  branch: string,
  cwd: string,
): Promise<string | null> {
  const output = await git(cwd).raw("worktree", "list", "--porcelain");
  const entries = output.split("\n\n");
  for (const entry of entries) {
    const lines = entry.split("\n");
    const wtLine = lines.find((l) => l.startsWith("worktree "));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    if (branchLine && wtLine) {
      const ref = branchLine.replace("branch refs/heads/", "");
      if (ref === branch) return wtLine.replace("worktree ", "");
    }
  }
  return null;
}

async function countBehindRemote(branch: string, cwd: string): Promise<number> {
  try {
    const g = git(cwd);
    await g.fetch(["origin", branch]);
    const log = await g.log({
      from: branch,
      to: `origin/${branch}`,
      symmetric: false,
    });
    return log.total;
  } catch {
    return 0;
  }
}

async function branchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await git(cwd).revparse(["--verify", branch]);
    return true;
  } catch {
    return false;
  }
}

async function discoverRepoRoot(cwd: string): Promise<string> {
  const output = await git(cwd).raw("worktree", "list", "--porcelain");
  const firstLine = output.split("\n")[0];
  if (!firstLine?.startsWith("worktree ")) {
    throw new Error(
      "Cannot determine main repo root. Use --repo to specify it.",
    );
  }
  return firstLine.slice("worktree ".length);
}

// ---------------------------------------------------------------------------
// GitHub API — PR status detection
// ---------------------------------------------------------------------------

async function getRepoInfo(cwd: string): Promise<RepoInfo | null> {
  try {
    const url = (await git(cwd).remote(["get-url", "origin"])) as
      | string
      | undefined;
    if (!url) return null;
    const trimmed = url.trim();
    const sshMatch = trimmed.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    const httpsMatch = trimmed.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
    return null;
  } catch {
    return null;
  }
}

async function fetchPRStatuses(
  entries: [string, WorktreeEntry][],
  repoRoot: string,
  onPhase?: (msg: string) => void,
): Promise<Map<string, PRStatus | null>> {
  const result = new Map<string, PRStatus | null>();
  const info = await getRepoInfo(repoRoot);
  const octokit = getOctokit();

  if (!info || !octokit) {
    for (const [name] of entries) result.set(name, null);
    return result;
  }

  const branchToName = new Map<string, string>();
  for (const [name, entry] of entries) {
    branchToName.set(entry.branch, name);
  }

  onPhase?.("Fetching PRs…");
  const allPRs = await octokit.rest.pulls
    .list({
      owner: info.owner,
      repo: info.repo,
      state: "all",
      per_page: 100,
      sort: "updated",
      direction: "desc",
    })
    .then((r) => r.data)
    .catch((err) => {
      onPhase?.(`PR fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    });

  if (!allPRs) {
    for (const [name] of entries) result.set(name, null);
    return result;
  }

  const matched = new Map<string, (typeof allPRs)[number]>();
  for (const pr of allPRs) {
    const wtName = branchToName.get(pr.head.ref);
    if (wtName && !matched.has(wtName)) {
      matched.set(wtName, pr);
    }
  }

  const openPRs = [...matched.entries()].filter(
    ([, pr]) => pr.state === "open",
  );
  if (openPRs.length > 0) {
    onPhase?.(`Checking merge status… (${openPRs.length} open)`);
  }
  const mergeableMap = new Map<string, boolean | null>();
  const reviewDecisionMap = new Map<string, ReviewDecision>();
  const detailResults = await Promise.all(
    openPRs.map(async ([name, pr]) => {
      const [prDetail, reviewList] = await Promise.all([
        octokit.rest.pulls
          .get({ owner: info.owner, repo: info.repo, pull_number: pr.number })
          .then((r) => r.data)
          .catch(() => null),
        octokit.rest.pulls
          .listReviews({
            owner: info.owner,
            repo: info.repo,
            pull_number: pr.number,
            per_page: 100,
          })
          .then((r) => r.data)
          .catch(() => []),
      ]);
      const reviews: ReviewInfo[] = reviewList.map((r) => ({
        user: r.user?.login ?? "",
        state: r.state,
      }));
      const requestedReviewerCount = pr.requested_reviewers?.length ?? 0;
      return {
        name,
        mergeable: prDetail?.mergeable ?? null,
        reviewDecision: computeReviewDecision(reviews, requestedReviewerCount),
      };
    }),
  );
  for (const { name, mergeable, reviewDecision } of detailResults) {
    mergeableMap.set(name, mergeable);
    reviewDecisionMap.set(name, reviewDecision);
  }

  for (const [name] of entries) {
    const pr = matched.get(name);
    if (!pr) {
      result.set(name, null);
      continue;
    }
    const state: PRStatus["state"] = pr.merged_at
      ? "MERGED"
      : pr.state === "open"
        ? "OPEN"
        : "CLOSED";
    const mergeable = toMergeableStatus(mergeableMap.get(name));
    const reviewDecision = reviewDecisionMap.get(name) ?? "NONE";
    result.set(name, {
      state,
      url: pr.html_url,
      number: pr.number,
      mergeable,
      reviewDecision,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Worklog helpers
// ---------------------------------------------------------------------------

function appendWorklog(dataDir: string, event: Record<string, unknown>): void {
  const wlPath = worklogPath(dataDir);
  const dir = dirname(wlPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(wlPath, JSON.stringify(event) + "\n");
}

function sessionStatePath(sessionId: string): string {
  return join("/tmp", `claudet-worklog-${sessionId}.json`);
}

function updatePlanTimeTracked(pPath: string, addMs: number): void {
  if (!existsSync(pPath)) return;
  const content = readFileSync(pPath, "utf-8");

  const timeMatch = content.match(/^## Time Tracked\s*\n([^\n#]*)/m);
  let existingMs = 0;
  if (timeMatch) {
    existingMs = parseDuration(timeMatch[1].trim());
  }

  const totalMs = existingMs + addMs;
  const formatted = formatDuration(totalMs);

  if (timeMatch) {
    const updated = content.replace(
      /^(## Time Tracked\s*\n)[^\n#]*/m,
      `$1${formatted}`,
    );
    writeFileSync(pPath, updated);
  } else {
    const updated = content.replace(
      /^(## Status\s*\n[^\n#]*\n)/m,
      `$1\n## Time Tracked\n${formatted}\n`,
    );
    writeFileSync(pPath, updated);
  }
}

// ---------------------------------------------------------------------------
// Reconcile worktrees (filesystem wins)
// ---------------------------------------------------------------------------

async function reconcileWorktrees(
  dataDir: string,
  slug: string,
  repoRoot: string,
  defaultTarget: string,
): Promise<WorktreesData> {
  const data = loadWorktrees(dataDir, slug);
  const wtBaseDir = resolve(dataDir, "repos", slug, "worktrees");
  let changed = false;

  // 1. Scan filesystem — discover worktrees not in metadata
  if (existsSync(wtBaseDir)) {
    for (const entry of readdirSync(wtBaseDir)) {
      const dirPath = resolve(wtBaseDir, entry);
      if (!statSync(dirPath).isDirectory()) continue;
      if (!existsSync(resolve(dirPath, ".git"))) continue;
      if (isSmokeTestWorktree(entry)) continue;
      if (data.worktrees[entry] && !data.worktrees[entry].archivedAt) continue;

      // Discover branch from git
      let branch = entry;
      try {
        branch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
          cwd: dirPath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // fall back to entry name
      }

      data.worktrees[entry] = {
        branch,
        target: defaultTarget,
        archivedAt: null,
      };
      createPlanFile(dataDir, slug, entry, { target: defaultTarget, branch });
      changed = true;
    }
  }

  // 2. Validate metadata — mark gone entries as archived
  for (const [name, entry] of Object.entries(data.worktrees)) {
    if (entry.archivedAt) continue;
    const dirPath = wtDirPath(dataDir, slug, name);
    if (!existsSync(dirPath)) {
      data.worktrees[name] = {
        ...entry,
        archivedAt: new Date().toISOString(),
      };
      changed = true;
    }
  }

  // 3. Cross-check git worktree list — discover worktrees created via git
  try {
    const output = await git(repoRoot).raw("worktree", "list", "--porcelain");
    const gitEntries = output.split("\n\n").filter((e) => e.trim());
    for (const gitEntry of gitEntries) {
      const lines = gitEntry.split("\n");
      const wtLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!wtLine || !branchLine) continue;

      const wtPath = wtLine.replace("worktree ", "");
      if (wtPath === repoRoot) continue;

      // Only care about worktrees under our managed directory
      if (!wtPath.startsWith(wtBaseDir)) continue;

      const name = basename(wtPath);
      if (isSmokeTestWorktree(name)) continue;
      if (data.worktrees[name] && !data.worktrees[name].archivedAt) continue;

      const branch = branchLine.replace("branch refs/heads/", "");
      data.worktrees[name] = {
        branch,
        target: defaultTarget,
        archivedAt: null,
      };
      createPlanFile(dataDir, slug, name, { target: defaultTarget, branch });
      changed = true;
    }
  } catch (err) {
    process.stderr.write(
      `warning: git worktree list failed during reconciliation: ${err instanceof Error ? err.message : err}\n`,
    );
  }

  if (changed) {
    saveWorktrees(dataDir, slug, data);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Worklog hook handlers
// ---------------------------------------------------------------------------

function findWorktreeForCwd(
  cwd: string,
  dataDir: string,
): { slug: string; name: string; branch?: string } | null {
  for (const slug of loadRepoSlugs(dataDir)) {
    const data = loadWorktrees(dataDir, slug);
    for (const [name, entry] of Object.entries(data.worktrees)) {
      if (entry.archivedAt) continue;
      const dirPath = wtDirPath(dataDir, slug, name);
      if (cwd.startsWith(dirPath)) {
        return { slug, name, branch: entry.branch };
      }
    }
  }
  return null;
}

async function worklogStart(): Promise<void> {
  const inputRaw = tryReadFileSync("/dev/stdin");
  const input = tryParseJson<WorklogInput>(inputRaw, {});

  const sessionId = input.session_id;
  const cwd = input.cwd;

  if (!sessionId || !cwd) return;

  const dataDir = resolveDataDir();
  const wtMatch = findWorktreeForCwd(cwd, dataDir);
  if (!wtMatch) return;

  const pPath = planFilePath(dataDir, wtMatch.slug, wtMatch.name);
  if (!existsSync(pPath)) return;

  const now = Date.now();
  const planContent = readFileSync(pPath, "utf-8");
  const progressEntries = getProgressEntriesContent(planContent);
  const branch = wtMatch.branch || "unknown";
  const target = getTargetFromPlan(planContent);
  const context = getPlanSection(planContent, "Context");
  const objective = getPlanSection(planContent, "Objective");

  const state: SessionState = {
    slug: wtMatch.slug,
    plan: wtMatch.name,
    planPath: pPath,
    startTime: now,
    lastTick: now,
    progressCount: progressEntries.length,
    branch,
    target,
    context,
    objective,
  };
  writeFileSync(sessionStatePath(sessionId), JSON.stringify(state));

  // Save session ID to worktree metadata for --resume on next launch
  const wtData = loadWorktrees(dataDir, wtMatch.slug);
  const wtEntry = wtData.worktrees[wtMatch.name];
  if (wtEntry) {
    wtEntry.lastSessionId = sessionId;
    saveWorktrees(dataDir, wtMatch.slug, wtData);
  }
}

async function worklogTick(): Promise<void> {
  const inputRaw = tryReadFileSync("/dev/stdin");
  const input = tryParseJson<WorklogInput>(inputRaw, {});

  const sessionId = input.session_id;
  if (!sessionId) return;

  const statePath = sessionStatePath(sessionId);
  if (!existsSync(statePath)) return;

  const state = tryParseJson<SessionState | null>(
    tryReadFileSync(statePath),
    null,
  );
  if (!state) return;

  // Normalize fields that may be absent in old session state files
  state.branch = state.branch ?? "unknown";
  state.target = state.target ?? "unknown";
  state.context = state.context ?? null;
  state.objective = state.objective ?? null;

  const dataDir = resolveDataDir();
  const now = Date.now();
  const elapsedSinceLastTick = now - state.lastTick;

  // Update plan time tracked
  if (state.planPath) {
    updatePlanTimeTracked(state.planPath, elapsedSinceLastTick);
  }

  // Read plan content once for all checks
  let content = "";
  if (state.planPath && existsSync(state.planPath)) {
    content = readFileSync(state.planPath, "utf-8");
  }

  // Delegate decision logic to pure function
  const result = computeWorklogEvents(
    {
      slug: state.slug,
      plan: state.plan,
      branch: state.branch,
      target: state.target,
      context: state.context,
      objective: state.objective,
      progressCount: state.progressCount ?? 0,
    },
    content,
    now,
  );

  // Apply I/O side effects: write updated plan file if pending→in-progress
  if (result.updatedPlanContent !== null && state.planPath) {
    writeFileSync(state.planPath, result.updatedPlanContent);
  }

  // Append all events to worklog
  for (const event of result.events) {
    appendWorklog(dataDir, event);
  }

  // Apply state updates
  if (result.stateUpdates.context !== undefined) {
    state.context = result.stateUpdates.context;
  }
  if (result.stateUpdates.objective !== undefined) {
    state.objective = result.stateUpdates.objective;
  }
  if (result.stateUpdates.progressCount !== undefined) {
    state.progressCount = result.stateUpdates.progressCount;
  }

  // Update lastTick in state
  state.lastTick = now;
  writeFileSync(statePath, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Worklog migration — backfill progress entries from plan files
// ---------------------------------------------------------------------------

function worklogMigrate(): void {
  const dataDir = resolveDataDir();
  const slugs = loadRepoSlugs(dataDir);
  let totalMigrated = 0;

  for (const slug of slugs) {
    const plansDir = plansDirPath(dataDir, slug);
    if (!existsSync(plansDir)) continue;

    let planFiles: string[];
    try {
      planFiles = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const file of planFiles) {
      const planName = file.replace(/\.md$/, "");
      const pPath = resolve(plansDir, file);
      const planContent = readFileSync(pPath, "utf-8");
      const entries = getProgressEntriesContent(planContent);
      if (entries.length === 0) continue;
      const branch = getBranchFromPlan(planContent);
      const target = getTargetFromPlan(planContent);

      // Check what's already in the worklog for this plan
      const wlPath = worklogPath(dataDir);
      const existingLines = existsSync(wlPath)
        ? tryReadFileSync(wlPath)
            .split("\n")
            .filter(Boolean)
            .filter((line) => {
              const parsed = tryParseJson<Record<string, unknown>>(line, {});
              return parsed.event === "progress" && parsed.plan === planName;
            })
            .map((line) => {
              const parsed = tryParseJson<Record<string, unknown>>(line, {});
              return parsed.message as string;
            })
        : [];
      const existingSet = new Set(existingLines);

      let migrated = 0;
      for (const entry of entries) {
        if (existingSet.has(entry)) continue;

        // Try to parse date from the entry (e.g. "2026-03-05 12:47: ..." or "2026-03-05: ...")
        const dateMatch = entry.match(
          /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s*:/,
        );
        const ts = dateMatch
          ? new Date(
              dateMatch[2]
                ? `${dateMatch[1]}T${dateMatch[2]}:00`
                : `${dateMatch[1]}T00:00:00`,
            ).getTime()
          : 0;

        appendWorklog(dataDir, {
          event: "progress",
          timestamp: ts,
          datetime: ts ? new Date(ts).toISOString() : null,
          plan: planName,
          slug,
          branch,
          target,
          message: entry,
          migrated: true,
        });
        migrated++;
      }

      if (migrated > 0) {
        console.log(`  ${slug}/${planName}: ${migrated} entries`);
        totalMigrated += migrated;
      }
    }
  }

  if (totalMigrated === 0) {
    console.log("  No new entries to migrate.");
  } else {
    console.log(`\nMigrated ${totalMigrated} progress entries to worklog.`);
  }
}

// ---------------------------------------------------------------------------
// Hook auto-configuration
// ---------------------------------------------------------------------------

// Race condition note: concurrent settings writes are acceptable for single-user CLI.
function ensureWorklogHooks(): void {
  const settings = tryParseJson<Record<string, unknown>>(
    tryReadFileSync(GLOBAL_SETTINGS_FILE),
    {},
  );

  const { settings: updated, changed } = mergeWorklogHooks(settings);

  if (changed) {
    const dir = dirname(GLOBAL_SETTINGS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      GLOBAL_SETTINGS_FILE,
      JSON.stringify(updated, null, 2) + "\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Context doc management
// ---------------------------------------------------------------------------

const CLAUDET_DIR = resolve(HOME, ".claude", "claudet");
const CLAUDE_MD_PATH = resolve(HOME, ".claude", "CLAUDE.md");
const TEMPLATES_DIR = resolve(__dirname, "templates");

function ensureContextDocs(): { updated: boolean; actions: string[] } {
  const actions: string[] = [];

  // Phase 1 — Migrate legacy files
  for (const name of ["planning-guide.md", "worktree-workflow.md"]) {
    const legacy = resolve(HOME, ".claude", name);
    const target = resolve(CLAUDET_DIR, name);
    if (existsSync(legacy) && !existsSync(target)) {
      if (!existsSync(CLAUDET_DIR)) mkdirSync(CLAUDET_DIR, { recursive: true });
      writeFileSync(target, readFileSync(legacy, "utf-8"));
      renameSync(legacy, legacy + ".migrated-to-claudet");
      actions.push(`migrated ${name} → claudet/`);
    }
  }

  // Phase 2 — Template sync
  if (!existsSync(CLAUDET_DIR)) mkdirSync(CLAUDET_DIR, { recursive: true });
  for (const name of ["planning-guide.md", "worktree-workflow.md"]) {
    const templatePath = resolve(TEMPLATES_DIR, name);
    const installedPath = resolve(CLAUDET_DIR, name);
    const templateContent = readFileSync(templatePath, "utf-8");
    const templateHash = computeContextHash(templateContent);
    const installedHash = existsSync(installedPath)
      ? computeContextHash(readFileSync(installedPath, "utf-8"))
      : "";
    if (templateHash !== installedHash) {
      writeFileSync(installedPath, templateContent);
      actions.push(`updated claudet/${name}`);
    }
  }

  // Phase 3 — CLAUDE.md managed section
  const sectionTemplate = readFileSync(
    resolve(TEMPLATES_DIR, "claude-md-section.md"),
    "utf-8",
  );
  const sectionHash = computeContextHash(sectionTemplate);
  const claudeMd = existsSync(CLAUDE_MD_PATH)
    ? readFileSync(CLAUDE_MD_PATH, "utf-8")
    : "";
  const existing = managedSectionExtract(claudeMd);
  const existingHash = existing ? computeContextHash(existing) : "";
  if (sectionHash !== existingHash) {
    const updated = managedSectionReplace(claudeMd, sectionTemplate);
    writeFileSync(CLAUDE_MD_PATH, updated);
    actions.push("updated CLAUDE.md managed section");
  }

  return { updated: actions.length > 0, actions };
}

function contextCommand(): void {
  const { actions } = ensureContextDocs();
  if (actions.length > 0) {
    for (const action of actions) {
      console.log(`  ${action}`);
    }
  } else {
    console.log("Context docs are up to date.");
  }
}

// ---------------------------------------------------------------------------
// Launch claude
// ---------------------------------------------------------------------------

function updatePlanSessionContext(ctx: SessionContext): void {
  if (!existsSync(ctx.planPath)) return;
  let content = readFileSync(ctx.planPath, "utf-8");

  // ## Branch — insert/update after ## Target Branch
  content = upsertPlanSection(content, "Branch", ctx.branch, "Target Branch");

  // ## PR — insert/update after ## Branch (or remove if no PR)
  if (ctx.pr) {
    const prBody = [
      `- **Number:** #${ctx.pr.number}`,
      `- **State:** ${ctx.pr.state}`,
      `- **URL:** ${ctx.pr.url}`,
      `- **Mergeable:** ${ctx.pr.mergeable}`,
      `- **Review:** ${ctx.pr.reviewDecision}`,
    ].join("\n");
    content = upsertPlanSection(content, "PR", prBody, "Branch");
  } else {
    content = upsertPlanSection(content, "PR", null, "Branch");
  }

  writeFileSync(ctx.planPath, content);
}

function generateClaudeLocalMd(wtPath: string, ctx: SessionContext): void {
  const claudeDir = resolve(wtPath, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
  const template = readFileSync(
    resolve(TEMPLATES_DIR, "claude-local-md.md"),
    "utf-8",
  );
  let content = template
    .replace(/\{\{planPath\}\}/g, ctx.planPath)
    .replace(/\{\{branch\}\}/g, ctx.branch)
    .replace(/\{\{target\}\}/g, ctx.target);
  if (ctx.behindRemote && ctx.behindRemote > 0) {
    content += `\n### Remote Changes\n\n**⚠ Branch \`${ctx.branch}\` is ${ctx.behindRemote} commit(s) behind \`origin/${ctx.branch}\`.** Run \`git pull\` before making changes.\n`;
  }
  writeFileSync(resolve(claudeDir, "CLAUDE.local.md"), content);
}

function launchClaude(cwd: string, ctx?: SessionContext): void {
  p.outro(pc.dim(`Launching claude in ${cwd}`));
  if (ctx) {
    updatePlanSessionContext(ctx);
    generateClaudeLocalMd(cwd, ctx);
  }
  const args: string[] = [];
  if (ctx?.lastSessionId) {
    args.push("--resume", ctx.lastSessionId);
  } else if (ctx?.planPath) {
    if (ctx.status === "pending") {
      args.push("load plan and start planning");
    } else {
      args.push("load plan");
    }
  }
  args.push(
    "--allowedTools",
    "Read",
    "Glob",
    "Grep",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git status:*)",
    "Bash(git branch:*)",
    "Bash(git show:*)",
    "WebFetch",
    "WebSearch",
  );
  // Allow reading all sibling worktrees (cwd is <dataDir>/repos/<slug>/worktrees/<name>)
  const worktreesRoot = dirname(cwd);
  args.push("--add-dir", worktreesRoot);
  const child = spawn("claude", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// ---------------------------------------------------------------------------
// Worktree creation
// ---------------------------------------------------------------------------

interface CreateWorktreeResult {
  entry: WorktreeEntry;
  wtPath: string;
  planPath: string;
}

async function createWorktree(
  dataDir: string,
  slug: string,
  repoRoot: string,
  branch: string,
  target: string,
  shortName: string,
  skipSetup: boolean,
  ticket?: string,
  quiet?: boolean,
): Promise<CreateWorktreeResult> {
  const wtPath = wtDirPath(dataDir, slug, shortName);
  const g = git(repoRoot);
  const isExisting = await branchExists(branch, repoRoot);

  const fail = (msg: string): never => {
    if (quiet) throw new Error(msg);
    bail(msg);
  };

  if (!isExisting && !target) {
    fail("Target branch is required when creating a new branch.");
  }

  if (existsSync(wtPath)) {
    fail(`Worktree path already exists: ${wtPath}`);
  }

  const wtParent = dirname(wtPath);
  if (!existsSync(wtParent)) {
    mkdirSync(wtParent, { recursive: true });
  }

  const s = quiet ? null : p.spinner();

  if (isExisting) {
    const checkedOutAt = await getCheckedOutLocation(branch, repoRoot);
    if (checkedOutAt) {
      if (checkedOutAt === repoRoot) {
        s?.start("Freeing branch from main repo...");
        try {
          await g.checkout("dev");
        } catch {
          await g.raw("checkout", "--detach");
        }
        s?.stop("Switched main repo to dev.");
      } else {
        fail(
          `Branch "${branch}" is already checked out in worktree: ${checkedOutAt}`,
        );
      }
    }

    s?.start(`Fetching ${pc.cyan(branch)}...`);
    try {
      await g.fetch("origin", branch);
      s?.stop(`Fetched ${pc.cyan(branch)} from origin.`);
    } catch {
      s?.stop(pc.dim("No remote tracking, skipped fetch."));
    }

    s?.start(`Creating worktree ${pc.bold(shortName)}...`);
    await g.raw("worktree", "add", wtPath, branch);
    s?.stop(`Created worktree ${pc.bold(shortName)}.`);

    try {
      await git(wtPath).pull();
    } catch {
      // No upstream
    }
  } else {
    if (!(await branchExists(target, repoRoot))) {
      try {
        await g.fetch("origin", target);
      } catch {
        fail(`Base branch "${target}" does not exist locally or on origin.`);
      }
      if (!(await branchExists(`origin/${target}`, repoRoot))) {
        fail(`Base branch "${target}" does not exist.`);
      }
    }

    s?.start(
      `Creating worktree ${pc.bold(shortName)} from ${pc.cyan(target)}...`,
    );
    await g.raw("worktree", "add", "-b", branch, wtPath, target);
    s?.stop(`Created worktree ${pc.bold(shortName)}.`);
  }

  // Post-creation setup: symlinks, setup commands, plan, metadata.
  // Wrapped in try-catch to clean up on failure — prevents orphaned worktrees.
  try {
    // Symlink .claude/settings.local.json
    const localSettings = resolve(repoRoot, ".claude", "settings.local.json");
    if (existsSync(localSettings)) {
      const destDir = resolve(wtPath, ".claude");
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      const destPath = resolve(destDir, "settings.local.json");
      if (!existsSync(destPath)) {
        symlinkSync(localSettings, destPath);
      }
    }

    // Symlink .env* files
    const envFiles = readdirSync(repoRoot).filter(
      (f) => f.startsWith(".env") && statSync(resolve(repoRoot, f)).isFile(),
    );
    for (const envFile of envFiles) {
      const targetEnvPath = resolve(repoRoot, envFile);
      const link = resolve(wtPath, envFile);
      if (!existsSync(link)) {
        symlinkSync(targetEnvPath, link);
      }
    }

    if (envFiles.length > 0 && !quiet) {
      p.log.step(`Symlinked ${envFiles.length} env file(s) + settings.`);
    }

    // Run setup commands from project config (failures are non-fatal)
    if (!skipSetup) {
      const projectConfig = loadProjectConfig(dataDir, slug);
      const setupCommands = projectConfig.setup ?? [];
      for (const cmd of setupCommands) {
        try {
          if (quiet) {
            runLoud(cmd, wtPath);
          } else {
            s?.start(`Running: ${pc.dim(cmd)}...`);
            runLoud(cmd, wtPath);
            s?.stop(`Done: ${pc.dim(cmd)}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (quiet) {
            process.stderr.write(
              `warning: setup command failed: ${cmd} — ${msg}\n`,
            );
          } else {
            s?.stop(pc.yellow(`Setup command failed: ${pc.dim(cmd)}`));
            p.log.warn(msg);
          }
        }
      }
    }

    // Create plan file
    const planPath = createPlanFile(dataDir, slug, shortName, {
      target,
      branch,
      ticket,
    });

    const entry: WorktreeEntry = {
      branch,
      target,
      archivedAt: null,
    };

    // Race condition note: concurrent metadata writes are acceptable for single-user CLI.
    const data = loadWorktrees(dataDir, slug);
    data.worktrees[shortName] = entry;
    saveWorktrees(dataDir, slug, data);

    if (!quiet) {
      p.note(
        [
          `${pc.dim("Path")}    ${wtPath}`,
          `${pc.dim("Branch")}  ${pc.cyan(branch)}`,
          `${pc.dim("Target")}  ${target}`,
          `${pc.dim("Plan")}    ${planPath}`,
        ].join("\n"),
        "Worktree Ready",
      );
    }

    return { entry, wtPath, planPath };
  } catch (err) {
    // Best-effort cleanup — remove the worktree to avoid orphaned state
    try {
      await g.raw("worktree", "remove", wtPath, "--force");
    } catch {
      // cleanup failed — worktree may be orphaned
    }
    throw err instanceof Error
      ? err
      : new Error(`Worktree post-creation setup failed: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Interactive flow
// ---------------------------------------------------------------------------

async function pickRepo(
  dataDir: string,
): Promise<{ slug: string; repoRoot: string }> {
  const slugs = loadRepoSlugs(dataDir);
  const repos = slugs
    .map((slug) => {
      const meta = loadRepoMeta(dataDir, slug);
      return { slug, repoRoot: meta?.repoRoot ?? null, meta };
    })
    .filter(
      (r): r is { slug: string; repoRoot: string; meta: RepoMeta } =>
        r.repoRoot !== null && existsSync(r.repoRoot!),
    )
    .sort((a, b) =>
      compareDatesDesc(
        a.meta.lastAccessedAt ?? a.meta.registeredAt,
        b.meta.lastAccessedAt ?? b.meta.registeredAt,
      ),
    );

  if (repos.length === 0) {
    return promptAndRegisterRepo(dataDir);
  }

  const ADD_NEW = "__add_new_repo__";
  const options = [
    ...repos.map((r) => ({
      value: r.slug,
      label: `${basename(dirname(r.repoRoot))}/${basename(r.repoRoot)}`,
      hint: r.repoRoot,
    })),
    {
      value: ADD_NEW,
      label: pc.green("+ Add new repository"),
      hint: "",
    },
  ];
  const selected = await p.select({
    message: "Select repository",
    options,
    maxItems: options.length,
  });
  if (cancelled(selected)) bail("Cancelled.");

  if (selected === ADD_NEW) {
    return promptAndRegisterRepo(dataDir);
  }

  return repos.find((r) => r.slug === (selected as string))!;
}

async function promptAndRegisterRepo(
  dataDir: string,
): Promise<{ slug: string; repoRoot: string }> {
  const globalConfig = loadGlobalConfig();
  const scanDirs = globalConfig.scanDirs ?? ["~/repos"];
  const discovered = scanForGitRepos(scanDirs);

  // Filter out already-registered repos
  const slugs = loadRepoSlugs(dataDir);
  const registeredRoots = new Set(
    slugs.map((s) => getRepoRoot(dataDir, s)).filter(Boolean),
  );
  const unregistered = discovered.filter((d) => !registeredRoots.has(d));

  if (unregistered.length > 0) {
    const MANUAL = "__manual__";
    const selected = await p.select({
      message: "Select a repository to add",
      options: [
        ...unregistered.map((r) => ({
          value: r,
          label: `${basename(dirname(r))}/${basename(r)}`,
          hint: r,
        })),
        {
          value: MANUAL,
          label: pc.dim("Enter path manually"),
          hint: "",
        },
      ],
    });
    if (cancelled(selected)) bail("Cancelled.");

    if (selected !== MANUAL) {
      const root = selected as string;
      const slug = registerRepo(dataDir, root);
      return { slug, repoRoot: root };
    }
  }

  return promptManualRepoPath(dataDir);
}

async function promptManualRepoPath(
  dataDir: string,
): Promise<{ slug: string; repoRoot: string }> {
  const input = await p.text({
    message: "Enter path to git repository",
    placeholder: "~/repos/my-project",
  });
  if (cancelled(input)) bail("Cancelled.");
  const root = resolve(expandHome((input as string).trim()));

  if (!existsSync(root)) {
    const shouldCreate = await p.confirm({
      message: `Path does not exist. Create ${root} and initialize git?`,
    });
    if (cancelled(shouldCreate) || !shouldCreate) bail("Cancelled.");
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    p.log.success(`Created and initialized git repo at ${root}`);
  } else if (!existsSync(join(root, ".git"))) {
    const shouldInit = await p.confirm({
      message: "Not a git repo. Initialize with git init?",
    });
    if (cancelled(shouldInit) || !shouldInit) bail("Cancelled.");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    p.log.success(`Initialized git repo at ${root}`);
  }

  const slug = registerRepo(dataDir, root);
  return { slug, repoRoot: root };
}

async function interactiveFlow(): Promise<void> {
  p.intro(`${pc.bold(pc.cyan("claudet"))} ${pc.dim(`v${PKG_VERSION}`)}`);

  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    p.log.info("First run — let's configure claudet.");
    await runInitSetup();
    p.log.success("Configuration saved.");
  }

  const dataDir = resolveDataDir();
  cleanStaleSessionFiles(tmpdir());
  ensureWorklogHooks();
  ensureContextDocs();
  await ensureToolPermissions();

  const { slug, repoRoot } = await pickRepo(dataDir);

  const projectConfig = loadProjectConfig(dataDir, slug);
  const globalCfg = loadGlobalConfig();
  const defaultTarget =
    projectConfig.defaultTarget || globalCfg.defaultTarget || "dev";

  const s = p.spinner();
  s.start("Loading worktrees...");
  const data = await reconcileWorktrees(dataDir, slug, repoRoot, defaultTarget);
  const activeCount = Object.entries(data.worktrees).filter(
    ([name, entry]) => !entry.archivedAt && !isSmokeTestWorktree(name),
  ).length;
  s.stop(activeCount > 0 ? "Worktrees loaded." : "No active worktrees found.");

  const EPOCH = "1970-01-01T00:00:00.000Z";
  const highPriorityTarget = globalCfg.highPriorityTarget ?? "main";

  const activeEntries = Object.entries(data.worktrees)
    .filter(([name, entry]) => !entry.archivedAt && !isSmokeTestWorktree(name))
    .sort(([, a], [, b]) =>
      compareWorktreeEntries(highPriorityTarget)(
        { target: a.target, lastAccessedAt: a.lastAccessedAt ?? EPOCH },
        { target: b.target, lastAccessedAt: b.lastAccessedAt ?? EPOCH },
      ),
    );

  if (activeEntries.length === 0) {
    await createNewWorktreeFlow(dataDir, slug, repoRoot);
    return;
  }

  // Fetch PR statuses
  const prSpinner = p.spinner();
  prSpinner.start("Fetching PRs…");
  const prStatuses = await fetchPRStatuses(activeEntries, repoRoot, (msg) =>
    prSpinner.message(msg),
  );
  prSpinner.stop(`Loaded ${activeEntries.length} PRs.`);

  // Sync plan statuses based on PR state
  syncPlanStatuses(activeEntries, prStatuses, dataDir, slug);

  // Re-sort with needsAttention now that PR data is available
  activeEntries.sort(([nameA, a], [nameB, b]) =>
    compareWorktreeEntries(highPriorityTarget)(
      {
        target: a.target,
        lastAccessedAt: a.lastAccessedAt ?? EPOCH,
        needsAttention: prNeedsAttention(prStatuses.get(nameA) ?? null),
      },
      {
        target: b.target,
        lastAccessedAt: b.lastAccessedAt ?? EPOCH,
        needsAttention: prNeedsAttention(prStatuses.get(nameB) ?? null),
      },
    ),
  );

  // Build select options with columnar layout
  const STATUS_PAD = 12;
  const CREATE_NEW = "__create_new__";
  const maxBranchLen = Math.max(
    ...activeEntries.map(([, entry]) => entry.branch.length),
  );
  const options = [
    ...activeEntries.map(([name, entry]) => {
      const status = getStatusFromPlan(planFilePath(dataDir, slug, name));
      const pr = prStatuses.get(name) ?? null;
      return {
        value: name,
        label: `${statusBadge(status, STATUS_PAD, pc)} ${entry.branch.padEnd(maxBranchLen + 2)}${prBadge(pr, pc)}`,
      };
    }),
    {
      value: CREATE_NEW,
      label: pc.green("+ Create new worktree"),
      hint: "",
    },
  ];

  const selection = await p.autocomplete({
    message: "Select worktree",
    options,
    maxItems: options.length,
    placeholder: "Type to search…",
    filter: (search, opt) => {
      if (opt.value === CREATE_NEW) return true;
      const name = opt.value as string;
      const entry = data.worktrees[name];
      return matchesSearch(search, name, entry.branch);
    },
  });

  if (cancelled(selection)) bail("Cancelled.");

  if (selection === CREATE_NEW) {
    await createNewWorktreeFlow(dataDir, slug, repoRoot);
    return;
  }

  const selectedName = selection as string;
  const entry = data.worktrees[selectedName];
  const pPath = planFilePath(dataDir, slug, selectedName);
  const selectedWtPath = wtDirPath(dataDir, slug, selectedName);
  const status = getStatusFromPlan(pPath);
  const lastProgress = getLastProgress(pPath);

  const pr = prStatuses.get(selectedName) ?? null;
  const behindRemote = await countBehindRemote(entry.branch, selectedWtPath);
  const infoLines = [
    `${pc.dim("Plan")}    ${pPath}`,
    `${pc.dim("Status")}  ${statusBadge(status, 0, pc)}`,
  ];
  if (pr) {
    infoLines.push(
      `${pc.dim("PR")}      ${prBadge(pr, pc)}  ${pc.underline(pr.url)}`,
    );
  }
  if (lastProgress) {
    infoLines.push(`${pc.dim("Last")}    ${lastProgress}`);
  }
  if (behindRemote > 0) {
    infoLines.push(
      `${pc.yellow("⚠")}       ${pc.yellow(`${behindRemote} commit(s) behind origin/${entry.branch}`)}`,
    );
  }
  p.note(infoLines.join("\n"), selectedName);

  touchLastAccessed(dataDir, slug, selectedName);
  launchClaude(selectedWtPath, {
    planPath: pPath,
    branch: entry.branch,
    target: entry.target,
    status,
    lastProgress,
    pr,
    behindRemote,
    lastSessionId: entry.lastSessionId,
  });
}

// ---------------------------------------------------------------------------
// Create new worktree flow
// ---------------------------------------------------------------------------

async function createNewWorktreeFlow(
  dataDir: string,
  slug: string,
  repoRoot: string,
): Promise<void> {
  const projectConfig = loadProjectConfig(dataDir, slug);
  const globalConfig = loadGlobalConfig();
  const defaultTarget =
    projectConfig.defaultTarget || globalConfig.defaultTarget || "dev";

  // Get local branches for target selection
  let branchSummary = await git(repoRoot).branchLocal();
  if (branchSummary.all.length === 0) {
    // Fresh repo with no commits — create initial commit so branches exist
    execFileSync("git", ["commit", "--allow-empty", "-m", "Initial commit"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    branchSummary = await git(repoRoot).branchLocal();
    p.log.info(`Created initial commit on ${branchSummary.current || "main"}`);
  }
  const localBranches = branchSummary.all;

  // Step 1 — choose naming method
  const method = await p.select({
    message: "How do you want to name the branch?",
    options: [
      {
        value: "name" as const,
        label: "By name",
        hint: "enter branch name directly",
      },
      {
        value: "task" as const,
        label: "By task",
        hint: "derive from issue tracker task",
      },
    ],
  });
  if (cancelled(method)) bail("Cancelled.");

  let branch: string;
  let ticket: string | undefined;

  if (method === "task") {
    // Step 2b — "By task" path
    const tracker = await p.select({
      message: "Issue tracker",
      options: TRACKER_PREFIXES.map((t) => ({ value: t, label: t })),
    });
    if (cancelled(tracker)) bail("Cancelled.");

    const taskId = await p.text({
      message: "Task ID",
      placeholder: "PROJ-123",
      validate: (v) => (!v ? "Task ID is required" : undefined),
    });
    if (cancelled(taskId)) bail("Cancelled.");

    const branchInput = await p.text({
      message: "Branch name",
      initialValue: composeBranchFromTask(
        tracker as TrackerPrefix,
        taskId as string,
      ),
      validate: validateBranchName,
    });
    if (cancelled(branchInput)) bail("Cancelled.");

    branch = branchInput as string;
    ticket = taskId as string;
  } else {
    // Step 2a — "By name" path
    const branchInput = await p.text({
      message: "Branch name",
      placeholder: "feat/new-feature",
      validate: validateBranchName,
    });
    if (cancelled(branchInput)) bail("Cancelled.");

    const ticketInput = await p.text({
      message: "Issue tracker ticket",
      placeholder: "CU-abc123, JIRA-456, LIN-789 (optional)",
    });
    if (cancelled(ticketInput)) bail("Cancelled.");

    branch = branchInput as string;
    ticket = (ticketInput as string) || undefined;
  }

  // Step 3 — Target branch
  const sorted = sortBranchesDefaultFirst(localBranches, defaultTarget);
  const target = await p.autocomplete({
    message: "Target branch (base for branching & PRs)",
    options: sorted.map((b) => ({
      value: b,
      label: b,
      hint: b === branchSummary.current ? "current" : undefined,
    })),
    maxItems: sorted.length,
    placeholder: "Type to search…",
  });
  if (cancelled(target)) bail("Cancelled.");
  const targetBranch = (target as string) || defaultTarget;
  const shortName = deriveShortName(branch);

  const { wtPath, planPath } = await createWorktree(
    dataDir,
    slug,
    repoRoot,
    branch,
    targetBranch,
    shortName,
    false,
    ticket,
  );

  touchLastAccessed(dataDir, slug, shortName);
  launchClaude(wtPath, {
    planPath,
    branch,
    target: targetBranch,
    status: "pending",
    lastProgress: null,
    pr: null,
  });
}

// ---------------------------------------------------------------------------
// Non-interactive create command
// ---------------------------------------------------------------------------

async function createCommand(): Promise<void> {
  const flags = parseCreateFlags(process.argv.slice(3));

  if (!flags.branch) {
    console.log(
      JSON.stringify({ ok: false, error: "Missing required flag: --branch" }),
    );
    process.exit(1);
  }

  const repoRoot = flags.repo
    ? resolve(flags.repo)
    : await discoverRepoRoot(process.cwd());

  const dataDir = resolveDataDir();
  const slug = registerRepo(dataDir, repoRoot);
  const projectConfig = loadProjectConfig(dataDir, slug);
  const globalConfig = loadGlobalConfig();
  const target =
    flags.target ||
    projectConfig.defaultTarget ||
    globalConfig.defaultTarget ||
    "dev";
  const shortName = deriveShortName(flags.branch);

  // Pre-validate
  const wtPath = wtDirPath(dataDir, slug, shortName);
  if (existsSync(wtPath)) {
    throw new Error(`Worktree directory already exists: ${wtPath}`);
  }

  const existingData = loadWorktrees(dataDir, slug);
  const existingEntry = existingData.worktrees[shortName];
  if (existingEntry && !existingEntry.archivedAt) {
    throw new Error(
      `Worktree "${shortName}" is already active in worktrees.json`,
    );
  }

  const { entry, planPath } = await createWorktree(
    dataDir,
    slug,
    repoRoot,
    flags.branch,
    target,
    shortName,
    flags.skipSetup,
    flags.ticket,
    true,
  );

  console.log(
    JSON.stringify({
      ok: true,
      worktree: {
        path: wtDirPath(dataDir, slug, shortName),
        branch: entry.branch,
        target: entry.target,
        shortName,
        planPath,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Clean flow
// ---------------------------------------------------------------------------

async function archiveWorktrees(
  names: string[],
  data: WorktreesData,
  repoRoot: string,
  dataDir: string,
  slug: string,
  protectedBranches: Set<string>,
): Promise<void> {
  const archiveSpinner = p.spinner();
  for (const name of names) {
    const entry = data.worktrees[name];
    archiveSpinner.start(`Archiving ${pc.bold(name)}...`);

    const archiveWtPath = wtDirPath(dataDir, slug, name);
    const g = git(repoRoot);
    try {
      await g.raw("worktree", "remove", archiveWtPath, "--force");
    } catch {
      // already gone
    }
    try {
      await g.raw("worktree", "prune");
    } catch {}

    if (!protectedBranches.has(entry.branch)) {
      try {
        await g.deleteLocalBranch(entry.branch, true);
      } catch {}
    }

    data.worktrees[name] = {
      ...entry,
      archivedAt: new Date().toISOString(),
    };

    archiveSpinner.stop(`Archived ${pc.bold(name)}.`);
  }
}

async function cleanFlow(flags: CleanFlags): Promise<void> {
  p.intro(pc.bold(pc.red("claudet clean")));

  const dataDir = resolveDataDir();

  const slugs = loadRepoSlugs(dataDir);
  if (slugs.length === 0) {
    p.log.info("No registered repositories.");
    p.outro("Done.");
    return;
  }

  const { slug, repoRoot } = await pickRepo(dataDir);

  const projectConfig = loadProjectConfig(dataDir, slug);
  const protectedBranches = new Set(
    projectConfig.protectedBranches ?? ["main", "dev", "prod"],
  );

  const data = loadWorktrees(dataDir, slug);
  const allEntries = Object.entries(data.worktrees);

  // Auto-remove smoke test worktrees
  const smokeEntries = allEntries.filter(([name]) => isSmokeTestWorktree(name));
  const smokeRemoved = smokeEntries.length;
  for (const [name, entry] of smokeEntries) {
    if (entry.archivedAt) {
      delete data.worktrees[name];
      continue;
    }
    if (protectedBranches.has(entry.branch)) continue;
    const g = git(repoRoot);
    const smokeWtPath = wtDirPath(dataDir, slug, name);
    try {
      await g.raw("worktree", "remove", smokeWtPath, "--force");
    } catch {
      /* already gone */
    }
    try {
      await g.raw("worktree", "prune");
    } catch {}
    try {
      await g.deleteLocalBranch(entry.branch, true);
    } catch {}
    // Only delete metadata if the directory was actually removed
    if (!existsSync(smokeWtPath)) {
      delete data.worktrees[name];
    }
  }

  if (smokeRemoved > 0) {
    p.log.success(`Auto-removed ${smokeRemoved} smoke test worktree(s).`);
  }

  const activeEntries = Object.entries(data.worktrees).filter(
    ([name, entry]) =>
      !entry.archivedAt &&
      !isSmokeTestWorktree(name) &&
      !protectedBranches.has(entry.branch),
  );

  if (activeEntries.length === 0) {
    p.log.info("No active worktrees to clean.");
    saveWorktrees(dataDir, slug, data);
    p.outro("Done.");
    return;
  }

  // Fetch PR statuses
  const prSpinner = p.spinner();
  prSpinner.start("Fetching PRs…");
  const prStatuses = await fetchPRStatuses(activeEntries, repoRoot, (msg) =>
    prSpinner.message(msg),
  );
  prSpinner.stop(`Loaded ${activeEntries.length} PRs.`);

  // Sync plan statuses based on PR state
  syncPlanStatuses(activeEntries, prStatuses, dataDir, slug);

  // --merged: non-interactive batch archive of merged worktrees
  if (flags.merged) {
    const mergedEntries = activeEntries.filter(
      ([name]) => prStatuses.get(name)?.state === "MERGED",
    );

    if (mergedEntries.length === 0) {
      p.log.info("No merged worktrees found.");
      saveWorktrees(dataDir, slug, data);
      p.outro("Done.");
      return;
    }

    for (const [name, entry] of mergedEntries) {
      const pr = prStatuses.get(name);
      p.note(`${pc.bold(entry.branch)}  ${prBadge(pr ?? null, pc)}`);
    }

    const confirmed = await p.confirm({
      message: `Archive ${pc.bold(String(mergedEntries.length))} merged worktree(s)?`,
    });
    if (cancelled(confirmed) || !confirmed) {
      p.log.info("Cancelled.");
      saveWorktrees(dataDir, slug, data);
      p.outro("Done.");
      return;
    }

    const mergedNames = mergedEntries.map(([name]) => name);
    await archiveWorktrees(
      mergedNames,
      data,
      repoRoot,
      dataDir,
      slug,
      protectedBranches,
    );
    saveWorktrees(dataDir, slug, data);
    p.outro(pc.green(`Archived ${mergedNames.length} worktree(s).`));
    return;
  }

  // Compute pre-selection: merged worktrees are pre-checked
  const mergedNames = activeEntries
    .filter(([name]) => prStatuses.get(name)?.state === "MERGED")
    .map(([name]) => name);

  const STATUS_PAD = 12;
  const selected = await p.multiselect({
    message: "Select worktrees to remove",
    options: activeEntries.map(([name, entry]) => {
      const status = getStatusFromPlan(planFilePath(dataDir, slug, name));
      const pr = prStatuses.get(name);
      return {
        value: name,
        label: entry.branch,
        hint: `${statusBadge(status, STATUS_PAD, pc)} ${prBadge(pr ?? null, pc)}`,
      };
    }),
    initialValues: mergedNames,
    required: false,
  });

  if (cancelled(selected)) bail("Cancelled.");

  const selectedNames = selected as string[];
  if (selectedNames.length === 0) {
    p.log.info("No worktrees selected.");
    saveWorktrees(dataDir, slug, data);
    p.outro("Done.");
    return;
  }

  const confirmed = await p.confirm({
    message: `Remove ${pc.bold(String(selectedNames.length))} worktree(s)?`,
  });
  if (cancelled(confirmed) || !confirmed) {
    p.log.info("Cancelled.");
    saveWorktrees(dataDir, slug, data);
    p.outro("Done.");
    return;
  }

  await archiveWorktrees(
    selectedNames,
    data,
    repoRoot,
    dataDir,
    slug,
    protectedBranches,
  );
  saveWorktrees(dataDir, slug, data);
  p.outro(pc.green(`Archived ${selectedNames.length} worktree(s).`));
}

// ---------------------------------------------------------------------------
// Status line (reads JSON from stdin, outputs worktree | branch | ctx N%)
// ---------------------------------------------------------------------------

async function statusLine(): Promise<void> {
  const inputRaw = tryReadFileSync("/dev/stdin");
  const input: any = tryParseJson(inputRaw, {});

  const cwd: string | undefined = input.cwd || input.workspace?.current_dir;
  const usedPct: number | undefined = input.context_window?.used_percentage;

  const parts: string[] = [];

  const dataDir = resolveDataDir();
  const wtMatch = cwd ? findWorktreeForCwd(cwd, dataDir) : null;
  let branch: string | null = null;

  if (wtMatch?.branch) {
    branch = wtMatch.branch;
  } else if (cwd) {
    // Fallback: git branch
    try {
      branch = (await git(cwd).raw("symbolic-ref", "--short", "HEAD")).trim();
    } catch {
      // not a git repo or detached HEAD
    }
  }

  if (branch) {
    parts.push(branch);
  } else if (cwd) {
    const homePrefix = HOME + "/";
    parts.push(
      cwd.startsWith(homePrefix) ? "~/" + cwd.slice(homePrefix.length) : cwd,
    );
  }

  // PR status
  if (wtMatch) {
    const entries: [string, WorktreeEntry][] = [
      [
        wtMatch.name,
        loadWorktrees(dataDir, wtMatch.slug).worktrees[wtMatch.name],
      ],
    ].filter(([, e]) => !!e) as [string, WorktreeEntry][];
    if (entries.length > 0) {
      const meta = loadRepoMeta(dataDir, wtMatch.slug);
      if (meta?.repoRoot) {
        const prStatuses = await fetchPRStatuses(entries, meta.repoRoot);
        const pr = prStatuses.get(wtMatch.name);
        if (pr) {
          parts.push(`PR #${pr.number} ${prStateLabel(pr)}`);
        }
      }
    }
  }

  // Context usage
  if (usedPct != null) {
    parts.push(`ctx ${Math.round(usedPct)}%`);
  }

  console.log(parts.join(" | "));
}

// ---------------------------------------------------------------------------
// Install command
// ---------------------------------------------------------------------------

function installCommand(): void {
  console.log("→ Configuring claudet...");
  const actions: string[] = [];

  // 1. Remove legacy symlink at ~/.claude/scripts/claudet.ts
  const legacySymlink = resolve(HOME, ".claude", "scripts", "claudet.ts");
  if (existsSync(legacySymlink)) {
    try {
      const stat = lstatSync(legacySymlink);
      if (stat.isSymbolicLink()) {
        unlinkSync(legacySymlink);
        actions.push("removed legacy symlink ~/.claude/scripts/claudet.ts");
      }
    } catch {
      // ignore — already gone or permission issue
    }
    // rmdir if empty
    const scriptsDir = dirname(legacySymlink);
    try {
      const remaining = readdirSync(scriptsDir);
      if (remaining.length === 0) {
        rmdirSync(scriptsDir);
        actions.push("removed empty ~/.claude/scripts/");
      }
    } catch {
      // ignore
    }
  }

  // 2. Remove legacy .claude/rules/session.md from all worktrees
  const dataDir = resolveDataDir();
  const slugs = loadRepoSlugs(dataDir);
  for (const slug of slugs) {
    const wtBase = resolve(dataDir, "repos", slug, "worktrees");
    if (!existsSync(wtBase)) continue;
    try {
      for (const name of readdirSync(wtBase)) {
        const sessionFile = resolve(
          wtBase,
          name,
          ".claude",
          "rules",
          "session.md",
        );
        if (existsSync(sessionFile)) {
          unlinkSync(sessionFile);
          // rmdir .claude/rules if empty
          const rulesDir = dirname(sessionFile);
          try {
            if (readdirSync(rulesDir).length === 0) rmdirSync(rulesDir);
          } catch {}
          // rmdir .claude if empty
          const claudeDir = dirname(rulesDir);
          try {
            if (readdirSync(claudeDir).length === 0) rmdirSync(claudeDir);
          } catch {}
          actions.push(`removed ${slug}/${name}/.claude/rules/session.md`);
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Update statusline in settings.json
  const settings = tryParseJson<Record<string, unknown>>(
    tryReadFileSync(GLOBAL_SETTINGS_FILE),
    {},
  );
  const statusLine = settings.statusLine as Record<string, unknown> | undefined;
  const desiredCommand = "claudet statusline";
  if (
    !statusLine ||
    statusLine.type !== "command" ||
    statusLine.command !== desiredCommand
  ) {
    settings.statusLine = { type: "command", command: desiredCommand };
    const dir = dirname(GLOBAL_SETTINGS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      GLOBAL_SETTINGS_FILE,
      JSON.stringify(settings, null, 2) + "\n",
    );
    actions.push("updated statusline → claudet statusline");
  }

  for (const action of actions) {
    console.log(`  ✓ ${action}`);
  }
  if (actions.length === 0) {
    console.log("  ✓ configuration already up to date");
  }

  // 3. Verify
  console.log("");
  console.log("→ Verifying...");

  // Check version
  try {
    const installed = execFileSync("claudet", ["--version"], {
      encoding: "utf-8",
    }).trim();
    if (installed === PKG_VERSION) {
      console.log(`  ✓ claudet --version: ${installed}`);
    } else {
      console.log(
        `  ⚠ version mismatch: installed=${installed}, package=${PKG_VERSION}`,
      );
    }
  } catch {
    console.log("  ✗ claudet --version failed");
  }

  // Check statusline
  try {
    execSync("echo '{}' | claudet statusline", {
      encoding: "utf-8",
      timeout: 5000,
    });
    console.log("  ✓ claudet statusline: ok");
  } catch {
    console.log("  ✗ claudet statusline failed");
  }

  console.log("");
  console.log("Done.");
}

// ---------------------------------------------------------------------------
// Init command
// ---------------------------------------------------------------------------

async function runInitSetup(): Promise<void> {
  const existing = loadGlobalConfig();

  const scanDirsInput = await p.text({
    message: "Directories to scan for git repos (comma-separated)",
    placeholder: "~/repos, ~/work",
    defaultValue: existing.scanDirs?.join(", ") || "~/repos",
    initialValue: existing.scanDirs?.join(", ") || "",
  });
  if (cancelled(scanDirsInput)) bail("Cancelled.");

  const highPriorityTargetInput = await p.text({
    message: "High-priority target (sort first)",
    placeholder: "main",
    defaultValue: existing.highPriorityTarget || "main",
    initialValue: existing.highPriorityTarget || "",
  });
  if (cancelled(highPriorityTargetInput)) bail("Cancelled.");

  const defaultTargetInput = await p.text({
    message: "Default target branch (base for branching & PRs)",
    placeholder: "dev",
    defaultValue: existing.defaultTarget || "dev",
    initialValue: existing.defaultTarget || "",
  });
  if (cancelled(defaultTargetInput)) bail("Cancelled.");

  const dataDirInput = await p.text({
    message: "Data directory for claudet",
    placeholder: "~/.claudet",
    defaultValue: existing.dataDir || "~/.claudet",
    initialValue: existing.dataDir || "",
  });
  if (cancelled(dataDirInput)) bail("Cancelled.");

  const scanDirs = (scanDirsInput as string)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dataDir = (dataDirInput as string).trim() || "~/.claudet";

  const highPriorityTarget =
    (highPriorityTargetInput as string).trim() || "main";
  const defaultTarget = (defaultTargetInput as string).trim() || "dev";

  const config: GlobalConfig = { scanDirs };
  if (dataDir !== "~/.claudet") {
    config.dataDir = dataDir;
  }
  if (highPriorityTarget !== "main") {
    config.highPriorityTarget = highPriorityTarget;
  }
  if (defaultTarget !== "dev") {
    config.defaultTarget = defaultTarget;
  }

  p.note(
    [
      `${pc.dim("Scan dirs")}       ${scanDirs.join(", ")}`,
      `${pc.dim("High priority")}   ${highPriorityTarget}`,
      `${pc.dim("Normal target")}   ${defaultTarget}`,
      `${pc.dim("Data dir")}        ${dataDir}`,
      `${pc.dim("Config")}          ${GLOBAL_CONFIG_PATH}`,
    ].join("\n"),
    "Settings",
  );

  const confirmed = await p.confirm({ message: "Save?" });
  if (cancelled(confirmed) || !confirmed) bail("Cancelled.");

  saveGlobalConfig(config);
}

async function initCommand(): Promise<void> {
  p.intro(`${pc.bold(pc.cyan("claudet init"))} — Configure global settings`);
  await runInitSetup();
  p.outro("Configuration saved.");
}

// ---------------------------------------------------------------------------
// Tool permission setup — triggered when settings.local.json is missing
// ---------------------------------------------------------------------------

interface ToolGroup {
  label: string;
  hint: string;
  tools: string[];
}

const READ_ONLY_TOOL_GROUPS: ToolGroup[] = [
  {
    label: "Git read-only",
    hint: "git log, diff, status, branch, show, stash list",
    tools: [
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git status:*)",
      "Bash(git branch:*)",
      "Bash(git show:*)",
      "Bash(git stash list:*)",
    ],
  },
  {
    label: "File search & read",
    hint: "Read, Glob, Grep",
    tools: ["Read", "Glob", "Grep"],
  },
  {
    label: "Web access",
    hint: "WebFetch, WebSearch",
    tools: ["WebFetch", "WebSearch"],
  },
  {
    label: "Text processing",
    hint: "jq, wc, sort, head, tail",
    tools: [
      "Bash(jq:*)",
      "Bash(wc:*)",
      "Bash(sort:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
    ],
  },
  {
    label: "Directory listing",
    hint: "tree, ls",
    tools: ["Bash(tree:*)", "Bash(ls:*)"],
  },
];

const WRITE_TOOL_GROUPS: ToolGroup[] = [
  {
    label: "Git write",
    hint: "git stash, checkout, worktree, tag",
    tools: [
      "Bash(git stash:*)",
      "Bash(git checkout:*)",
      "Bash(git worktree:*)",
      "Bash(git tag:*)",
    ],
  },
  {
    label: "Node.js (pnpm)",
    hint: "install, add, lint, test, typecheck, format, run, exec, e2e",
    tools: [
      "Bash(pnpm install:*)",
      "Bash(pnpm add:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm typecheck:*)",
      "Bash(pnpm format:*)",
      "Bash(pnpm run:*)",
      "Bash(pnpm exec:*)",
      "Bash(pnpm e2e:test:*)",
    ],
  },
  {
    label: "Node.js (npm)",
    hint: "npm install, test, run, etc.",
    tools: ["Bash(npm:*)"],
  },
  {
    label: "Python (poetry)",
    hint: "install, lock, add, run",
    tools: [
      "Bash(poetry install:*)",
      "Bash(poetry lock:*)",
      "Bash(poetry add:*)",
      "Bash(poetry run:*)",
    ],
  },
  {
    label: "Mobile / Expo",
    hint: "expo, adb, gradlew, maestro-cli",
    tools: [
      "Bash(pnpm exec expo start:*)",
      "Bash(pnpm exec expo export:*)",
      "Bash(adb:*)",
      "Bash(./gradlew:*)",
      "Bash(./android/gradlew:*)",
      "Bash(maestro-cli:*)",
    ],
  },
  {
    label: "Shell utilities",
    hint: "curl, cat, echo, xargs, timeout",
    tools: [
      "Bash(curl:*)",
      "Bash(cat:*)",
      "Bash(echo:*)",
      "Bash(xargs:*)",
      "Bash(timeout:*)",
    ],
  },
  {
    label: "Process management",
    hint: "pkill, lsof",
    tools: ["Bash(pkill:*)", "Bash(lsof:*)"],
  },
];

async function ensureToolPermissions(): Promise<void> {
  const settings = tryParseJson<Record<string, unknown>>(
    tryReadFileSync(GLOBAL_SETTINGS_FILE),
    {},
  );
  const permissions = settings.permissions as
    | Record<string, unknown>
    | undefined;
  if (permissions?.allow) return;

  p.log.info("No tool permissions configured — let's set them up.");

  // Ask about read-only tools
  const enableReadOnly = await p.confirm({
    message: "Enable read-only tools? (safe — no side effects)",
    initialValue: true,
  });
  if (cancelled(enableReadOnly)) bail("Cancelled.");

  const selectedGroups: ToolGroup[] = [];

  if (enableReadOnly) {
    selectedGroups.push(...READ_ONLY_TOOL_GROUPS);
  } else {
    const readOnlySelection = await p.multiselect({
      message: "Select read-only tool groups to enable",
      options: READ_ONLY_TOOL_GROUPS.map((g) => ({
        value: g.label,
        label: g.label,
        hint: g.hint,
      })),
      required: false,
    });
    if (cancelled(readOnlySelection)) bail("Cancelled.");
    for (const label of readOnlySelection as string[]) {
      const group = READ_ONLY_TOOL_GROUPS.find((g) => g.label === label);
      if (group) selectedGroups.push(group);
    }
  }

  // Ask about write tools
  const writeSelection = await p.multiselect({
    message: "Select write tool groups to enable",
    options: WRITE_TOOL_GROUPS.map((g) => ({
      value: g.label,
      label: g.label,
      hint: g.hint,
    })),
    required: false,
  });
  if (cancelled(writeSelection)) bail("Cancelled.");
  for (const label of writeSelection as string[]) {
    const group = WRITE_TOOL_GROUPS.find((g) => g.label === label);
    if (group) selectedGroups.push(group);
  }

  const allow = selectedGroups.flatMap((g) => g.tools);
  if (!permissions) {
    settings.permissions = { allow };
  } else {
    permissions.allow = allow;
  }

  const dir = dirname(GLOBAL_SETTINGS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(GLOBAL_SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");

  const summary = selectedGroups
    .map((g) => `  ${pc.green("✓")} ${g.label} ${pc.dim(`(${g.hint})`)}`)
    .join("\n");
  p.note(summary, "Tool permissions saved");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [subcommand, subArg] = process.argv.slice(2);

switch (subcommand) {
  case "init":
    initCommand().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case "create":
    createCommand().catch((err) => {
      console.log(
        JSON.stringify({ ok: false, error: String(err.message || err) }),
      );
      process.exit(1);
    });
    break;
  case "clean":
    cleanFlow(parseCleanFlags(process.argv.slice(3))).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case "install":
    installCommand();
    break;
  case "context":
    contextCommand();
    break;
  case "statusline":
    statusLine().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case "worklog":
    switch (subArg) {
      case "start":
        worklogStart().catch((err) => {
          console.error(err);
          process.exit(1);
        });
        break;
      case "tick":
        worklogTick().catch((err) => {
          console.error(err);
          process.exit(1);
        });
        break;
      case "migrate":
        worklogMigrate();
        break;
      default:
        console.error(`Unknown worklog command: ${subArg}`);
        process.exit(1);
    }
    break;
  case "--version":
  case "-v":
    console.log(PKG_VERSION);
    break;
  case undefined:
    interactiveFlow().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  default:
    console.log(`
  ${pc.bold(pc.cyan("claudet"))} — Worktree management + Claude launcher

  ${pc.dim("Usage:")}
    claudet                  Interactive: select repo → worktree → start claude
    claudet init             Configure global settings (scan dirs, data dir)
    claudet install          Configure statusline, remove legacy files, verify
    claudet create           Non-interactive: create worktree + plan (JSON output)
    claudet clean            Select worktrees to archive
    claudet context          Sync context docs to ~/.claude/claudet/
    claudet statusline       Output status line (reads JSON from stdin)
    claudet worklog start    Log session start (called by hook)
    claudet worklog tick     Log tick + update time (called by hook)
    claudet --version        Show version
    claudet --help           Show this help

  ${pc.dim("claudet create flags:")}
    --branch, -b <name>      Branch name (required)
    --target, -t <branch>    Base branch (default: project config defaultTarget or dev)
    --ticket <id>            Issue tracker ticket ID
    --skip-setup             Skip setup commands
    --repo <path>            Main repo root (auto-detected from worktrees)

  ${pc.dim("claudet clean flags:")}
    --merged                 Auto-archive all worktrees with merged PRs
`);
    process.exit(subcommand === "--help" || subcommand === "-h" ? 0 : 1);
}
