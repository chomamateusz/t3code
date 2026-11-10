import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isRecord } from "./lib.ts";

export interface SigningConfig {
  readonly bundleId: string;
  readonly leafSha1: string;
  readonly updateRepository: string;
}

export interface UpdateFile {
  readonly url: string;
  readonly sha512: string;
  readonly size: number;
}

export interface UpdateManifest {
  readonly version: string;
  readonly files: readonly UpdateFile[];
  readonly path?: string;
  readonly sha512?: string;
}

export interface AppFacts {
  readonly requirement: string | undefined;
  readonly bundleId: string;
  readonly shortVersion: string;
  readonly bundleVersion: string;
  readonly appUpdateYml: string;
  readonly packageJson: string;
}

export interface FileFacts {
  readonly sha512: string;
  readonly size: number;
}

const VERSION = /^\d+\.\d+\.\d+-local\.stack\.\d{8}\.[1-9]\d*$/;
const SCALAR = /^(?:'([^']*)'|"([^"]*)"|([^'"#\s][^#]*?))\s*$/;

export function readSigningConfig(text: string): SigningConfig {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("signing config must be a JSON object");
  const { bundleId, leafSha1, updateRepository } = value;
  if (typeof bundleId !== "string" || !/^[A-Za-z0-9.-]+$/.test(bundleId)) throw new Error("bundleId is missing or invalid");
  if (typeof leafSha1 !== "string" || !/^[0-9a-f]{40}$/.test(leafSha1)) throw new Error("leafSha1 must be 40 lowercase hex digits");
  if (typeof updateRepository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(updateRepository)) {
    throw new Error("updateRepository must be owner/repo");
  }
  return { bundleId, leafSha1, updateRepository };
}

export function expectedRequirement(config: SigningConfig): string {
  return `identifier "${config.bundleId}" and certificate leaf = H"${config.leafSha1}"`;
}

export function designatedRequirement(codesignOutput: string): string | undefined {
  return /^designated => (.+)$/m.exec(codesignOutput)?.[1]?.trim();
}

export function cdHash(codesignOutput: string): string | undefined {
  return /^CDHash=([0-9a-f]{40})$/m.exec(codesignOutput)?.[1];
}

function scalar(raw: string): string {
  const match = SCALAR.exec(raw.trim());
  if (!match) throw new Error(`unsupported YAML value: ${raw}`);
  return match[1] ?? match[2] ?? match[3] ?? "";
}

export function parseFlatYaml(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`unsupported line: ${line}`);
    const [, key, raw] = match;
    if (entries.has(key!)) throw new Error(`duplicate key ${key}`);
    entries.set(key!, scalar(raw!));
  }
  return entries;
}

export function parseUpdateManifest(text: string): UpdateManifest {
  const top = new Map<string, string>();
  const items: Map<string, string>[] = [];
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const item = /^ {2}- (\w+):\s*(.*)$/.exec(line);
    const field = /^ {4}(\w+):\s*(.*)$/.exec(line);
    const key = /^(\w+):\s*(.*)$/.exec(line);
    if (inFiles && item) {
      items.push(new Map([[item[1]!, scalar(item[2]!)]]));
    } else if (inFiles && field && items.length > 0) {
      const current = items[items.length - 1]!;
      if (current.has(field[1]!)) throw new Error(`duplicate files key ${field[1]}`);
      current.set(field[1]!, scalar(field[2]!));
    } else if (key) {
      if (top.has(key[1]!)) throw new Error(`duplicate key ${key[1]}`);
      inFiles = key[1] === "files" && key[2]!.trim() === "";
      top.set(key[1]!, inFiles ? "" : scalar(key[2]!));
    } else {
      throw new Error(`unsupported line: ${line}`);
    }
  }
  const files = items.map((entry) => {
    const url = entry.get("url");
    const sha512 = entry.get("sha512");
    const size = Number(entry.get("size"));
    if (!url || !sha512 || !Number.isSafeInteger(size) || size <= 0) throw new Error("every files entry needs url, sha512 and size");
    return { url, sha512, size };
  });
  const version = top.get("version");
  if (!version) throw new Error("version is missing");
  return { version, files, path: top.get("path"), sha512: top.get("sha512") };
}

