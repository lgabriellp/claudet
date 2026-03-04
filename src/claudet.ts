import { execSync, spawn } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
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
  isSmokeTestWorktree,
  parseCreateFlags,
  formatDuration,
  parseDuration,
  getStatusFromPlan as getStatusFromPlanContent,
  getLastProgress as getLastProgressContent,
  type CreateFlags,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
).version;

const HOME = process.env.HOME || process.env.USERPROFILE || "";
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
  dataDir?: string;
  defaultTarget?: string;
  setup?: string[];
}

function loadProjectConfig(repoRoot: string): ProjectConfig {
  const configPath = resolve(repoRoot, ".claudet.json");
  if (!existsSync(configPath)) return {};
  return tryParseJson<ProjectConfig>(tryReadFileSync(configPath), {});
}

function resolveDataDir(repoRoot?: string): string {
  // 1. Env var (always wins)
  if (process.env.CLAUDET_DATA_DIR) {
    return resolve(expandHome(process.env.CLAUDET_DATA_DIR));
  }

  // 2. Repo-level .claudet.json
  if (repoRoot) {
    const config = loadProjectConfig(repoRoot);
    if (config.dataDir) {
      return resolve(expandHome(config.dataDir));
    }
  }

  // 3. Global config
  const globalConfigPath = resolve(HOME, ".config", "claudet", "config.json");
  if (existsSync(globalConfigPath)) {
    const config = tryParseJson<{ dataDir?: string }>(
      tryReadFileSync(globalConfigPath),
      {},
    );
    if (config.dataDir) {
      return resolve(expandHome(config.dataDir));
    }
  }

  // 4. Default
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
}

interface WorktreesData {
  worktrees: Record<string, WorktreeEntry>;
}

interface RepoMeta {
  repoRoot: string;
  registeredAt: string;
}

interface PRStatus {
  state: "OPEN" | "MERGED" | "CLOSED";
  url: string;
  number: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
}

interface RepoInfo {
  owner: string;
  repo: string;
}

// ---------------------------------------------------------------------------
// Repo registry (directory-based)
// ---------------------------------------------------------------------------

function loadRepoSlugs(dataDir: string): string[] {
  const reposDir = resolve(dataDir, "repos");
  if (!existsSync(reposDir)) return [];
  return readdirSync(reposDir).filter((entry) => {
    const entryPath = resolve(reposDir, entry);
    return (
      statSync(entryPath).isDirectory() &&
      existsSync(metaJsonPath(dataDir, entry))
    );
  });
}

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
// Status badge formatting
// ---------------------------------------------------------------------------

function statusBadge(status: string, pad = 0): string {
  const text = pad > 0 ? status.padEnd(pad) : status;
  switch (status) {
    case "in-progress":
      return pc.yellow(text);
    case "review":
      return pc.blue(text);
    case "done":
      return pc.green(text);
    case "pending":
      return pc.dim(text);
    default:
      return pc.dim(text);
  }
}

