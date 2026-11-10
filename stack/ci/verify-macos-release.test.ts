import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appProblems,
  asarFile,
  bundledApp,
  cdHash,
  designatedRequirement,
  expectedRequirement,
  manifestProblems,
  parseFlatYaml,
  parseUpdateManifest,
  readSigningConfig,
  releaseFileNames,
  releaseFileProblems,
  type AppFacts,
} from "./verify-macos-release.ts";

const config = readSigningConfig(readFileSync(join(import.meta.dir, "macos-signing.json"), "utf8"));
const version = "0.1.9-local.stack.20261111.1";
const { zip, dmg } = releaseFileNames(version);
const appUpdateYml = "owner: chomamateusz\nrepo: t3code\nprovider: github\nreleaseType: release\nupdaterCacheDirName: t3code-updater\n";
const facts: AppFacts = {
  requirement: 'identifier "com.t3tools.t3code" and certificate leaf = H"7ad2035d760ab51915234492b1938fd222840e5e"',
  bundleId: "com.t3tools.t3code",
  shortVersion: version,
  bundleVersion: version,
  appUpdateYml,
  packageJson: '{"name":"t3code","t3codeAllowedUpdateRepository":"chomamateusz/t3code"}',
  looseApp: false,
};

function asarArchive(header: unknown, data: string): Buffer {
  const json = Buffer.from(JSON.stringify(header));
  const padded = Math.ceil(json.length / 4) * 4;
  const head = Buffer.alloc(16 + padded);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded, 4);
  head.writeUInt32LE(4 + padded, 8);
  head.writeInt32LE(json.length, 12);
  json.copy(head, 16);
  return Buffer.concat([head, Buffer.from(data)]);
}
const electronAsarArchive = Buffer.from(
  "BAAAABACAAAMAgAABgIAAHsiZmlsZXMiOnsiZGlzdCI6eyJmaWxlcyI6eyJtYWluLmpzIjp7InNpemUiOjEsIm9mZnNldCI6IjAiLCJpbnRlZ3JpdHkiOnsiYWxnb3JpdGhtIjoiU0hBMjU2IiwiaGFzaCI6IjJkNzExNjQyYjcyNmIwNDQwMTYyN2NhOWZiYWMzMmY1Yzg1MzBmYjE5MDNjYzRkYjAyMjU4NzE3OTIxYTQ4ODEiLCJibG9ja1NpemUiOjQxOTQzMDQsImJsb2NrcyI6WyIyZDcxMTY0MmI3MjZiMDQ0MDE2MjdjYTlmYmFjMzJmNWM4NTMwZmIxOTAzY2M0ZGIwMjI1ODcxNzkyMWE0ODgxIl19fX19LCJwYWNrYWdlLmpzb24iOnsic2l6ZSI6NzEsIm9mZnNldCI6IjEiLCJpbnRlZ3JpdHkiOnsiYWxnb3JpdGhtIjoiU0hBMjU2IiwiaGFzaCI6ImE4MjcyMjljZjBiYTU2N2RmYTkxYmFiM2E3YTRkZDk1MDQ3ZmJlMzJlYjljNjhhOTkzYjY4NTNhZmJhODJkNDIiLCJibG9ja1NpemUiOjQxOTQzMDQsImJsb2NrcyI6WyJhODI3MjI5Y2YwYmE1NjdkZmE5MWJhYjNhN2E0ZGQ5NTA0N2ZiZTMyZWI5YzY4YTk5M2I2ODUzYWZiYTgyZDQyIl19fX19AAB4eyJuYW1lIjoidDNjb2RlIiwidDNjb2RlQWxsb3dlZFVwZGF0ZVJlcG9zaXRvcnkiOiJjaG9tYW1hdGV1c3ovdDNjb2RlIn0=",
  "base64",
);
const manifestText = `version: ${version}
files:
  - url: ${zip}
    sha512: ZIPSHA==
    size: 100
    blockMapSize: 7
  - url: ${dmg}
    sha512: DMG/SHA+==
    size: 200
path: ${zip}
sha512: ZIPSHA==
releaseDate: '2026-11-11T03:40:00.000Z'
`;
const fileFacts = new Map([
  [zip, { sha512: "ZIPSHA==", size: 100 }],
  [dmg, { sha512: "DMG/SHA+==", size: 200 }],
]);