export function releaseFileNames(version: string) {
  const base = `T3-Code-${version}-arm64`;
  return {
    zip: `${base}.zip`,
    dmg: `${base}.dmg`,
    required: [`${base}.zip`, `${base}.zip.blockmap`, `${base}.dmg`, "latest-mac.yml"],
    optional: [`${base}.dmg.blockmap`],
  };
}

export function releaseFileProblems(names: readonly string[], version: string): string[] {
  const { required, optional } = releaseFileNames(version);
  const problems = required.filter((name) => !names.includes(name)).map((name) => `${name} is missing`);
  for (const name of names) {
    if (!required.includes(name) && !optional.includes(name)) problems.push(`unexpected file ${name}`);
  }
  return problems;
}

export function manifestProblems(manifest: UpdateManifest, files: ReadonlyMap<string, FileFacts>, version: string): string[] {
  const { zip, dmg } = releaseFileNames(version);
  const problems: string[] = [];
  if (manifest.version !== version) problems.push(`latest-mac.yml version is ${manifest.version}, expected ${version}`);
  const urls = manifest.files.map((file) => file.url).sort();
  if (urls.join("\n") !== [dmg, zip].sort().join("\n")) problems.push(`latest-mac.yml lists [${urls.join(", ")}], expected [${zip}, ${dmg}]`);
  for (const entry of manifest.files) {
    const actual = files.get(entry.url);
    if (!actual) continue;
    if (entry.sha512 !== actual.sha512) problems.push(`latest-mac.yml sha512 of ${entry.url} does not match the file`);
    if (entry.size !== actual.size) problems.push(`latest-mac.yml size of ${entry.url} is ${entry.size}, the file has ${actual.size}`);
  }
  if (manifest.path !== undefined && manifest.path !== zip) problems.push(`latest-mac.yml path is ${manifest.path}, expected ${zip}`);
  if (manifest.sha512 !== undefined && manifest.sha512 !== files.get(zip)?.sha512) problems.push("latest-mac.yml sha512 does not match the zip");
  return problems;
}

export function asarFile(archive: Buffer, name: string): Buffer {
  const headerSize = archive.readUInt32LE(4);
  let entry: unknown = JSON.parse(archive.toString("utf8", 16, 16 + archive.readInt32LE(12)));
  for (const part of name.split("/")) entry = isRecord(entry) && isRecord(entry.files) ? entry.files[part] : undefined;
  if (!isRecord(entry) || typeof entry.offset !== "string" || typeof entry.size !== "number" || entry.unpacked) {
    throw new Error(`app.asar has no packed ${name}`);
  }
  const start = 8 + headerSize + Number(entry.offset);
  if (!Number.isSafeInteger(start) || start + entry.size > archive.length) throw new Error(`app.asar ${name} lies outside the archive`);
  return archive.subarray(start, start + entry.size);
}

export function appProblems(label: string, facts: AppFacts, config: SigningConfig, version: string): string[] {
  const problems: string[] = [];
  const expected = expectedRequirement(config);
  if (facts.requirement !== expected) problems.push(`${label}: designated requirement is ${facts.requirement ?? "missing"}, expected ${expected}`);
  if (facts.bundleId !== config.bundleId) problems.push(`${label}: CFBundleIdentifier is ${facts.bundleId}, expected ${config.bundleId}`);
  if (facts.shortVersion !== version) problems.push(`${label}: CFBundleShortVersionString is ${facts.shortVersion}, expected ${version}`);
  if (facts.bundleVersion !== version) problems.push(`${label}: CFBundleVersion is ${facts.bundleVersion}, expected ${version}`);
  let feed: Map<string, string>;
  try {
    feed = parseFlatYaml(facts.appUpdateYml);
  } catch (error) {
    return [...problems, `${label}: app-update.yml: ${error instanceof Error ? error.message : String(error)}`];
  }
  const [owner, repo] = config.updateRepository.split("/");
  const expectedFeed: Record<string, string> = { provider: "github", owner: owner!, repo: repo!, releaseType: "release" };
  for (const [key, value] of Object.entries(expectedFeed)) {
    if (feed.get(key) !== value) problems.push(`${label}: app-update.yml ${key} is ${feed.get(key) ?? "missing"}, expected ${value}`);
  }
  for (const key of ["host", "protocol", "channel"]) {
    if (feed.has(key)) problems.push(`${label}: app-update.yml sets ${key}`);
  }
  let allowed: unknown;
  try {
    const metadata: unknown = JSON.parse(facts.packageJson);
    allowed = isRecord(metadata) ? metadata.t3codeAllowedUpdateRepository : undefined;
  } catch (error) {
    return [...problems, `${label}: app.asar package.json: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (allowed !== config.updateRepository) {
    problems.push(`${label}: app.asar package.json t3codeAllowedUpdateRepository is ${JSON.stringify(allowed) ?? "missing"}, expected ${config.updateRepository}`);
  }
  return problems;
}

function run(command: string, args: readonly string[], cwd?: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${String(result.status)}: ${output.trim()}`);
  return output;
}

function onlyApp(dir: string): string {
  const apps = readdirSync(dir).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`expected one .app in ${dir}, found [${apps.join(", ")}]`);
  return join(dir, apps[0]!);
}

