import { describe, expect, it } from "bun:test";
import { YAML } from "bun";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRun } from "./classify-run.ts";
import { isRecord } from "./lib.ts";

interface Step {
  readonly name: string;
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly shell?: string;
  readonly "working-directory"?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, unknown>;
}

interface Job {
  readonly needs?: string | string[];
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly outputs?: Record<string, string>;
  readonly defaults?: unknown;
  readonly container?: unknown;
  readonly services?: unknown;
  readonly steps: Step[];
}

const workflow = YAML.parse(readFileSync(join(import.meta.dir, "../workflow/stack-build.yml"), "utf8")) as {
  env?: Record<string, string>;
  jobs: Record<string, Job>;
};
const jobs = workflow.jobs;
const needsOf = (job: string) => [jobs[job]!.needs ?? []].flat();

function secretReferences(node: unknown, path: string, key: string): string[] {
  if (typeof node === "string") {
    const expressions = key === "if" ? [node] : [...node.matchAll(/\$\{\{(.*?)\}\}/gs)].map((match) => match[1]!);
    return expressions.some((expression) => /\bsecrets\b/.test(expression)) ? [path] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => secretReferences(item, `${path}[${isRecord(item) && typeof item.name === "string" ? item.name : index}]`, key));
  }
  if (isRecord(node)) return Object.entries(node).flatMap(([child, value]) => secretReferences(value, `${path}.${child}`, child));
  return [];
}

