import { describe, expect, it } from "bun:test";
import { YAML } from "bun";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const leaf = "7ad2035d760ab51915234492b1938fd222840e5e";
const p12Bytes = "fake pkcs12 bytes ".repeat(80);
const p12 = Buffer.from(p12Bytes).toString("base64");
const workflow = YAML.parse(readFileSync(join(import.meta.dir, "../workflow/stack-build.yml"), "utf8")) as {
  jobs: Record<string, { steps: { name: string; run?: string; env?: Record<string, string> }[] }>;
};
const signStep = workflow.jobs.build_macos_arm64_signed!.steps.find((step) => step.name === "Sign the app")!;

function stub(dir: string, name: string, body: string) {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

function signWith(identityLine: string, options: { secret?: string; noKey?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sign-macos-step-"));
  const bin = join(root, "bin");
  const temp = join(root, "runner-temp");
  const app = join(root, "T3 Code (Beta).app");
  mkdirSync(bin);
  mkdirSync(temp);
  mkdirSync(app);
  const log = join(root, "calls.log");
  stub(bin, "openssl", "echo 0123456789abcdef");
  stub(
    bin,
    "security",
    `case "$1" in
  list-keychains) if [[ "$*" != *" -s "* ]]; then printf '    "/Users/runner/Library/Keychains/login.keychain-db"\\n'; fi ;;
  find-identity) printf '\\nPolicy: Code Signing\\n  Matching identities\\n%s\\n     1 identities found\\n' "$IDENTITY_LINE" ;;
  import) cp "$2" "$STUB_IMPORTED" ;;
  set-key-partition-list) [[ -z "$NO_KEY" ]] || exit 1 ;;
  find-certificate) printf 'SHA-1 hash: %s\\n    "labl"<blob>="T3 Code Local Signing"\\n' "$IDENTITY_LINE" ;;
esac`,
  );
  stub(bin, "codesign", "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", signStep.run!], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: temp,
      SIGNING_CONFIG: join(import.meta.dir, "macos-signing.json"),
      APP: app,
      STUB_LOG: log,
      STUB_IMPORTED: join(root, "imported.p12"),
      IDENTITY_LINE: identityLine,
      NO_KEY: options.noKey ? "1" : "",
      STACK_MACOS_CERT_P12_BASE64: options.secret ?? `${p12.slice(0, 8)}\n${p12.slice(8)}`,
      STACK_MACOS_CERT_PASSWORD: "export-password",
    },
  });
  return {
    result,
    calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
    imported: existsSync(join(root, "imported.p12")) ? readFileSync(join(root, "imported.p12"), "utf8") : undefined,
    work: join(temp, "stack-signing"),
    app,
  };
}

describe("the workflow's signing step", () => {
  it("imports the identity into its own keychain, signs by certificate hash and removes the keychain", () => {
    const run = signWith(`  1) ${leaf.toUpperCase()} "T3 Code Local Signing" (CSSMERR_TP_NOT_TRUSTED)`);
    expect(run.result.status).toBe(0);
    expect(run.imported).toBe(p12Bytes);
    const keychain = join(run.work, "signing.keychain-db");
    expect(run.calls).toContain(`codesign --force --deep --timestamp=none --keychain ${keychain} --sign ${leaf} ${run.app}`);
    expect(run.calls.find((call) => call.startsWith("security list-keychains -d user -s"))).toBe(
      `security list-keychains -d user -s ${keychain} /Users/runner/Library/Keychains/login.keychain-db`,
    );
    expect(run.calls.at(-1)).toBe(`security delete-keychain ${keychain}`);
    expect(run.calls.join("\n")).not.toContain(p12.slice(8));
    expect(existsSync(run.work)).toBe(false);
  });

  it("refuses an identity with another certificate and signs nothing", () => {
    const run = signWith(`  1) ${"0".repeat(40)} "T3 Code Local Signing"`);
    expect(run.result.status).toBe(1);
    expect(run.result.stderr).toContain(`no code signing identity with certificate SHA-1 ${leaf}`);
    expect(run.calls.some((call) => call.startsWith("codesign"))).toBe(false);
    expect(run.calls.at(-1)).toStartWith("security delete-keychain");
    expect(existsSync(run.work)).toBe(false);
  });

  it("refuses a secret too small to be the .p12 before it reaches the keychain", () => {
    const run = signWith("", { secret: Buffer.from("export-password").toString("base64") });
    expect(run.result.status).toBe(1);
    expect(run.result.stderr).toContain("decodes to less than 1 kB");
    expect(run.calls.some((call) => /^security (create-keychain|import)|^codesign/.test(call))).toBe(false);
    expect(existsSync(run.work)).toBe(false);
  });

  it("names the certificates of a .p12 that carries no private key and signs nothing", () => {
    const run = signWith(leaf.toUpperCase(), { noKey: true });
    expect(run.result.status).toBe(1);
    expect(run.result.stderr).toContain("put no private key into the keychain");
    expect(run.result.stderr).toContain(`SHA-1 hash: ${leaf.toUpperCase()}`);
    expect(run.result.stderr).toContain(`What the decoded secret is, ${p12Bytes.length} bytes:`);
    expect(run.result.stderr).toContain("plain text, not a binary .p12");
    expect(run.result.stderr).toContain("not a PKCS#12 file that openssl can read");
    expect(run.result.stderr).not.toContain("export-password");
    expect(run.calls.some((call) => call.startsWith("codesign"))).toBe(false);
    expect(run.calls.at(-1)).toStartWith("security delete-keychain");
    expect(existsSync(run.work)).toBe(false);
  });
});
