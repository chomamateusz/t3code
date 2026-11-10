import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isRecord, parseJsonRecords, readOptionalJson, writeGithubOutput } from "./lib.ts";

const STACK_TAG = /^v\d+\.\d+\.\d+-local\.stack\.\d{8}\.\d+$/;

export function newestStackRelease(releases: readonly unknown[]): string | undefined {
  let newest: { tag: string; time: number } | undefined;
  for (const release of releases) {
    if (!isRecord(release) || release.isDraft !== false || typeof release.tagName !== "string") continue;
    if (!STACK_TAG.test(release.tagName)) continue;
    const stamp = release.publishedAt || release.createdAt;
    const time = typeof stamp === "string" ? Date.parse(stamp) : Number.NaN;
    if (Number.isNaN(time)) continue;
    if (!newest || time > newest.time) newest = { tag: release.tagName, time };
  }
  return newest?.tag;
}

export function decideSkip(input: {
  manifest: unknown;
  upstreamSha: string;
  stackSha: string;
  force: boolean;
}): { skip: boolean; reason: string } {
  if (input.force) return { skip: false, reason: "forced by workflow_dispatch input" };
  const { manifest } = input;
  if (!isRecord(manifest) || typeof manifest.upstreamSha !== "string" || typeof manifest.stackSha !== "string") {
    return { skip: false, reason: "no earlier stack release with a readable build manifest" };
  }
  const label = typeof manifest.version === "string" ? manifest.version : "the newest stack release";
  if (manifest.upstreamSha === input.upstreamSha && manifest.stackSha === input.stackSha) {
    return { skip: true, reason: `${label} was already built from upstream ${input.upstreamSha} and stack ${input.stackSha}` };
  }
  return { skip: false, reason: `upstream or stack changed since ${label}` };
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      releases: { type: "string" },
      manifest: { type: "string" },
      "upstream-sha": { type: "string" },
      "stack-sha": { type: "string" },
      force: { type: "string", default: "false" },
      "github-output": { type: "boolean", default: false },
    },
  });
  const [command] = positionals;
  if (command === "newest" && values.releases) {
    console.log(newestStackRelease(parseJsonRecords(readFileSync(values.releases, "utf8"))) ?? "");
  } else if (command === "decide" && values["upstream-sha"] && values["stack-sha"]) {
    const decision = decideSkip({
      manifest: readOptionalJson(values.manifest),
      upstreamSha: values["upstream-sha"],
      stackSha: values["stack-sha"],
      force: values.force === "true",
    });
    if (values["github-output"]) writeGithubOutput({ skip: decision.skip, skip_reason: decision.reason });
    console.log(JSON.stringify(decision));
  } else {
    throw new Error(
      "Usage: should-skip.ts newest --releases <file> | should-skip.ts decide [--manifest <file>] --upstream-sha <sha> --stack-sha <sha> [--force true|false] [--github-output]",
    );
  }
}