describe("signing config", () => {
  it("holds the leaf hash of the installed apps' designated requirement", () => {
    expect(expectedRequirement(config)).toBe(facts.requirement!);
  });

  it("rejects an uppercase or short leaf hash", () => {
    expect(() => readSigningConfig(JSON.stringify({ ...config, leafSha1: config.leafSha1.toUpperCase() }))).toThrow("leafSha1");
    expect(() => readSigningConfig(JSON.stringify({ ...config, leafSha1: "7ad2" }))).toThrow("leafSha1");
  });
});

describe("codesign output", () => {
  it("reads the designated requirement and the CDHash", () => {
    const requirement = `Executable=/x/T3 Code (Beta).app/Contents/MacOS/T3 Code (Beta)\ndesignated => ${facts.requirement}\n`;
    expect(designatedRequirement(requirement)).toBe(facts.requirement);
    expect(cdHash("Identifier=com.t3tools.t3code\nCDHash=8934216cb1198733050dbe860a1f09582ed3ae7f\n")).toBe("8934216cb1198733050dbe860a1f09582ed3ae7f");
    expect(designatedRequirement("Executable=/x\n")).toBeUndefined();
  });
});

describe("appProblems", () => {
  it("accepts an app signed by the configured identity with the release version and the fork feed", () => {
    expect(appProblems("zip", facts, config, version)).toEqual([]);
  });

  it("names every mismatch", () => {
    const problems = appProblems(
      "dmg",
      {
        requirement: 'identifier "com.t3tools.t3code" and anchor apple generic',
        bundleId: "com.t3tools.t3code.beta",
        shortVersion: "0.1.8",
        bundleVersion: version,
        appUpdateYml: appUpdateYml.replace("chomamateusz", "pingdotgg").replace("releaseType: release", "releaseType: prerelease"),
        packageJson: '{"name":"t3code"}',
        looseApp: true,
      },
      config,
      version,
    );
    expect(problems).toHaveLength(7);
    expect(problems.join("\n")).toContain("Contents/Resources/app exists");
    expect(problems.join("\n")).toContain("t3codeAllowedUpdateRepository is missing, expected chomamateusz/t3code");
    expect(problems.join("\n")).toContain("designated requirement");
    expect(problems.join("\n")).toContain("owner is pingdotgg");
    expect(problems.join("\n")).toContain("releaseType is prerelease");
  });

  it("refuses a feed with a host override or a duplicate key", () => {
    expect(appProblems("zip", { ...facts, appUpdateYml: `${appUpdateYml}host: example.com\n` }, config, version)).toEqual([
      "zip: app-update.yml sets host",
    ]);
    expect(appProblems("zip", { ...facts, appUpdateYml: `${appUpdateYml}owner: someone\n` }, config, version)[0]).toContain(
      "duplicate key owner",
    );
  });
});

describe("asarFile", () => {
  it("reads a packed file from an archive @electron/asar wrote", () => {
    expect(asarFile(electronAsarArchive, "package.json").toString("utf8")).toBe(facts.packageJson);
    expect(asarFile(electronAsarArchive, "dist/main.js").toString("utf8")).toBe("x");
  });

  it("refuses a missing or truncated file", () => {
    expect(() => asarFile(electronAsarArchive, "app-update.yml")).toThrow("no packed app-update.yml");
    expect(() => asarFile(electronAsarArchive.subarray(0, -1), "package.json")).toThrow("outside the archive");
  });

  it("refuses an entry Electron would resolve as a link or a directory", () => {
    const file = { size: facts.packageJson.length, offset: "0" };
    expect(asarFile(asarArchive({ files: { "package.json": file } }, facts.packageJson), "package.json").toString("utf8")).toBe(facts.packageJson);
    for (const extra of [{ link: "other.json" }, { files: {} }]) {
      const archive = asarArchive({ files: { "package.json": { ...file, ...extra }, "other.json": file } }, facts.packageJson);
      expect(() => asarFile(archive, "package.json")).toThrow("no packed package.json");
    }
  });
});

