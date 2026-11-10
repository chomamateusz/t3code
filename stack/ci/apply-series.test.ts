import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "apply-series.sh");
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Author",
  GIT_AUTHOR_EMAIL: "author@example.invalid",
  GIT_COMMITTER_NAME: "Author",
  GIT_COMMITTER_EMAIL: "author@example.invalid",
  GIT_AUTHOR_DATE: "2026-11-10T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-11-10T00:00:00Z",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

function commitFile(repo: string, path: string, content: string, message: string): void {
  writeFileSync(join(repo, path), content);
  git(repo, "add", path);
  git(repo, "commit", "-q", "-m", message);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "apply-series-"));
  const carried = join(root, "carried");
  mkdirSync(carried);
  git(carried, "init", "-q", "-b", "main");
  commitFile(carried, "a.txt", "one\ntwo\nthree\n", "base");
  const base = git(carried, "rev-parse", "HEAD");
  commitFile(carried, "a.txt", "one\nTWO\nthree\n", "✨ Shout the second line");
  commitFile(carried, "b.txt", "bee\n", "🐝 Add a bee");
  const stack = join(root, "stack");
  mkdirSync(join(stack, "patches"), { recursive: true });
  git(carried, "format-patch", "-q", "--keep-subject", "--zero-commit", "--no-signature", "-o", join(stack, "patches"), `${base}..HEAD`);
  const source = join(root, "source");
  git(root, "clone", "-q", carried, source);
  git(source, "checkout", "-q", "--detach", base);
  return { root, carried, stack, source, base };
}

function apply(stack: string, source: string, result: string) {
  return spawnSync("bash", [script, stack, source, result], { env, encoding: "utf8" });
}

describe("apply-series.sh", () => {
  it("applies the series and reproduces the carried tree and subjects", () => {
    const { root, carried, stack, source, base } = fixture();
    try {
      const run = apply(stack, source, join(root, "result.json"));
      expect(run.status).toBe(0);
      const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
      expect(result).toMatchObject({ status: "applied", upstreamSha: base, patches: 2 });
      expect(result.tree).toBe(git(carried, "rev-parse", "HEAD^{tree}"));
      expect(git(source, "log", "--format=%s", `${base}..HEAD`)).toBe(git(carried, "log", "--format=%s", `${base}..HEAD`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the failing patch and its conflicted paths", () => {
    const { root, stack, source } = fixture();
    try {
      commitFile(source, "a.txt", "one\nzwei\nthree\n", "upstream edits the same line");
      const run = apply(stack, source, join(root, "result.json"));
      expect(run.status).toBe(1);
      expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8"))).toMatchObject({
        status: "failed",
        patches: 2,
        failedIndex: 1,
        failedPatch: "0001-Shout-the-second-line.patch",
        failedSubject: "✨ Shout the second line",
        conflictedPaths: ["a.txt"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the paths a patch fails on when the source lacks the blobs for a 3-way merge", () => {
    const { root, stack } = fixture();
    const upstream = join(root, "upstream");
    try {
      mkdirSync(upstream);
      git(upstream, "init", "-q", "-b", "main");
      commitFile(upstream, "a.txt", "one\nzwei\nthree\n", "upstream without the carried base");
      const run = apply(stack, upstream, join(root, "result.json"));
      expect(run.status).toBe(1);
      expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8"))).toMatchObject({
        status: "failed",
        failedIndex: 1,
        failedPatch: "0001-Shout-the-second-line.patch",
        conflictedPaths: ["a.txt"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a dirty source checkout", () => {
    const { root, stack, source } = fixture();
    try {
      writeFileSync(join(source, "a.txt"), "dirty\n");
      expect(apply(stack, source, join(root, "result.json")).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