const pinnedAction = /^actions\/(?:checkout|download-artifact|upload-artifact)@[0-9a-f]{40}$/;
const runsCode = /\b(?:node|bun|bunx|npx|npm|pnpm|vp|python3?|ruby|perl|sh|bash|zsh|source|eval|exec)\b|(?:^|[\s;&|("'])\.{1,2}\/|local-stack|source\/|GITHUB_WORKSPACE|\.(?:sh|ts|mts|js|mjs|cjs|py)\b/m;

describe("secret scope", () => {
  it("references secrets only in the secret check and the signing step", () => {
    expect(secretReferences(workflow, "workflow", "")).toEqual([
      "workflow.jobs.macos_signing.steps[Check the macOS signing secrets].env.CERT_P12_BASE64",
      "workflow.jobs.macos_signing.steps[Check the macOS signing secrets].env.CERT_PASSWORD",
      "workflow.jobs.build_macos_arm64_signed.steps[Sign the app].env.STACK_MACOS_CERT_P12_BASE64",
      "workflow.jobs.build_macos_arm64_signed.steps[Sign the app].env.STACK_MACOS_CERT_PASSWORD",
    ]);
  });

  it.each(["macos_signing", "build_macos_arm64_signed"])("runs only pinned actions and inline steps in %s", (name) => {
    const job = jobs[name]!;
    expect([job.defaults, job.container, job.services]).toEqual([undefined, undefined, undefined]);
    const envKeys = [workflow.env, job.env, ...job.steps.map((step) => step.env)].flatMap((env) => Object.keys(env ?? {}));
    expect(envKeys.filter((key) => ["BASH_ENV", "ENV", "NODE_OPTIONS"].includes(key))).toEqual([]);
    for (const step of job.steps) {
      expect([step.shell, step["working-directory"]]).toEqual([undefined, undefined]);
      if (step.uses !== undefined) {
        expect(step.run).toBeUndefined();
        expect(step.uses).toMatch(pinnedAction);
      } else {
        expect(step.run).not.toMatch(runsCode);
      }
    }
    if (name === "macos_signing") expect(job.steps.map((step) => step.uses)).toEqual([undefined]);
  });

  it("records the downloaded files' digest before the verification job runs anything else", () => {
    const job = jobs.build_macos_arm64_verified!;
    const digest = job.steps.findIndex((step) => step.id === "digest");
    expect(digest).toBeGreaterThan(0);
    for (const step of job.steps.slice(0, digest)) expect(step.uses).toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/);
    expect(job.steps[digest]!.uses).toBeUndefined();
    expect(job.steps[digest]!.run).not.toMatch(runsCode);
    expect(job.outputs).toEqual({ sums_sha256: "${{ steps.digest.outputs.sums_sha256 }}" });
    for (const step of job.steps) {
      expect(step.uses ?? "").not.toContain("setup-source");
      expect(step["working-directory"]).toBeUndefined();
      expect(step.with?.name).not.toBe("source");
    }
    expect(needsOf("build_macos_arm64_verified")).not.toContain("build_macos_arm64_signed");
  });

  it("publishes the macOS files against the verification job's digest", () => {
    expect(jobs.release!.env!.MACOS_SUMS_SHA256).toBe("${{ needs.build_macos_arm64_verified.outputs.sums_sha256 }}");
    expect(jobs.release!.steps.filter((step) => step.with?.path === "macos-app").map((step) => step.with?.name)).toEqual([
      "macos-arm64-release",
      "macos-arm64-sums",
    ]);
  });

  it("keeps every intermediate macOS artifact for the same time", () => {
    const retention = Object.entries(jobs)
      .filter(([name]) => name.startsWith("build_macos_"))
      .flatMap(([, job]) => job.steps)
      .filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
      .map((step) => [step.with?.name, step.with?.["retention-days"]]);
    expect(retention).toEqual([
      ["macos-arm64-unsigned", 3],
      ["macos-arm64-stage", 3],
      ["macos-arm64-signed", 3],
      ["macos-arm64-release", 3],
      ["macos-arm64-sums", 3],
    ]);
    expect(jobs.prepare!.steps.find((step) => step.with?.name === "source")!.with!["retention-days"]).toBe(3);
  });
});

type Result = "success" | "failure" | "cancelled" | "skipped";
type Value = string | boolean | null;

interface Context {
  readonly results: Record<string, Result>;
  readonly outputs: Record<string, Record<string, string>>;
  readonly needs: readonly string[];
  readonly cancelled: boolean;
}

function evaluate(source: string, context: Context): Value {
  const tokens = source.match(/'[^']*'|==|!=|&&|\|\||[!()]|[\w.-]+/g) ?? [];
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++]!;
  const truthy = (value: Value) => value !== null && value !== false && value !== "";
  const lookup = (path: string): Value => {
    const [root, job, kind, key] = path.split(".");
    if (root === "github" && job === "repository") return "chomamateusz/t3code";
    if (root !== "needs" || !context.needs.includes(job!)) throw new Error(`unknown context ${path}`);
    if (kind === "result") return context.results[job!] ?? null;
    if (kind === "outputs") return context.outputs[job!]?.[key!] ?? "";
    throw new Error(`unknown context ${path}`);
  };
  const call = (name: string): Value => {
    if (name === "always") return true;
    if (name === "cancelled") return context.cancelled;
    if (name === "success") return !context.cancelled && context.needs.every((need) => context.results[need] === "success");
    if (name === "failure") return context.needs.some((need) => context.results[need] === "failure");
    throw new Error(`unknown function ${name}`);
  };
  const primary = (): Value => {
    const token = take();
    if (token === "(") {
      const value = or();
      if (take() !== ")") throw new Error(`unbalanced ${source}`);
      return value;
    }
    if (token === "!") return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1);
    if (peek() === "(") {
      take();
      if (take() !== ")") throw new Error(`arguments are not supported in ${source}`);
      return call(token);
    }
    return lookup(token);
  };
  const comparison = (): Value => {
    const left = primary();
    if (peek() === "==" || peek() === "!=") {
      const equal = take() === "==";
      return (left === primary()) === equal;
    }
    return left;
  };
  const and = (): Value => {
    let value = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      value = truthy(value) ? right : value;
    }
    return value;
  };
  const or = (): Value => {
    let value = and();
    while (peek() === "||") {
      take();
      const right = and();
      value = truthy(value) ? value : right;
    }
    return value;
  };
  const value = or();
  if (index !== tokens.length) throw new Error(`unparsed tokens in ${source}`);
  return value;
}

function jobRuns(condition: string | undefined, context: Context): boolean {
  const expression = condition ?? "success()";
  const withStatus = /\b(?:always|cancelled|success|failure)\(\)/.test(expression) ? expression : `success() && (${expression})`;
  const value = evaluate(withStatus, context);
  return value !== null && value !== false && value !== "";
}

function order(): string[] {
  const done: string[] = [];
  while (done.length < Object.keys(jobs).length) {
    const next = Object.keys(jobs).find((job) => !done.includes(job) && needsOf(job).every((need) => done.includes(need)));
    if (!next) throw new Error("the job graph has a cycle");
    done.push(next);
  }
  return done;
}

interface Scenario {
  readonly secrets: 0 | 1 | 2;
  readonly skip?: boolean;
  readonly fail?: string;
  readonly cancel?: string;
}