function prBadge(pr: PRStatus | null): string {
  if (!pr) return pc.dim("no PR");
  const conflict =
    pr.mergeable === "CONFLICTING" ? `  ${pc.red("⚠ conflicts")}` : "";
  switch (pr.state) {
    case "OPEN":
      return pc.green(`PR #${pr.number} open`) + conflict;
    case "MERGED":
      return pc.magenta(`PR #${pr.number} merged`);
    case "CLOSED":
      return pc.red(`PR #${pr.number} closed`);
    default:
      return pc.dim(`PR #${pr.number}`);
  }
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
    const ticketSection = entry.ticket ? `\n## Ticket\n${entry.ticket}\n` : "";
    const content = `# ${name}

## Context
<!-- Why this change is being made -->

## Objective
<!-- What will be done -->
${ticketSection}
## Target Branch
${entry.target || "dev"}

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
    writeFileSync(pPath, content);

    appendWorklog(dataDir, {
      event: "plan_created",
      timestamp: Date.now(),
      plan: name,
    });
  }

  return pPath;
}

function getStatusFromPlan(pPath: string): string {
  if (!existsSync(pPath)) return "unknown";
  return getStatusFromPlanContent(readFileSync(pPath, "utf-8"));
}

function getLastProgress(pPath: string): string | null {
  if (!existsSync(pPath)) return null;
  return getLastProgressContent(readFileSync(pPath, "utf-8"));
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
    .catch(() => null);

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
  const mergeableResults = await Promise.all(
    openPRs.map(async ([name, pr]) => {
      try {
        const { data } = await octokit.rest.pulls.get({
          owner: info.owner,
          repo: info.repo,
          pull_number: pr.number,
        });
        return { name, mergeable: data.mergeable };
      } catch {
        return { name, mergeable: null };
      }
    }),
  );
  for (const { name, mergeable } of mergeableResults) {
    mergeableMap.set(name, mergeable);
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
    result.set(name, {
      state,
      url: pr.html_url,
      number: pr.number,
      mergeable,
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
        branch = execSync("git symbolic-ref --short HEAD", {
          cwd: dirPath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // fall back to entry name
      }

      data.worktrees[entry] = { branch, target: "dev", archivedAt: null };
      createPlanFile(dataDir, slug, entry, { target: "dev", branch });
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
      data.worktrees[name] = { branch, target: "dev", archivedAt: null };
      createPlanFile(dataDir, slug, name, { target: "dev", branch });
      changed = true;
    }
  } catch {
    // git worktree list failed — skip cross-check
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
  const input: any = tryParseJson(inputRaw, {});

  const sessionId: string | undefined = input.session_id;
  const cwd: string | undefined = input.cwd;

  if (!sessionId || !cwd) return;

  const dataDir = resolveDataDir();
  const wtMatch = findWorktreeForCwd(cwd, dataDir);
  if (!wtMatch) return;

  const pPath = planFilePath(dataDir, wtMatch.slug, wtMatch.name);
  if (!existsSync(pPath)) return;

  const now = Date.now();
  const state = {
    slug: wtMatch.slug,
    plan: wtMatch.name,
    planPath: pPath,
    startTime: now,
    lastTick: now,
  };
  writeFileSync(sessionStatePath(sessionId), JSON.stringify(state));

  const planStatus = getStatusFromPlan(pPath);
  appendWorklog(dataDir, {
    event: "session_start",
    timestamp: now,
    plan: wtMatch.name,
    planStatus,
  });
}

async function worklogTick(): Promise<void> {
  const inputRaw = tryReadFileSync("/dev/stdin");
  const input: any = tryParseJson(inputRaw, {});

  const sessionId: string | undefined = input.session_id;
  if (!sessionId) return;

  const statePath = sessionStatePath(sessionId);
  if (!existsSync(statePath)) return;

  const state: any = tryParseJson(tryReadFileSync(statePath), null);
  if (!state) return;

  const dataDir = resolveDataDir();
  const now = Date.now();
  const elapsedSinceLastTick = now - state.lastTick;

  // Update plan time tracked
  if (state.planPath) {
    updatePlanTimeTracked(state.planPath, elapsedSinceLastTick);
  }

  // Promote pending → in-progress
  if (state.planPath && existsSync(state.planPath)) {
    const content = readFileSync(state.planPath, "utf-8");
    const statusMatch = content.match(/^## Status\s*\n([^\n#]+)/m);
    if (statusMatch && statusMatch[1].trim() === "pending") {
      const updated = content.replace(
        /^(## Status\s*\n)pending/m,
        "$1in-progress",
      );
      writeFileSync(state.planPath, updated);
    }
  }

  const planStatus = getStatusFromPlan(state.planPath);
  const elapsedMs = now - state.startTime;
  appendWorklog(dataDir, {
    event: "tick",
    timestamp: now,
    plan: state.plan,
    elapsedMs,
    planStatus,
  });

  // Update lastTick in state
  state.lastTick = now;
  writeFileSync(statePath, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Draft PR creation
// ---------------------------------------------------------------------------

async function pushAndCreateDraftPR(
  cwd: string,
  branch: string,
  target: string,
): Promise<void> {
  const s = p.spinner();
  s.start("Pushing branch to origin...");
  try {
    await git(cwd).push("origin", branch, ["--set-upstream"]);
    s.stop(`Pushed ${pc.cyan(branch)} to origin.`);
  } catch (err: any) {
    s.stop(pc.yellow(`Could not push branch: ${err.message || err}`));
    return;
  }

  const info = await getRepoInfo(cwd);
  const octokit = getOctokit();
  if (!info || !octokit) {
    p.log.warn(
      "Could not resolve GitHub repo or token — skipping PR creation.",
    );
    return;
  }

  s.start("Creating draft PR...");
  try {
    const { data: pr } = await octokit.rest.pulls.create({
      owner: info.owner,
      repo: info.repo,
      head: branch,
      base: target,
      title: branch,
      body: "WIP",
      draft: true,
    });
    s.stop(`Draft PR: ${pc.underline(pr.html_url)}`);
  } catch (err: any) {
    s.stop(pc.yellow(`Could not create draft PR: ${err.message || err}`));
  }
}

// ---------------------------------------------------------------------------
// Hook auto-configuration
// ---------------------------------------------------------------------------

function ensureWorklogHooks(): void {
  const settings: any = tryParseJson(tryReadFileSync(GLOBAL_SETTINGS_FILE), {});

  const requiredHooks: Record<
    string,
    { type: string; command: string; timeout: number }
  > = {
    SessionStart: {
      type: "command",
      command: "claudet worklog start",
      timeout: 10,
    },
    Stop: { type: "command", command: "claudet worklog tick", timeout: 10 },
  };

  let changed = false;

  for (const [event, hookDef] of Object.entries(requiredHooks)) {
    const existing: any[] = settings[event] || [];
    const hasOurHook = existing.some((matcher: any) =>
      (matcher.hooks || []).some(
        (h: any) => h.type === "command" && h.command === hookDef.command,
      ),
    );

    if (!hasOurHook) {
      existing.push({ hooks: [hookDef] });
      settings[event] = existing;
      changed = true;
    }
  }

  if (changed) {
    const dir = dirname(GLOBAL_SETTINGS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      GLOBAL_SETTINGS_FILE,
      JSON.stringify(settings, null, 2) + "\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Launch claude
// ---------------------------------------------------------------------------

function writeSessionRule(wtPath: string, planPath: string): void {
  const rulesDir = resolve(wtPath, ".claude", "rules");
  if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true });
  const content = `# Session Context (auto-generated by claudet)

Read the plan file at ${planPath} and begin.
`;
  writeFileSync(resolve(rulesDir, "session.md"), content);
}

function launchClaude(cwd: string, planPath?: string): void {
  ensureWorklogHooks();
  if (planPath) {
    writeSessionRule(cwd, planPath);
  }
  p.outro(pc.dim(`Launching claude in ${cwd}`));
  const args: string[] = [];
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

  // Run setup commands from project config
  if (!skipSetup) {
    const projectConfig = loadProjectConfig(repoRoot);
    const setupCommands = projectConfig.setup ?? [];
    for (const cmd of setupCommands) {
      if (quiet) {
        runLoud(cmd, wtPath);
      } else {
        s?.start(`Running: ${pc.dim(cmd)}...`);
        runLoud(cmd, wtPath);
        s?.stop(`Done: ${pc.dim(cmd)}`);
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
}

// ---------------------------------------------------------------------------
// Interactive flow
// ---------------------------------------------------------------------------

async function pickRepo(
  dataDir: string,
): Promise<{ slug: string; repoRoot: string }> {
  const slugs = loadRepoSlugs(dataDir);
  const repos = slugs
    .map((slug) => ({ slug, repoRoot: getRepoRoot(dataDir, slug) }))
    .filter(
      (r): r is { slug: string; repoRoot: string } =>
        r.repoRoot !== null && existsSync(r.repoRoot),
    );

  if (repos.length === 0) {
    const input = await p.text({
      message: "Enter path to git repository",
      placeholder: "~/repos/my-project",
    });
    if (cancelled(input)) bail("Cancelled.");
    const root = resolve(expandHome((input as string).trim()));
    if (!existsSync(root)) bail(`Path does not exist: ${root}`);
    const slug = registerRepo(dataDir, root);
    return { slug, repoRoot: root };
  }

  if (repos.length === 1) {
    const { slug, repoRoot } = repos[0];
    p.log.step(
      `Repository: ${pc.cyan(basename(dirname(repoRoot)) + "/" + basename(repoRoot))}`,
    );
    return { slug, repoRoot };
  }

  const selected = await p.select({
    message: "Select repository",
    options: repos.map((r) => ({
      value: r.slug,
      label: `${basename(dirname(r.repoRoot))}/${basename(r.repoRoot)}`,
      hint: r.repoRoot,
    })),
  });
  if (cancelled(selected)) bail("Cancelled.");
  return repos.find((r) => r.slug === (selected as string))!;
}

async function interactiveFlow(): Promise<void> {
  p.intro(`${pc.bold(pc.cyan("claudet"))} ${pc.dim(`v${PKG_VERSION}`)}`);

  const dataDir = resolveDataDir();

  const { slug, repoRoot } = await pickRepo(dataDir);

  const s = p.spinner();
  s.start("Loading worktrees...");
  const data = await reconcileWorktrees(dataDir, slug, repoRoot);
  const activeCount = Object.entries(data.worktrees).filter(
    ([name, entry]) => !entry.archivedAt && !isSmokeTestWorktree(name),
  ).length;
  s.stop(activeCount > 0 ? "Worktrees loaded." : "No active worktrees found.");

  const activeEntries = Object.entries(data.worktrees).filter(
    ([name, entry]) => !entry.archivedAt && !isSmokeTestWorktree(name),
  );

  if (activeEntries.length === 0) {
    const shouldCreate = await p.confirm({
      message: "Create a new worktree?",
    });
    if (cancelled(shouldCreate) || !shouldCreate) bail("Cancelled.");
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

  // Build select options
  const STATUS_PAD = 12;
  const CREATE_NEW = "__create_new__";
  const options = [
    ...activeEntries.map(([name, entry]) => {
      const status = getStatusFromPlan(planFilePath(dataDir, slug, name));
      const pr = prStatuses.get(name);
      return {
        value: name,
        label: `${statusBadge(status, STATUS_PAD)} ${name}`,
        hint: `${pc.dim(entry.branch)}  ${prBadge(pr ?? null)}`,
      };
    }),
    {
      value: CREATE_NEW,
      label: pc.green("+ Create new worktree"),
      hint: "",
    },
  ];

  const selection = await p.select({
    message: "Select worktree",
    options,
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
  const infoLines = [
    `${pc.dim("Plan")}    ${pPath}`,
    `${pc.dim("Status")}  ${statusBadge(status)}`,
  ];
  if (pr) {
    infoLines.push(
      `${pc.dim("PR")}      ${prBadge(pr)}  ${pc.underline(pr.url)}`,
    );
  }
  if (lastProgress) {
    infoLines.push(`${pc.dim("Last")}    ${lastProgress}`);
  }
  p.note(infoLines.join("\n"), selectedName);

  // Offer to create a draft PR if none exists
  if (!pr) {
    const createPR = await p.confirm({
      message: "No PR found. Create a draft PR?",
      initialValue: false,
    });
    if (!cancelled(createPR) && createPR) {
      await pushAndCreateDraftPR(selectedWtPath, entry.branch, entry.target);
    }
  }

  launchClaude(selectedWtPath, pPath);
}

// ---------------------------------------------------------------------------
// Create new worktree flow
// ---------------------------------------------------------------------------

async function createNewWorktreeFlow(
  dataDir: string,
  slug: string,
  repoRoot: string,
): Promise<void> {
  const projectConfig = loadProjectConfig(repoRoot);
  const defaultTarget = projectConfig.defaultTarget || "dev";

  const result = await p.group(
    {
      branch: () =>
        p.text({
          message: "Branch name",
          placeholder: "feat/new-feature",
          validate: (v) => (!v ? "Branch name is required" : undefined),
        }),
      target: () =>
        p.text({
          message: "Target branch",
          placeholder: defaultTarget,
          initialValue: defaultTarget,
        }),
      ticket: () =>
        p.text({
          message: "Issue tracker ticket",
          placeholder: "CU-abc123, JIRA-456, LIN-789 (optional)",
        }),
      draftPR: () =>
        p.confirm({
          message: "Create draft PR?",
          initialValue: false,
        }),
    },
    {
      onCancel: () => bail("Cancelled."),
    },
  );

  const branch = result.branch as string;
  const target = (result.target as string) || defaultTarget;
  const ticket = result.ticket as string;
  const draftPR = result.draftPR as boolean;
  const shortName = deriveShortName(branch);

  const { wtPath, planPath } = await createWorktree(
    dataDir,
    slug,
    repoRoot,
    branch,
    target,
    shortName,
    false,
    ticket || undefined,
  );

  if (draftPR) {
    await pushAndCreateDraftPR(wtPath, branch, target);
  }

  launchClaude(wtPath, planPath);
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

  const dataDir = resolveDataDir(repoRoot);
  const slug = registerRepo(dataDir, repoRoot);
  const projectConfig = loadProjectConfig(repoRoot);
  const target = flags.target || projectConfig.defaultTarget || "dev";
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

  if (flags.draftPR) {
    const wt = wtDirPath(dataDir, slug, shortName);
    await git(wt).push("origin", flags.branch, ["--set-upstream"]);
    const info = await getRepoInfo(wt);
    const octokit = getOctokit();
    if (info && octokit) {
      await octokit.rest.pulls.create({
        owner: info.owner,
        repo: info.repo,
        head: flags.branch,
        base: target,
        title: flags.branch,
        body: "WIP",
        draft: true,
      });
    }
  }

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

async function cleanFlow(): Promise<void> {
  p.intro(pc.bold(pc.red("claudet clean")));

  const dataDir = resolveDataDir();

  const slugs = loadRepoSlugs(dataDir);
  if (slugs.length === 0) {
    p.log.info("No registered repositories.");
    p.outro("Done.");
    return;
  }

  const { slug, repoRoot } = await pickRepo(dataDir);

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
    delete data.worktrees[name];
  }

  if (smokeRemoved > 0) {
    p.log.success(`Auto-removed ${smokeRemoved} smoke test worktree(s).`);
  }

  const activeEntries = Object.entries(data.worktrees).filter(
    ([name, entry]) => !entry.archivedAt && !isSmokeTestWorktree(name),
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

  const STATUS_PAD = 12;
  const selected = await p.multiselect({
    message: "Select worktrees to remove",
    options: activeEntries.map(([name, entry]) => {
      const status = getStatusFromPlan(planFilePath(dataDir, slug, name));
      const pr = prStatuses.get(name);
      return {
        value: name,
        label: `${statusBadge(status, STATUS_PAD)} ${name}`,
        hint: `${pc.dim(entry.branch)}  ${prBadge(pr ?? null)}`,
      };
    }),
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

  const archiveSpinner = p.spinner();
  for (const name of selectedNames) {
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

    data.worktrees[name] = {
      ...entry,
      archivedAt: new Date().toISOString(),
    };

    archiveSpinner.stop(`Archived ${pc.bold(name)}.`);
  }

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
  if (wtMatch) {
    parts.push(wtMatch.name);
    if (wtMatch.branch) parts.push(wtMatch.branch);
  }

  // Fallback: git branch
  if (!wtMatch && cwd) {
    try {
      const branch = (
        await git(cwd).raw("symbolic-ref", "--short", "HEAD")
      ).trim();
      if (branch) {
        const worktreeMatch = cwd.match(/\/repos\/[^/]+\/worktrees\/([^/]+)/);
        if (worktreeMatch) {
          parts.push(worktreeMatch[1]);
        } else {
          const homePrefix = HOME + "/";
          parts.push(
            cwd.startsWith(homePrefix)
              ? "~/" + cwd.slice(homePrefix.length)
              : cwd,
          );
        }
        parts.push(branch);
      }
    } catch {
      if (cwd) {
        const homePrefix = HOME + "/";
        parts.push(
          cwd.startsWith(homePrefix)
            ? "~/" + cwd.slice(homePrefix.length)
            : cwd,
        );
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
// CLI
// ---------------------------------------------------------------------------

const [subcommand, subArg] = process.argv.slice(2);

switch (subcommand) {
  case "create":
    createCommand().catch((err) => {
      console.log(
        JSON.stringify({ ok: false, error: String(err.message || err) }),
      );
      process.exit(1);
    });
    break;
  case "clean":
    cleanFlow().catch((err) => {
      console.error(err);
      process.exit(1);
    });
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
    claudet create           Non-interactive: create worktree + plan (JSON output)
    claudet clean            Select worktrees to archive
    claudet statusline       Output status line (reads JSON from stdin)
    claudet worklog start    Log session start (called by hook)
    claudet worklog tick     Log tick + update time (called by hook)
    claudet --version        Show version
    claudet --help           Show this help

  ${pc.dim("claudet create flags:")}
    --branch, -b <name>      Branch name (required)
    --target, -t <branch>    Base branch (default: .claudet.json defaultTarget or dev)
    --ticket <id>            Issue tracker ticket ID
    --draft-pr               Push and create a GitHub draft PR
    --skip-setup             Skip setup commands
    --repo <path>            Main repo root (auto-detected from worktrees)
`);
    process.exit(subcommand === "--help" || subcommand === "-h" ? 0 : 1);
}
