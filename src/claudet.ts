import { execSync, spawn } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  renameSync,
} from 'fs'
import { resolve, dirname, basename, join } from 'path'
import { fileURLToPath } from 'url'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import simpleGit, { type SimpleGit } from 'simple-git'
import { Octokit } from '@octokit/rest'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')
).version

const HOME = process.env.HOME || process.env.USERPROFILE || ''
const REPOS_FILE = resolve(HOME, '.claude', 'repos.json')
const GLOBAL_WORKTREES_FILE = resolve(HOME, '.claude', 'worktrees.json')
const PLANS_DIR = resolve(HOME, '.claude', 'plans')

function worktreesFilePath(repoRoot: string): string {
  return resolve(repoRoot, '.claude', 'worktrees.json')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runLoud(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function bail(msg: string): never {
  p.cancel(msg)
  process.exit(1)
}

function cancelled(value: unknown): value is symbol {
  return p.isCancel(value)
}

// ---------------------------------------------------------------------------
// Git + GitHub library helpers
// ---------------------------------------------------------------------------

function git(cwd: string): SimpleGit {
  return simpleGit(cwd)
}

function resolveGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN

  const hostsPath = join(HOME, '.config', 'gh', 'hosts.yml')
  try {
    const content = readFileSync(hostsPath, 'utf-8')
    const match = content.match(/oauth_token:\s*(.+)/)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

function getOctokit(): Octokit | null {
  const token = resolveGitHubToken()
  if (!token) return null
  return new Octokit({ auth: token })
}

// ---------------------------------------------------------------------------
// Status badge formatting
// ---------------------------------------------------------------------------

function statusBadge(status: string, pad = 0): string {
  const text = pad > 0 ? status.padEnd(pad) : status
  switch (status) {
    case 'in-progress':
      return pc.yellow(text)
    case 'review':
      return pc.blue(text)
    case 'done':
      return pc.green(text)
    case 'pending':
      return pc.dim(text)
    default:
      return pc.dim(text)
  }
}

function prBadge(pr: PRStatus | null): string {
  if (!pr) return pc.dim('no PR')
  const conflict = pr.mergeable === 'CONFLICTING' ? `  ${pc.red('⚠ conflicts')}` : ''
  switch (pr.state) {
    case 'OPEN':
      return pc.green(`PR #${pr.number} open`) + conflict
    case 'MERGED':
      return pc.magenta(`PR #${pr.number} merged`)
    case 'CLOSED':
      return pc.red(`PR #${pr.number} closed`)
    default:
      return pc.dim(`PR #${pr.number}`)
  }
}

// ---------------------------------------------------------------------------
// worktrees.json management
// ---------------------------------------------------------------------------

interface WorktreeEntry {
  branch: string
  target: string
  path: string
  repo: string
  planPath: string
  archivedAt: string | null
}

interface WorktreesData {
  worktrees: Record<string, WorktreeEntry>
}

interface PRStatus {
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  url: string
  number: number
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

interface RepoInfo {
  owner: string
  repo: string
}

// ---------------------------------------------------------------------------
// Repo registry (repos.json)
// ---------------------------------------------------------------------------

function loadRepos(): string[] {
  if (!existsSync(REPOS_FILE)) return []
  try {
    return JSON.parse(readFileSync(REPOS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveRepos(repos: string[]): void {
  const dir = dirname(REPOS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2) + '\n')
}

function registerRepo(repoRoot: string): void {
  const repos = loadRepos()
  if (!repos.includes(repoRoot)) {
    repos.push(repoRoot)
    saveRepos(repos)
  }
}

// ---------------------------------------------------------------------------
// One-time migration from global worktrees.json
// ---------------------------------------------------------------------------

function migrateGlobalWorktrees(): void {
  if (!existsSync(GLOBAL_WORKTREES_FILE)) return

  let globalData: WorktreesData
  try {
    globalData = JSON.parse(readFileSync(GLOBAL_WORKTREES_FILE, 'utf-8'))
  } catch {
    return
  }

  // Group entries by repo
  const byRepo = new Map<string, Record<string, WorktreeEntry>>()
  for (const [name, entry] of Object.entries(globalData.worktrees)) {
    if (!entry.repo) continue
    if (!byRepo.has(entry.repo)) byRepo.set(entry.repo, {})
    byRepo.get(entry.repo)![name] = entry
  }

  // Write each group to <repoRoot>/.claude/worktrees.json (merge with existing)
  for (const [repoRoot, entries] of byRepo) {
    const filePath = worktreesFilePath(repoRoot)
    let existing: WorktreesData = { worktrees: {} }
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        // overwrite malformed file
      }
    }
    for (const [name, entry] of Object.entries(entries)) {
      if (!existing.worktrees[name]) {
        existing.worktrees[name] = entry
      }
    }
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n')
    registerRepo(repoRoot)
  }

  // Rename global file to .migrated
  renameSync(GLOBAL_WORKTREES_FILE, GLOBAL_WORKTREES_FILE + '.migrated')
}

// ---------------------------------------------------------------------------
// Per-repo worktrees.json management
// ---------------------------------------------------------------------------

function loadWorktrees(repoRoot: string): WorktreesData {
  const filePath = worktreesFilePath(repoRoot)
  if (!existsSync(filePath)) {
    return { worktrees: {} }
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

function saveWorktrees(repoRoot: string, data: WorktreesData): void {
  const filePath = worktreesFilePath(repoRoot)
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}

// ---------------------------------------------------------------------------
// Plan file management
// ---------------------------------------------------------------------------

function createPlanFile(name: string, entry: Partial<WorktreeEntry>): string {
  const planPath = resolve(PLANS_DIR, `${name}.md`)
  if (!existsSync(PLANS_DIR)) mkdirSync(PLANS_DIR, { recursive: true })

  if (!existsSync(planPath)) {
    const today = new Date().toISOString().split('T')[0]
    const content = `# ${name}

## Context
<!-- Why this change is being made -->

## Objective
<!-- What will be done -->

## ClickUp Ticket
<!-- Link or ID, e.g., CU-abc123 -->

## Target Branch
${entry.target || 'dev'}

## Key Files
<!-- Files that will be created/modified -->

## Test Scenarios
<!-- Test plan grouped by tier -->

## Status
pending

## Progress
<!-- Append-only log. Claude and user append entries as work progresses. -->
<!-- ALL change requests must be logged here, even when requested outside Claude plan mode. -->
- ${today}: Created worktree, started planning
`
    writeFileSync(planPath, content)
  }

  return planPath
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function getCheckedOutLocation(branch: string, cwd: string): Promise<string | null> {
  const output = await git(cwd).raw('worktree', 'list', '--porcelain')
  const entries = output.split('\n\n')
  for (const entry of entries) {
    const lines = entry.split('\n')
    const wtLine = lines.find((l) => l.startsWith('worktree '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    if (branchLine && wtLine) {
      const ref = branchLine.replace('branch refs/heads/', '')
      if (ref === branch) return wtLine.replace('worktree ', '')
    }
  }
  return null
}

async function branchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await git(cwd).revparse(['--verify', branch])
    return true
  } catch {
    return false
  }
}

function deriveShortName(branch: string): string {
  return branch
    .replace(/^(feat|fix|chore|feature|test)\//, '')
    .replace(/\//g, '-')
}

function isSmokeTestWorktree(name: string): boolean {
  return name.startsWith('worktree-smoke-') || name.startsWith('test-worktree-smoke-')
}

// ---------------------------------------------------------------------------
// GitHub API — PR status detection
// ---------------------------------------------------------------------------

async function getRepoInfo(cwd: string): Promise<RepoInfo | null> {
  try {
    const url = (await git(cwd).remote(['get-url', 'origin'])) as string | undefined
    if (!url) return null
    const trimmed = url.trim()
    const sshMatch = trimmed.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }
    const httpsMatch = trimmed.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/)
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }
    return null
  } catch {
    return null
  }
}

async function fetchPRStatuses(
  entries: [string, WorktreeEntry][],
  repoRoot: string,
  onPhase?: (msg: string) => void
): Promise<Map<string, PRStatus | null>> {
  const result = new Map<string, PRStatus | null>()
  const info = await getRepoInfo(repoRoot)
  const octokit = getOctokit()

  if (!info || !octokit) {
    for (const [name] of entries) result.set(name, null)
    return result
  }

  // Build branch → worktree name lookup
  const branchToName = new Map<string, string>()
  for (const [name, entry] of entries) {
    branchToName.set(entry.branch, name)
  }

  // Bulk fetch recent PRs (most recent 100 covers all active branches)
  onPhase?.('Fetching PRs…')
  let allPRs: Awaited<ReturnType<typeof octokit.rest.pulls.list>>['data']
  try {
    const { data } = await octokit.rest.pulls.list({
      owner: info.owner,
      repo: info.repo,
      state: 'all',
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    })
    allPRs = data
  } catch {
    for (const [name] of entries) result.set(name, null)
    return result
  }

  // Match PRs to worktree branches (take first match = most recent)
  const matched = new Map<string, (typeof allPRs)[number]>()
  for (const pr of allPRs) {
    const wtName = branchToName.get(pr.head.ref)
    if (wtName && !matched.has(wtName)) {
      matched.set(wtName, pr)
    }
  }

  // For open PRs, fetch mergeable status in parallel
  const openPRs = [...matched.entries()].filter(([, pr]) => pr.state === 'open')
  if (openPRs.length > 0) {
    onPhase?.(`Checking merge status… (${openPRs.length} open)`)
  }
  const mergeableMap = new Map<string, boolean | null>()
  const mergeableResults = await Promise.all(
    openPRs.map(async ([name, pr]) => {
      try {
        const { data } = await octokit.rest.pulls.get({
          owner: info.owner,
          repo: info.repo,
          pull_number: pr.number,
        })
        return { name, mergeable: data.mergeable }
      } catch {
        return { name, mergeable: null }
      }
    })
  )
  for (const { name, mergeable } of mergeableResults) {
    mergeableMap.set(name, mergeable)
  }

  // Build final result
  for (const [name] of entries) {
    const pr = matched.get(name)
    if (!pr) {
      result.set(name, null)
      continue
    }

    const state: PRStatus['state'] = pr.merged_at
      ? 'MERGED'
      : pr.state === 'open'
        ? 'OPEN'
        : 'CLOSED'

    let mergeable: PRStatus['mergeable'] = 'UNKNOWN'
    const m = mergeableMap.get(name)
    if (m === true) mergeable = 'MERGEABLE'
    else if (m === false) mergeable = 'CONFLICTING'

    result.set(name, { state, url: pr.html_url, number: pr.number, mergeable })
  }

  return result
}


// ---------------------------------------------------------------------------
// Auto-sync: seed worktrees.json from git worktree list
// ---------------------------------------------------------------------------

async function autoSync(repoRoot: string): Promise<WorktreesData> {
  const s = p.spinner()
  s.start('Loading worktrees...')

  registerRepo(repoRoot)
  const data = loadWorktrees(repoRoot)
  const output = await git(repoRoot).raw('worktree', 'list', '--porcelain')
  const entries = output.split('\n\n').filter((e) => e.trim())
  let synced = 0

  for (const entry of entries) {
    const lines = entry.split('\n')
    const wtLine = lines.find((l) => l.startsWith('worktree '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    if (!wtLine || !branchLine) continue

    const path = wtLine.replace('worktree ', '')
    const branch = branchLine.replace('branch refs/heads/', '')

    if (path === repoRoot) continue

    const shortName = basename(path)
    if (isSmokeTestWorktree(shortName)) continue
    if (data.worktrees[shortName]) continue

    const planPath = createPlanFile(shortName, { target: 'dev', branch })

    data.worktrees[shortName] = {
      branch,
      target: 'dev',
      path,
      repo: repoRoot,
      planPath,
      archivedAt: null,
    }
    synced++
  }

  saveWorktrees(repoRoot, data)

  if (synced > 0) {
    s.stop(`Loaded worktrees (synced ${synced} new).`)
  } else {
    s.stop('Worktrees loaded.')
  }

  return data
}

// ---------------------------------------------------------------------------
// Worktree creation
// ---------------------------------------------------------------------------

async function createWorktree(
  repoRoot: string,
  branch: string,
  target: string,
  shortName: string,
  skipSetup: boolean
): Promise<WorktreeEntry> {
  const worktreeDir = resolve(dirname(repoRoot), 'worktrees')
  const wtPath = resolve(worktreeDir, shortName)
  const g = git(repoRoot)
  const isExisting = await branchExists(branch, repoRoot)

  if (!isExisting && !target) {
    bail('Target branch is required when creating a new branch.')
  }

  if (existsSync(wtPath)) {
    bail(`Worktree path already exists: ${wtPath}`)
  }

  if (!existsSync(worktreeDir)) {
    mkdirSync(worktreeDir, { recursive: true })
  }

  const s = p.spinner()

  if (isExisting) {
    const checkedOutAt = await getCheckedOutLocation(branch, repoRoot)
    if (checkedOutAt) {
      if (checkedOutAt === repoRoot) {
        s.start('Freeing branch from main repo...')
        try {
          await g.checkout('dev')
        } catch {
          await g.raw('checkout', '--detach')
        }
        s.stop('Switched main repo to dev.')
      } else {
        bail(`Branch "${branch}" is already checked out in worktree: ${checkedOutAt}`)
      }
    }

    s.start(`Fetching ${pc.cyan(branch)}...`)
    try {
      await g.fetch('origin', branch)
      s.stop(`Fetched ${pc.cyan(branch)} from origin.`)
    } catch {
      s.stop(pc.dim('No remote tracking, skipped fetch.'))
    }

    s.start(`Creating worktree ${pc.bold(shortName)}...`)
    await g.raw('worktree', 'add', wtPath, branch)
    s.stop(`Created worktree ${pc.bold(shortName)}.`)

    try {
      await git(wtPath).pull()
    } catch {
      // No upstream
    }
  } else {
    if (!(await branchExists(target, repoRoot))) {
      try {
        await g.fetch('origin', target)
      } catch {
        bail(`Base branch "${target}" does not exist locally or on origin.`)
      }
      if (!(await branchExists(`origin/${target}`, repoRoot))) {
        bail(`Base branch "${target}" does not exist.`)
      }
    }

    s.start(`Creating worktree ${pc.bold(shortName)} from ${pc.cyan(target)}...`)
    await g.raw('worktree', 'add', '-b', branch, wtPath, target)
    s.stop(`Created worktree ${pc.bold(shortName)}.`)
  }

  // Symlink .claude/settings.local.json
  const localSettings = resolve(repoRoot, '.claude', 'settings.local.json')
  if (existsSync(localSettings)) {
    const destDir = resolve(wtPath, '.claude')
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    const destPath = resolve(destDir, 'settings.local.json')
    if (!existsSync(destPath)) {
      symlinkSync(localSettings, destPath)
    }
  }

  // Symlink .env* files
  const envFiles = readdirSync(repoRoot).filter(
    (f) => f.startsWith('.env') && statSync(resolve(repoRoot, f)).isFile()
  )
  for (const envFile of envFiles) {
    const targetPath = resolve(repoRoot, envFile)
    const link = resolve(wtPath, envFile)
    if (!existsSync(link)) {
      symlinkSync(targetPath, link)
    }
  }

  if (envFiles.length > 0) {
    p.log.step(`Symlinked ${envFiles.length} env file(s) + settings.`)
  }

  if (!skipSetup) {
    s.start('Installing dependencies...')
    runLoud('pnpm install', wtPath)
    s.stop('Dependencies installed.')

    s.start('Generating Prisma client...')
    runLoud('pnpm exec prisma generate', wtPath)
    s.stop('Prisma client generated.')
  }

  // Create plan file and register
  const planPath = createPlanFile(shortName, { target, branch })

  const entry: WorktreeEntry = {
    branch,
    target,
    path: wtPath,
    repo: repoRoot,
    planPath,
    archivedAt: null,
  }

  registerRepo(repoRoot)
  const data = loadWorktrees(repoRoot)
  data.worktrees[shortName] = entry
  saveWorktrees(repoRoot, data)

  p.note(
    [
      `${pc.dim('Path')}    ${wtPath}`,
      `${pc.dim('Branch')}  ${pc.cyan(branch)}`,
      `${pc.dim('Target')}  ${target}`,
      `${pc.dim('Plan')}    ${planPath}`,
    ].join('\n'),
    'Worktree Ready'
  )

  return entry
}

// ---------------------------------------------------------------------------
// Plan file helpers
// ---------------------------------------------------------------------------

function getStatusFromPlan(planPath: string): string {
  if (!existsSync(planPath)) return 'unknown'
  const content = readFileSync(planPath, 'utf-8')
  const match = content.match(/^## Status\s*\n([^\n#]+)/m)
  return match ? match[1].trim() : 'unknown'
}

function getLastProgress(planPath: string): string | null {
  if (!existsSync(planPath)) return null
  const content = readFileSync(planPath, 'utf-8')
  const progressSection = content.split('## Progress')[1]
  if (!progressSection) return null
  const lines = progressSection
    .split('\n')
    .filter((l) => l.startsWith('- ') && !l.startsWith('<!-- '))
  return lines.length > 0 ? lines[lines.length - 1].replace(/^- /, '') : null
}

// ---------------------------------------------------------------------------
// Draft PR creation
// ---------------------------------------------------------------------------

async function pushAndCreateDraftPR(cwd: string, branch: string, target: string): Promise<void> {
  const s = p.spinner()
  s.start('Pushing branch to origin...')
  try {
    await git(cwd).push('origin', branch, ['--set-upstream'])
    s.stop(`Pushed ${pc.cyan(branch)} to origin.`)
  } catch (err: any) {
    s.stop(pc.yellow(`Could not push branch: ${err.message || err}`))
    return
  }

  const info = await getRepoInfo(cwd)
  const octokit = getOctokit()
  if (!info || !octokit) {
    p.log.warn('Could not resolve GitHub repo or token — skipping PR creation.')
    return
  }

  s.start('Creating draft PR...')
  try {
    const { data: pr } = await octokit.rest.pulls.create({
      owner: info.owner,
      repo: info.repo,
      head: branch,
      base: target,
      title: branch,
      body: 'WIP',
      draft: true,
    })
    s.stop(`Draft PR: ${pc.underline(pr.html_url)}`)
  } catch (err: any) {
    s.stop(pc.yellow(`Could not create draft PR: ${err.message || err}`))
  }
}

// ---------------------------------------------------------------------------
// Launch claude
// ---------------------------------------------------------------------------

function launchClaude(cwd: string): void {
  p.outro(pc.dim(`Launching claude in ${cwd}`))
  const child = spawn('claude', [], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

// ---------------------------------------------------------------------------
// Interactive flow
// ---------------------------------------------------------------------------

async function interactiveFlow(): Promise<void> {
  p.intro(`${pc.bold(pc.cyan('claudet'))} ${pc.dim(`v${PKG_VERSION}`)}`)

  migrateGlobalWorktrees()

  // Discover repos from registry
  const repos = loadRepos().filter((r) => existsSync(r))

  let repoRoot: string
  let data: WorktreesData

  if (repos.length === 0) {
    const input = await p.text({
      message: 'Enter path to git repository',
      placeholder: '~/repos/my-project',
    })
    if (cancelled(input)) bail('Cancelled.')
    repoRoot = resolve((input as string).replace(/^~/, HOME))
    if (!existsSync(repoRoot)) bail(`Path does not exist: ${repoRoot}`)
    registerRepo(repoRoot)
    data = await autoSync(repoRoot)
  } else if (repos.length === 1) {
    repoRoot = repos[0]
    p.log.step(`Repository: ${pc.cyan(basename(dirname(repoRoot)) + '/' + basename(repoRoot))}`)
    data = await autoSync(repoRoot)
  } else {
    const selected = await p.select({
      message: 'Select repository',
      options: repos.map((r) => ({
        value: r,
        label: `${basename(dirname(r))}/${basename(r)}`,
        hint: r,
      })),
    })
    if (cancelled(selected)) bail('Cancelled.')
    repoRoot = selected as string
    data = await autoSync(repoRoot)
  }

  // Filter active worktrees
  const activeEntries = Object.entries(data.worktrees).filter(
    ([name, entry]) => entry.repo === repoRoot && !entry.archivedAt && !isSmokeTestWorktree(name)
  )

  if (activeEntries.length === 0) {
    p.log.warn('No active worktrees found.')
    const shouldCreate = await p.confirm({ message: 'Create a new worktree?' })
    if (cancelled(shouldCreate) || !shouldCreate) bail('Cancelled.')
    await createNewWorktreeFlow(repoRoot)
    return
  }

  // Fetch PR statuses
  const prSpinner = p.spinner()
  prSpinner.start('Fetching PRs…')
  const prStatuses = await fetchPRStatuses(activeEntries, repoRoot, (msg) =>
    prSpinner.message(msg)
  )
  prSpinner.stop(`Loaded ${activeEntries.length} PRs.`)

  // Build select options
  const STATUS_PAD = 12
  const CREATE_NEW = '__create_new__'
  const options = [
    ...activeEntries.map(([name, entry]) => {
      const status = getStatusFromPlan(entry.planPath)
      const pr = prStatuses.get(name)
      return {
        value: name,
        label: `${statusBadge(status, STATUS_PAD)} ${name}`,
        hint: `${pc.dim(entry.branch)}  ${prBadge(pr ?? null)}`,
      }
    }),
    {
      value: CREATE_NEW,
      label: pc.green('+ Create new worktree'),
      hint: '',
    },
  ]

  const selection = await p.select({
    message: 'Select worktree',
    options,
  })

  if (cancelled(selection)) bail('Cancelled.')

  if (selection === CREATE_NEW) {
    await createNewWorktreeFlow(repoRoot)
    return
  }

  // Selected existing worktree
  const entry = data.worktrees[selection as string]
  const status = getStatusFromPlan(entry.planPath)
  const lastProgress = getLastProgress(entry.planPath)

  let pr = prStatuses.get(selection as string) ?? null
  const infoLines = [
    `${pc.dim('Plan')}    ${entry.planPath}`,
    `${pc.dim('Status')}  ${statusBadge(status)}`,
  ]
  if (pr) {
    infoLines.push(`${pc.dim('PR')}      ${prBadge(pr)}  ${pc.underline(pr.url)}`)
  }
  if (lastProgress) {
    infoLines.push(`${pc.dim('Last')}    ${lastProgress}`)
  }
  p.note(infoLines.join('\n'), selection as string)

  // Offer to create a draft PR if none exists
  if (!pr) {
    const createPR = await p.confirm({
      message: 'No PR found. Create a draft PR?',
      initialValue: false,
    })
    if (!cancelled(createPR) && createPR) {
      await pushAndCreateDraftPR(entry.path, entry.branch, entry.target)
    }
  }

  launchClaude(entry.path)
}

// ---------------------------------------------------------------------------
// Create new worktree flow
// ---------------------------------------------------------------------------

async function createNewWorktreeFlow(repoRoot: string): Promise<void> {
  const result = await p.group(
    {
      branch: () =>
        p.text({
          message: 'Branch name',
          placeholder: 'feat/new-feature',
          validate: (v) => (!v ? 'Branch name is required' : undefined),
        }),
      target: () =>
        p.text({
          message: 'Target branch',
          placeholder: 'dev',
          initialValue: 'dev',
        }),
      clickup: () =>
        p.text({
          message: 'ClickUp ticket',
          placeholder: 'CU-abc123 (optional)',
        }),
      draftPR: () =>
        p.confirm({
          message: 'Create draft PR?',
          initialValue: false,
        }),
    },
    {
      onCancel: () => bail('Cancelled.'),
    }
  )

  const branch = result.branch as string
  const target = (result.target as string) || 'dev'
  const clickup = result.clickup as string
  const draftPR = result.draftPR as boolean
  const shortName = deriveShortName(branch)

  const entry = await createWorktree(repoRoot, branch, target, shortName, false)

  // Write ClickUp ticket to plan if provided
  if (clickup) {
    const planContent = readFileSync(entry.planPath, 'utf-8')
    const updated = planContent.replace(
      /## ClickUp Ticket\n<!-- Link or ID, e.g., CU-abc123 -->/,
      `## ClickUp Ticket\n${clickup}`
    )
    writeFileSync(entry.planPath, updated)
  }

  // Create draft PR
  if (draftPR) {
    await pushAndCreateDraftPR(entry.path, branch, target)
  }

  launchClaude(entry.path)
}

// ---------------------------------------------------------------------------
// Clean flow
// ---------------------------------------------------------------------------

async function cleanFlow(): Promise<void> {
  p.intro(pc.bold(pc.red('claudet clean')))

  migrateGlobalWorktrees()

  // Select repo
  const repos = loadRepos().filter((r) => existsSync(r))
  let repoRoot: string

  if (repos.length === 0) {
    p.log.info('No registered repositories.')
    p.outro('Done.')
    return
  } else if (repos.length === 1) {
    repoRoot = repos[0]
    p.log.step(`Repository: ${pc.cyan(basename(dirname(repoRoot)) + '/' + basename(repoRoot))}`)
  } else {
    const selected = await p.select({
      message: 'Select repository',
      options: repos.map((r) => ({
        value: r,
        label: `${basename(dirname(r))}/${basename(r)}`,
        hint: r,
      })),
    })
    if (cancelled(selected)) bail('Cancelled.')
    repoRoot = selected as string
  }

  const data = loadWorktrees(repoRoot)
  const allEntries = Object.entries(data.worktrees)

  // Auto-remove smoke test worktrees
  const smokeEntries = allEntries.filter(([name]) => isSmokeTestWorktree(name))
  let smokeRemoved = 0
  for (const [name, entry] of smokeEntries) {
    if (entry.archivedAt) {
      delete data.worktrees[name]
      smokeRemoved++
      continue
    }
    const g = git(entry.repo)
    try {
      await g.raw('worktree', 'remove', entry.path, '--force')
    } catch { /* already gone */ }
    try {
      await g.raw('worktree', 'prune')
    } catch {}
    try {
      await g.deleteLocalBranch(entry.branch, true)
    } catch {}
    delete data.worktrees[name]
    smokeRemoved++
  }

  if (smokeRemoved > 0) {
    p.log.success(`Auto-removed ${smokeRemoved} smoke test worktree(s).`)
  }

  // Filter active, non-smoke worktrees
  const activeEntries = Object.entries(data.worktrees).filter(
    ([name, entry]) => !entry.archivedAt && !isSmokeTestWorktree(name)
  )

  if (activeEntries.length === 0) {
    p.log.info('No active worktrees to clean.')
    saveWorktrees(repoRoot, data)
    p.outro('Done.')
    return
  }

  // Fetch PR statuses
  const prSpinner = p.spinner()
  prSpinner.start('Fetching PRs…')
  const prStatuses = await fetchPRStatuses(activeEntries, repoRoot, (msg) =>
    prSpinner.message(msg)
  )
  prSpinner.stop(`Loaded ${activeEntries.length} PRs.`)

  const STATUS_PAD = 12
  const selected = await p.multiselect({
    message: 'Select worktrees to remove',
    options: activeEntries.map(([name, entry]) => {
      const status = getStatusFromPlan(entry.planPath)
      const pr = prStatuses.get(name)
      return {
        value: name,
        label: `${statusBadge(status, STATUS_PAD)} ${name}`,
        hint: `${pc.dim(entry.branch)}  ${prBadge(pr ?? null)}`,
      }
    }),
    required: false,
  })

  if (cancelled(selected)) bail('Cancelled.')

  const selectedNames = selected as string[]
  if (selectedNames.length === 0) {
    p.log.info('No worktrees selected.')
    saveWorktrees(repoRoot, data)
    p.outro('Done.')
    return
  }

  const confirmed = await p.confirm({
    message: `Remove ${pc.bold(String(selectedNames.length))} worktree(s)?`,
  })
  if (cancelled(confirmed) || !confirmed) {
    p.log.info('Cancelled.')
    saveWorktrees(repoRoot, data)
    p.outro('Done.')
    return
  }

  const s = p.spinner()
  for (const name of selectedNames) {
    const entry = data.worktrees[name]
    s.start(`Archiving ${pc.bold(name)}...`)

    const g = git(entry.repo)
    try {
      await g.raw('worktree', 'remove', entry.path, '--force')
    } catch {
      // already gone
    }
    try {
      await g.raw('worktree', 'prune')
    } catch {}

    data.worktrees[name] = {
      ...entry,
      archivedAt: new Date().toISOString(),
    }

    s.stop(`Archived ${pc.bold(name)}.`)
  }

  saveWorktrees(repoRoot, data)
  p.outro(pc.green(`Archived ${selectedNames.length} worktree(s).`))
}

// ---------------------------------------------------------------------------
// Status line (reads JSON from stdin, outputs worktree | branch | ctx N%)
// ---------------------------------------------------------------------------

async function statusLine(): Promise<void> {
  let inputRaw = ''
  try {
    inputRaw = readFileSync('/dev/stdin', 'utf-8')
  } catch {
    // empty
  }

  let input: any = {}
  try {
    input = JSON.parse(inputRaw)
  } catch {
    // empty
  }

  const cwd: string | undefined = input.cwd || input.workspace?.current_dir
  const usedPct: number | undefined = input.context_window?.used_percentage

  const parts: string[] = []

  // Match cwd against worktree paths across all registered repos
  let matched = false
  if (cwd) {
    const repos = loadRepos()
    for (const repoRoot of repos) {
      const filePath = worktreesFilePath(repoRoot)
      if (!existsSync(filePath)) continue
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'))
        for (const [name, entry] of Object.entries(data.worktrees) as [string, any][]) {
          if (entry.archivedAt) continue
          if (cwd.startsWith(entry.path)) {
            parts.push(name)
            if (entry.branch) parts.push(entry.branch)
            matched = true
            break
          }
        }
      } catch {
        // Malformed JSON — skip this repo
      }
      if (matched) break
    }
  }

  // Fallback: git branch
  if (!matched && cwd) {
    try {
      const branch = (await git(cwd).raw('symbolic-ref', '--short', 'HEAD')).trim()
      if (branch) {
        const worktreeMatch = cwd.match(/\/repos\/[^/]+\/worktrees\/([^/]+)/)
        if (worktreeMatch) {
          parts.push(worktreeMatch[1])
        } else {
          const homePrefix = HOME + '/'
          parts.push(cwd.startsWith(homePrefix) ? '~/' + cwd.slice(homePrefix.length) : cwd)
        }
        parts.push(branch)
      }
    } catch {
      if (cwd) {
        const homePrefix = HOME + '/'
        parts.push(cwd.startsWith(homePrefix) ? '~/' + cwd.slice(homePrefix.length) : cwd)
      }
    }
  }

  // Context usage
  if (usedPct != null) {
    parts.push(`ctx ${Math.round(usedPct)}%`)
  }

  console.log(parts.join(' | '))
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [subcommand] = process.argv.slice(2)

switch (subcommand) {
  case 'clean':
    cleanFlow().catch((err) => {
      console.error(err)
      process.exit(1)
    })
    break
  case 'statusline':
    statusLine().catch((err) => {
      console.error(err)
      process.exit(1)
    })
    break
  case undefined:
    interactiveFlow().catch((err) => {
      console.error(err)
      process.exit(1)
    })
    break
  default:
    console.log(`
  ${pc.bold(pc.cyan('claudet'))} — Worktree management + Claude launcher

  ${pc.dim('Usage:')}
    claudet               Interactive: select repo → worktree → start claude
    claudet clean          Select worktrees to archive
    claudet statusline     Output status line (reads JSON from stdin)
    claudet --help         Show this help
`)
    process.exit(subcommand === '--help' || subcommand === '-h' ? 0 : 1)
}
