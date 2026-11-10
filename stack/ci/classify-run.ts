import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isRecord, readOptionalJson } from "./lib.ts";

export type Stage = "apply" | "prepare" | "test" | "build" | "accept" | "release";
type PipelineStage = Exclude<Stage, "apply">;
type Status = "success" | "skipped" | "failed" | "cancelled";

const ORDER: readonly PipelineStage[] = ["prepare", "test", "build", "accept", "release"];

export function stageOfJob(job: string): PipelineStage {
  if (job === "prepare" || job === "macos_signing") return "prepare";
  if (job === "release") return "release";
  if (job.startsWith("build_")) return "build";
  if (job.startsWith("accept_")) return "accept";
  return "test";
}

function earliestStage(jobs: readonly string[]): PipelineStage | undefined {
  const stages = new Set(jobs.map(stageOfJob));
  return ORDER.find((stage) => stages.has(stage));
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function classifyRun(input: { needs: unknown; applyResult: unknown; runUrl: string }) {
  if (!isRecord(input.needs)) throw new Error("needs must be a JSON object");
  const results = new Map<string, string>();
  for (const [job, value] of Object.entries(input.needs)) {
    results.set(job, isRecord(value) && typeof value.result === "string" ? value.result : "unknown");
  }
  const prepare = input.needs.prepare;
  if (!isRecord(prepare)) throw new Error("needs.prepare is missing");
  const outputs = isRecord(prepare.outputs) ? prepare.outputs : undefined;
  const jobsWith = (result: string) => [...results].filter(([, value]) => value === result).map(([job]) => job);
  const failedJobs = jobsWith("failure");
  const cancelledJobs = jobsWith("cancelled");
  const applyFailed = isRecord(input.applyResult) && input.applyResult.status === "failed";
  const signingJob = input.needs.macos_signing;
  const macosSigning = isRecord(signingJob) && isRecord(signingJob.outputs) && signingJob.outputs.signing === "true";
  const passed = ([job, result]: [string, string]) =>
    result === "success" || (result === "skipped" && job.startsWith("build_macos_") && !macosSigning);

  let status: Status;
  let stage: Stage | null = null;
  let reason: string | null = null;
  if (failedJobs.length > 0) {
    status = "failed";
    stage = earliestStage(failedJobs) ?? null;
  } else if (cancelledJobs.length > 0) {
    status = "cancelled";
    stage = earliestStage(cancelledJobs) ?? null;
  } else if (results.get("prepare") === "skipped") {
    status = "skipped";
    reason = "prepare did not run in this repository";
  } else if (outputs?.skip === "true") {
    status = "skipped";
    reason = stringField(outputs, "skip_reason");
  } else if ([...results].every(passed)) {
    status = "success";
  } else {
    status = "failed";
    stage = earliestStage([...results].filter((entry) => !passed(entry)).map(([job]) => job)) ?? null;
    reason = "a required job did not run";
  }
  if (stage === "prepare" && applyFailed) stage = "apply";

  return {
    status,
    stage,
    reason,
    failedJobs,
    cancelledJobs,
    version: stringField(outputs, "version"),
    tag: stringField(outputs, "tag"),
    upstreamSha: stringField(outputs, "upstream_sha"),
    stackSha: stringField(outputs, "stack_sha"),
    seriesDate: stringField(outputs, "series_date"),
    buildNumber: stringField(outputs, "build_number"),
    workflowDrift: outputs?.workflow_drift === "true",
    macosSigning,
    runUrl: input.runUrl,
    apply: stage === "apply" && isRecord(input.applyResult) ? input.applyResult : null,
  };
}

export type RunResult = ReturnType<typeof classifyRun>;

export function summaryMarkdown(result: RunResult): string {
  const lines = [`## Stack build: ${result.status}${result.stage ? ` at stage \`${result.stage}\`` : ""}`, ""];
  if (result.reason) lines.push(result.reason, "");
  if (result.version) lines.push(`- version: \`${result.version}\``);
  if (result.upstreamSha) lines.push(`- upstream: \`${result.upstreamSha}\``);
  if (result.stackSha) lines.push(`- stack: \`${result.stackSha}\``);
  if (result.status === "success") lines.push(`- macOS app: ${result.macosSigning ? "built and signed" : "not built (no signing secrets)"}`);
  if (result.workflowDrift) lines.push("- workflow drift: the installed workflow differs from `stack/workflow/stack-build.yml`");
  if (result.failedJobs.length > 0) lines.push(`- failed jobs: ${result.failedJobs.map((job) => `\`${job}\``).join(", ")}`);
  if (result.cancelledJobs.length > 0) lines.push(`- cancelled jobs: ${result.cancelledJobs.map((job) => `\`${job}\``).join(", ")}`);
  const apply = result.apply;
  if (apply) {
    lines.push(`- failed patch: \`${String(apply.failedPatch || "unknown")}\` (${String(apply.failedIndex)}/${String(apply.patches)})`);
    if (apply.failedSubject) lines.push(`- subject: ${String(apply.failedSubject)}`);
    const paths = Array.isArray(apply.conflictedPaths) ? apply.conflictedPaths : [];
    lines.push(`- conflicted paths: ${paths.length === 0 ? "none reported" : paths.map((path) => `\`${String(path)}\``).join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      needs: { type: "string" },
      "apply-result": { type: "string" },
      "run-url": { type: "string" },
      output: { type: "string" },
      summary: { type: "string" },
    },
  });
  if (!values.needs || !values["run-url"] || !values.output) {
    throw new Error("Usage: classify-run.ts --needs <file> [--apply-result <file>] --run-url <url> --output <file> [--summary <file>]");
  }
  const result = classifyRun({
    needs: JSON.parse(readFileSync(values.needs, "utf8")),
    applyResult: readOptionalJson(values["apply-result"]),
    runUrl: values["run-url"],
  });
  writeFileSync(values.output, `${JSON.stringify(result, null, 2)}\n`);
  if (values.summary) appendFileSync(values.summary, summaryMarkdown(result));
  console.log(JSON.stringify(result));
}
