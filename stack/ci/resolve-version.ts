import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isRecord, parseJsonRecords, writeGithubOutput } from "./lib.ts";

type Triple = readonly [number, number, number];

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SERIES_DATE = /^\d{8}$/;
const BUILD_NUMBER = /^(0|[1-9]\d*)$/;

function compareTriples(left: Triple, right: Triple): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function latestStableRelease(releases: readonly unknown[]): Triple {
  let newest: Triple | undefined;
  for (const release of releases) {
    if (!isRecord(release) || release.draft !== false || release.prerelease !== false) continue;
    const match = typeof release.tag_name === "string" ? STABLE_TAG.exec(release.tag_name) : null;
    if (!match) continue;
    const candidate: Triple = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!newest || compareTriples(candidate, newest) > 0) newest = candidate;
  }
  if (!newest) throw new Error("No published stable vX.Y.Z release among the upstream releases");
  return newest;
}

export function tagNameFromRef(line: string): string {
  const ref = line.trim().split(/\s+/).at(-1) ?? "";
  return ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
}

export function resolveVersion(input: {
  upstreamReleases: readonly unknown[];
  forkTags: readonly string[];
  seriesDate: string;
}) {
  if (!SERIES_DATE.test(input.seriesDate)) {
    throw new Error(`Series date must be YYYYMMDD, got ${JSON.stringify(input.seriesDate)}`);
  }
  const [major, minor, patch] = latestStableRelease(input.upstreamReleases);
  const upstreamStable = `${major}.${minor}.${patch}`;
  const prefix = `${major}.${minor}.${patch + 1}-local.stack.${input.seriesDate}.`;
  const highest = input.forkTags
    .map(tagNameFromRef)
    .filter((tag) => tag.startsWith(`v${prefix}`))
    .map((tag) => tag.slice(prefix.length + 1))
    .filter((suffix) => BUILD_NUMBER.test(suffix))
    .reduce((max, suffix) => Math.max(max, Number(suffix)), 0);
  const buildNumber = highest + 1;
  const version = `${prefix}${buildNumber}`;
  return { version, tag: `v${version}`, upstreamStable, seriesDate: input.seriesDate, buildNumber };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "upstream-releases": { type: "string" },
      "fork-tags": { type: "string" },
      "series-date": { type: "string" },
      "github-output": { type: "boolean", default: false },
    },
  });
  const upstreamReleasesPath = values["upstream-releases"];
  const forkTagsPath = values["fork-tags"];
  const seriesDate = values["series-date"];
  if (!upstreamReleasesPath || !forkTagsPath || !seriesDate) {
    throw new Error("Usage: resolve-version.ts --upstream-releases <file> --fork-tags <file> --series-date <YYYYMMDD> [--github-output]");
  }
  const resolved = resolveVersion({
    upstreamReleases: parseJsonRecords(readFileSync(upstreamReleasesPath, "utf8")),
    forkTags: readFileSync(forkTagsPath, "utf8").split("\n").filter((line) => line.trim() !== ""),
    seriesDate: seriesDate.trim(),
  });
  if (values["github-output"]) {
    writeGithubOutput({
      version: resolved.version,
      tag: resolved.tag,
      upstream_stable: resolved.upstreamStable,
      series_date: resolved.seriesDate,
      build_number: resolved.buildNumber,
    });
  }
  console.log(JSON.stringify(resolved));
}