function plistValue(app: string, key: string): string {
  return run("plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")]).trim();
}

function inspectApp(label: string, app: string, config: SigningConfig, version: string) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const facts: AppFacts = {
    requirement: designatedRequirement(run("codesign", ["-d", "-r-", app])),
    bundleId: plistValue(app, "CFBundleIdentifier"),
    shortVersion: plistValue(app, "CFBundleShortVersionString"),
    bundleVersion: plistValue(app, "CFBundleVersion"),
    appUpdateYml: readFileSync(join(app, "Contents/Resources/app-update.yml"), "utf8"),
    packageJson: asarFile(readFileSync(join(app, "Contents/Resources/app.asar")), "package.json").toString("utf8"),
  };
  const problems = appProblems(label, facts, config, version);
  const hash = cdHash(run("codesign", ["-d", "--verbose=4", app]));
  if (!hash) problems.push(`${label}: codesign reports no CDHash`);
  console.log(`${label}: ${facts.requirement}; version ${facts.shortVersion}; CDHash ${hash}`);
  return { problems, hash };
}

function verifyRelease(options: { dir: string; version: string; config: SigningConfig; work: string }) {
  const { dir, version, config, work } = options;
  if (!VERSION.test(version)) throw new Error(`invalid version ${version}`);
  const names = readdirSync(dir).sort();
  const problems = releaseFileProblems(names, version);
  if (problems.length > 0) return problems;
  const facts = new Map<string, FileFacts>();
  for (const name of names) {
    const path = join(dir, name);
    facts.set(name, { sha512: createHash("sha512").update(readFileSync(path)).digest("base64"), size: statSync(path).size });
  }
  problems.push(...manifestProblems(parseUpdateManifest(readFileSync(join(dir, "latest-mac.yml"), "utf8")), facts, version));

  const { zip, dmg } = releaseFileNames(version);
  const unzipped = join(work, "zip");
  const mount = join(work, "dmg");
  mkdirSync(unzipped, { recursive: true });
  mkdirSync(mount, { recursive: true });
  run("ditto", ["-x", "-k", join(dir, zip), unzipped]);
  const fromZip = inspectApp("zip", onlyApp(unzipped), config, version);
  run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, join(dir, dmg)]);
  try {
    const fromDmg = inspectApp("dmg", onlyApp(mount), config, version);
    problems.push(...fromZip.problems, ...fromDmg.problems);
    if (fromZip.hash !== fromDmg.hash) problems.push(`the zip app (CDHash ${fromZip.hash}) and the dmg app (CDHash ${fromDmg.hash}) differ`);
  } finally {
    run("hdiutil", ["detach", mount, "-force"]);
  }
  return problems;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      version: { type: "string" },
      config: { type: "string" },
      work: { type: "string" },
    },
  });
  if (!values.dir || !values.version || !values.config || !values.work) {
    throw new Error("Usage: verify-macos-release.ts --dir <release-files> --version <version> --config <macos-signing.json> --work <empty-dir>");
  }
  const problems = verifyRelease({
    dir: values.dir,
    version: values.version,
    config: readSigningConfig(readFileSync(values.config, "utf8")),
    work: values.work,
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error title=macOS release check::${problem}`);
    process.exit(1);
  }
  console.log(`macOS release ${values.version} verified`);
}