describe("bundledApp", () => {
  const app = { name: "T3 Code (Beta).app", kind: "directory" } as const;
  const applications = { name: "Applications", kind: "symlink", target: "/Applications" } as const;

  it("names the one app of a zip and of a dmg with its Applications link and hidden entries", () => {
    expect(bundledApp("zip", [app])).toBe(app.name);
    expect(bundledApp("dmg", [{ name: ".DS_Store", kind: "other" }, { name: ".background", kind: "directory" }, applications, app])).toBe(app.name);
  });

  it.each<[string, "zip" | "dmg", Parameters<typeof bundledApp>[1]]>([
    ["an app that is a symlink", "dmg", [applications, { name: app.name, kind: "symlink", target: "/Users/runner/work/_temp/macos-verify/zip/T3 Code (Beta).app" }]],
    ["a second bundle under another extension case", "dmg", [applications, app, { name: "T3 Code.APP", kind: "directory" }]],
    ["an installer next to the app", "dmg", [applications, app, { name: "Install.pkg", kind: "other" }]],
    ["an Applications link that points elsewhere", "dmg", [app, { name: "Applications", kind: "symlink", target: "/tmp/x" }]],
    ["a hidden file in the zip", "zip", [{ name: ".DS_Store", kind: "other" }, app]],
    ["no app", "zip", []],
  ])("refuses %s", (_, container, entries) => {
    expect(() => bundledApp(container, entries)).toThrow("must hold exactly one .app directory");
  });
});

describe("parseFlatYaml", () => {
  it("reads quoted and bare scalars and skips comments", () => {
    expect(Object.fromEntries(parseFlatYaml("# feed\nowner: 'chomamateusz'\nrepo: \"t3code\"\n"))).toEqual({
      owner: "chomamateusz",
      repo: "t3code",
    });
  });
});

describe("update manifest", () => {
  it("parses electron-builder's latest-mac.yml and accepts matching files", () => {
    const manifest = parseUpdateManifest(manifestText);
    expect(manifest.files).toEqual([
      { url: zip, sha512: "ZIPSHA==", size: 100 },
      { url: dmg, sha512: "DMG/SHA+==", size: 200 },
    ]);
    expect(manifestProblems(manifest, fileFacts, version)).toEqual([]);
  });

  it("accepts the merged form without path and sha512", () => {
    const merged = manifestText.replace(/^path: .*\n^sha512: .*\n/m, "");
    expect(parseUpdateManifest(merged).path).toBeUndefined();
    expect(manifestProblems(parseUpdateManifest(merged), fileFacts, version)).toEqual([]);
  });

  it("finds a stale hash, a wrong size, a wrong version and a missing dmg", () => {
    const stale = parseUpdateManifest(manifestText.replace("DMG/SHA+==", "OLD==").replace("size: 100", "size: 101"));
    expect(manifestProblems(stale, fileFacts, version)).toEqual([
      `latest-mac.yml size of ${zip} is 101, the file has 100`,
      `latest-mac.yml sha512 of ${dmg} does not match the file`,
    ]);
    const older = parseUpdateManifest(manifestText.replace(`version: ${version}`, "version: '0.1.8'"));
    expect(manifestProblems(older, fileFacts, version)).toEqual([`latest-mac.yml version is 0.1.8, expected ${version}`]);
    const zipOnly = parseUpdateManifest(manifestText.replace(/^ {2}- url: .*dmg\n(?: {4}.*\n)+/m, ""));
    expect(manifestProblems(zipOnly, fileFacts, version)[0]).toContain("expected");
  });

  it("refuses lines it does not understand", () => {
    expect(() => parseUpdateManifest(`${manifestText}stray line\n`)).toThrow("unsupported line");
    expect(() => parseUpdateManifest(`${manifestText}version: 1.0.0\n`)).toThrow("duplicate key version");
  });
});

describe("releaseFileProblems", () => {
  it("requires the zip, its block map, the dmg and latest-mac.yml and allows the dmg block map", () => {
    expect(releaseFileProblems([zip, `${zip}.blockmap`, dmg, `${dmg}.blockmap`, "latest-mac.yml"], version)).toEqual([]);
    expect(releaseFileProblems([zip, dmg, "latest-mac.yml", "builder-debug.yml"], version)).toEqual([
      `${zip}.blockmap is missing`,
      "unexpected file builder-debug.yml",
    ]);
  });
});
