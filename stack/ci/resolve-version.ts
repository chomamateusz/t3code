import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isRecord, parseJsonRecords, writeGithubOutput } from "./lib.ts";

type Triple = readonly [number, number, number];

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SERIES_DATE = /^\d{8}$/;
const BUILD_NUMBER = /^(0|[1-9]\d*)$/;
const INSTALLABLE_STACK_TAG = /^v((?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})-local\.stack\.\d{8}\.[1-9]\d{0,5})$/;

function compareTriples(left: Triple, right: Triple): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function compareVersions(left: string, right: string): number {
  const split = (version: string) => {
    const dash = version.indexOf("-");
    const core = (dash === -1 ? version : version.slice(0, dash)).split(".").map(BigInt);
    return { core, pre: dash === -1 ? [] : version.slice(dash + 1).split(".") };
  };
  const a = split(left);
  const b = split(right);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]! ? -1 : 1;
  }
  if (a.pre.length === 0 || b.pre.length === 0) return Math.sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
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

export function highestStackVersion(tags: readonly string[]): string | undefined {
  let highest: string | undefined;
  for (const tag of tags) {
    const version = INSTALLABLE_STACK_TAG.exec(tag)?.[1];
    if (version && (!highest || compareVersions(version, highest) > 0)) highest = version;
  }
  return highest;
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
  const tags = input.forkTags.map(tagNameFromRef);
  const highestBuild = tags
    .filter((tag) => tag.startsWith(`v${prefix}`))
    .map((tag) => tag.slice(prefix.length + 1))
    .filter((suffix) => BUILD_NUMBER.test(suffix))
    .reduce((max, suffix) => Math.max(max, Number(suffix)), 0);
  const buildNumber = highestBuild + 1;
  const version = `${prefix}${buildNumber}`;
  const highestExisting = highestStackVersion(tags) ?? null;
  return { version, tag: `v${version}`, upstreamStable, seriesDate: input.seriesDate, buildNumber, highestExisting };
}

export function requireNewer(resolved: ReturnType<typeof resolveVersion>): void {
  const { version, highestExisting } = resolved;
  if (highestExisting && compareVersions(version, highestExisting) <= 0) {
    throw new Error(
      `Version ${version} would not be newer than the existing tag v${highestExisting}, so installers would refuse it. ` +
        `Upstream stable is ${resolved.upstreamStable} and stack/series-date is ${resolved.seriesDate}.`,
    );
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "upstream-releases": { type: "string" },
      "fork-tags": { type: "string" },
      "series-date": { type: "string" },
      "github-output": { type: "boolean", default: false },
      "require-newer": { type: "boolean", default: false },
    },
  });
  const upstreamReleasesPath = values["upstream-releases"];
  const forkTagsPath = values["fork-tags"];
  const seriesDate = values["series-date"];
  if (!upstreamReleasesPath || !forkTagsPath || !seriesDate) {
    throw new Error("Usage: resolve-version.ts --upstream-releases <file> --fork-tags <file> --series-date <YYYYMMDD> [--github-output] [--require-newer]");
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
  if (values["require-newer"]) requireNewer(resolved);
}
