import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { deriveRepoSlug } from "./helpers.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("claudet create", () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp && existsSync(tmp)) {
      rmSync(tmp, { recursive: true, force: true });
    }
    tmp = null;
  });

  it("creates new branches from origin target instead of stale local target", () => {
    tmp = mkdtempSync(join(tmpdir(), "claudet-create-"));
    const remote = join(tmp, "remote.git");
    const seed = join(tmp, "seed");
    const repoRoot = join(tmp, "repo");

    git(tmp, ["init", "--bare", "--initial-branch=main", remote]);
    git(tmp, ["init", "--initial-branch=main", seed]);
    git(seed, ["config", "user.email", "test@example.com"]);
    git(seed, ["config", "user.name", "Test User"]);
    writeFileSync(join(seed, "base.txt"), "stale local base\n");
    git(seed, ["add", "base.txt"]);
    git(seed, ["commit", "-m", "initial"]);
    git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-u", "origin", "main"]);

    git(tmp, ["clone", remote, repoRoot]);
    const staleLocalMain = git(repoRoot, ["rev-parse", "main"]).trim();

    writeFileSync(join(seed, "base.txt"), "fresh remote base\n");
    git(seed, ["add", "base.txt"]);
    git(seed, ["commit", "-m", "advance main"]);
    git(seed, ["push", "origin", "main"]);
    const freshRemoteMain = git(seed, ["rev-parse", "main"]).trim();

    const home = join(tmp, "home");
    const dataDir = join(tmp, "data");
    mkdirSync(join(home, ".claudet"), { recursive: true });
    writeJson(join(home, ".claudet", "config.json"), {
      scanDirs: [],
      highPriorityTarget: "main",
      defaultTarget: "main",
      protectedBranches: ["main"],
      setup: [],
      sandbox: { enabled: false, allowedDomains: [] },
    });

    const slug = deriveRepoSlug(repoRoot);
    const repoDataDir = join(dataDir, "repos", slug);
    mkdirSync(join(repoDataDir, "plans"), { recursive: true });
    mkdirSync(join(repoDataDir, "worktrees"), { recursive: true });
    writeJson(join(repoDataDir, "config.json"), {
      defaultTarget: "main",
      setup: [],
      protectedBranches: ["main"],
      sandbox: { enabled: false, allowedDomains: [] },
    });

    const tsx = resolve(
      import.meta.dirname!,
      "..",
      "node_modules",
      ".bin",
      "tsx",
    );
    const claudet = resolve(import.meta.dirname!, "claudet.ts");
    const output = execFileSync(
      tsx,
      [
        claudet,
        "create",
        "--repo",
        repoRoot,
        "--branch",
        "feat/use-remote-target",
        "--target",
        "main",
        "--skip-setup",
      ],
      {
        cwd: resolve(import.meta.dirname!, ".."),
        env: {
          ...process.env,
          HOME: home,
          CLAUDET_DATA_DIR: dataDir,
        },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const result = JSON.parse(output) as {
      ok: true;
      worktree: { path: string };
    };
    const wtPath = result.worktree.path;

    expect(git(repoRoot, ["rev-parse", "main"]).trim()).toBe(staleLocalMain);
    expect(git(wtPath, ["rev-parse", "HEAD"]).trim()).toBe(freshRemoteMain);
    expect(readFileSync(join(wtPath, "base.txt"), "utf-8")).toBe(
      "fresh remote base\n",
    );
  });
});