function simulate(scenario: Scenario) {
  const results: Record<string, Result> = {};
  const outputs: Record<string, Record<string, string>> = {};
  let cancelled = false;
  for (const job of order()) {
    const context = { results, outputs, needs: needsOf(job), cancelled };
    if (!jobRuns(jobs[job]!.if, context)) {
      results[job] = "skipped";
      continue;
    }
    if (job === scenario.cancel) {
      results[job] = "cancelled";
      cancelled = true;
    } else if (job === scenario.fail || (job === "macos_signing" && scenario.secrets === 1)) {
      results[job] = "failure";
    } else {
      results[job] = "success";
      if (job === "prepare") outputs[job] = { skip: String(scenario.skip ?? false), version: "0.1.9-local.stack.20261110.2" };
      if (job === "macos_signing") outputs[job] = { signing: String(scenario.secrets === 2) };
    }
  }
  const needs = Object.fromEntries(needsOf("report").map((job) => [job, { result: results[job], outputs: outputs[job] ?? {} }]));
  const macosRelease = results.release === "success" && evaluate(jobs.release!.env!.MACOS!.replace(/^\$\{\{(.*)\}\}$/s, "$1"), {
    results,
    outputs,
    needs: needsOf("release"),
    cancelled,
  });
  return { results, needs, macosRelease };
}

function fallback(needs: unknown) {
  const step = jobs.report!.steps.find((candidate) => candidate.name === "Write the run result without the report tooling")!;
  const dir = mkdtempSync(join(tmpdir(), "report-fallback-"));
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run!], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, NEEDS: JSON.stringify(needs), RUN_URL: "https://example.invalid/run", GITHUB_STEP_SUMMARY: summary },
  });
  expect(result.stderr).not.toContain("jq: error");
  expect(result.status).toBe(0);
  return JSON.parse(readFileSync(join(dir, "stack-result.json"), "utf8")) as Record<string, unknown>;
}

const macosJobs = ["build_macos_arm64", "build_macos_arm64_signed", "build_macos_arm64_packaged", "build_macos_arm64_verified"];

describe("job graph", () => {
  it.each<[string, Scenario, { release: Result; macos: boolean; macosJobs: Result; status: string; stage: string | null }]>([
    ["no secrets", { secrets: 0 }, { release: "success", macos: false, macosJobs: "skipped", status: "success", stage: null }],
    ["one secret", { secrets: 1 }, { release: "skipped", macos: false, macosJobs: "skipped", status: "failed", stage: "prepare" }],
    ["both secrets, all green", { secrets: 2 }, { release: "success", macos: true, macosJobs: "success", status: "success", stage: null }],
    ["nothing to build", { secrets: 2, skip: true }, { release: "skipped", macos: false, macosJobs: "skipped", status: "skipped", stage: null }],
    ["Linux build fails", { secrets: 2, fail: "build_linux_x64" }, { release: "skipped", macos: false, macosJobs: "success", status: "failed", stage: "build" }],
  ])("%s", (_, scenario, expected) => {
    const run = simulate(scenario);
    expect(run.results.release).toBe(expected.release);
    expect(Boolean(run.macosRelease)).toBe(expected.macos);
    expect(macosJobs.map((job) => run.results[job])).toEqual(macosJobs.map(() => expected.macosJobs));
    expect(run.results.report).toBe("success");
    const classified = classifyRun({ needs: run.needs, applyResult: undefined, runUrl: "https://example.invalid/run" });
    expect([classified.status, classified.stage]).toEqual([expected.status, expected.stage]);
    expect(classified.macosSigning).toBe(scenario.secrets === 2);
    const written = fallback(run.needs);
    expect([written.status, written.stage, written.macosSigning]).toEqual([classified.status, classified.stage, classified.macosSigning]);
  });

  it.each(macosJobs)("publishes nothing when %s fails", (failing) => {
    const run = simulate({ secrets: 2, fail: failing });
    expect(run.results.release).toBe("skipped");
    for (const job of macosJobs.slice(macosJobs.indexOf(failing) + 1)) expect(run.results[job]).toBe("skipped");
    const classified = classifyRun({ needs: run.needs, applyResult: undefined, runUrl: "https://example.invalid/run" });
    expect([classified.status, classified.stage]).toEqual(["failed", "build"]);
    expect([fallback(run.needs).status, fallback(run.needs).stage]).toEqual(["failed", "build"]);
  });

  it.each(["prepare", "build_macos_arm64_signed", "build_macos_arm64_verified"])("reports a run cancelled in %s and publishes nothing", (job) => {
    const run = simulate({ secrets: 2, cancel: job });
    expect(run.results.release).toBe("skipped");
    expect(run.results.report).toBe("success");
    const classified = classifyRun({ needs: run.needs, applyResult: undefined, runUrl: "https://example.invalid/run" });
    expect(classified.status).toBe("cancelled");
    expect(fallback(run.needs).status).toBe("cancelled");
  });
});
