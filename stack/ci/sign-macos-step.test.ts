import { describe, expect, it } from "bun:test";
import { YAML } from "bun";
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const leaf = "7ad2035d760ab51915234492b1938fd222840e5e";
const exportPassword = "export-password";
const workflow = YAML.parse(readFileSync(join(import.meta.dir, "../workflow/stack-build.yml"), "utf8")) as {
  jobs: Record<string, { steps: { name: string; run?: string; env?: Record<string, string> }[] }>;
};
const signStep = workflow.jobs.build_macos_arm64_signed!.steps.find((step) => step.name === "Sign the app")!;

const fixtures = mkdtempSync(join(tmpdir(), "sign-macos-fixtures-"));
const fixture = (name: string) => join(fixtures, name);

function openssl(...args: string[]) {
  const result = spawnSync("/usr/bin/openssl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`openssl ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

function exportedSecret(name: string, ...args: string[]) {
  openssl("pkcs12", "-export", ...args, "-passout", `pass:${exportPassword}`, "-out", fixture(name));
  return readFileSync(fixture(name)).toString("base64");
}

openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", fixture("key.pem"), "-out", fixture("cert.pem"), "-subj", "/CN=Test Signing", "-days", "2");
openssl("genrsa", "-out", fixture("other-key.pem"), "2048");
const keyOnly = exportedSecret("key-only.p12", "-nocerts", "-inkey", fixture("key.pem"));
const keyWithCertificate = exportedSecret("full.p12", "-inkey", fixture("key.pem"), "-in", fixture("cert.pem"));
const otherKey = exportedSecret("other-key.p12", "-nocerts", "-inkey", fixture("other-key.pem"));
const pemBody = (pem: string) => /-----BEGIN CERTIFICATE-----([^-]+)-----END CERTIFICATE-----/.exec(pem)![1]!.replace(/\s/g, "");

function stub(dir: string, name: string, body: string) {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

function signWith(identityLine: string, options: { secret?: string; password?: string; noKey?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sign-macos-step-"));
  const bin = join(root, "bin");
  const temp = join(root, "runner-temp");
  const app = join(root, "T3 Code (Beta).app");
  mkdirSync(bin);
  mkdirSync(temp);
  mkdirSync(app);
  const log = join(root, "calls.log");
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
  const secret = options.secret ?? keyOnly;
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", signStep.run!], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: temp,
      SIGNING_CONFIG: join(import.meta.dir, "macos-signing.json"),
      SIGNING_CERT: fixture("cert.pem"),
      APP: app,
      STUB_LOG: log,
      STUB_IMPORTED: join(root, "imported.p12"),
      IDENTITY_LINE: identityLine,
      NO_KEY: options.noKey ? "1" : "",
      STACK_MACOS_CERT_P12_BASE64: `${secret.slice(0, 8)}\n${secret.slice(8)}`,
      STACK_MACOS_CERT_PASSWORD: options.password ?? exportPassword,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return {
    result,
    calls,
    imported: join(root, "imported.p12"),
    keychainPassword: calls.find((call) => call.startsWith("security create-keychain -p "))?.split(" ")[3],
    work: join(temp, "stack-signing"),
    app,
  };
}

describe("the workflow's signing step", () => {
  it("pairs the secret's key with the pinned certificate, signs by certificate hash and removes the keychain", () => {
    for (const secret of [keyOnly, keyWithCertificate]) {
      const run = signWith(`  1) ${leaf.toUpperCase()} "T3 Code Local Signing" (CSSMERR_TP_NOT_TRUSTED)`, { secret });
      expect(run.result.status).toBe(0);
      const identity = openssl("pkcs12", "-in", run.imported, "-passin", `pass:${run.keychainPassword}`, "-nodes");
      expect(pemBody(identity)).toBe(pemBody(readFileSync(fixture("cert.pem"), "utf8")));
      expect(identity).toContain("PRIVATE KEY-----");
      const keychain = join(run.work, "signing.keychain-db");
      expect(run.calls).toContain(`codesign --force --deep --timestamp=none --keychain ${keychain} --sign ${leaf} ${run.app}`);
      expect(run.calls.find((call) => call.startsWith("security list-keychains -d user -s"))).toBe(
        `security list-keychains -d user -s ${keychain} /Users/runner/Library/Keychains/login.keychain-db`,
      );
      expect(run.calls.at(-1)).toBe(`security delete-keychain ${keychain}`);
      expect(run.calls.join("\n")).not.toContain(secret.slice(8, 72));
      expect(run.calls.join("\n")).not.toContain(exportPassword);
      expect(existsSync(run.work)).toBe(false);
    }
  });

  it("pairs with the certificate whose SHA-1 the signing config pins", () => {
    const pinned = new X509Certificate(readFileSync(join(import.meta.dir, "macos-signing-cert.pem")));
    expect(pinned.fingerprint.replaceAll(":", "").toLowerCase()).toBe(leaf);
    expect(JSON.parse(readFileSync(join(import.meta.dir, "macos-signing.json"), "utf8")).leafSha1).toBe(leaf);
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
    const run = signWith("", { secret: Buffer.from(exportPassword).toString("base64") });
    expect(run.result.status).toBe(1);
    expect(run.result.stderr).toContain("decodes to less than 1 kB");
    expect(run.calls.some((call) => /^security (create-keychain|import)|^codesign/.test(call))).toBe(false);
    expect(existsSync(run.work)).toBe(false);
  });

  it("refuses a wrong password and a key of another certificate before they reach the keychain", () => {
    for (const options of [{ password: "another-password" }, { secret: otherKey }]) {
      const run = signWith(leaf.toUpperCase(), options);
      expect(run.result.status).toBe(1);
      expect(run.result.stderr).toContain("is not a .p12 that STACK_MACOS_CERT_PASSWORD opens, or its private key does not belong");
      expect(run.calls.some((call) => /^security (create-keychain|import)|^codesign/.test(call))).toBe(false);
      expect(existsSync(run.work)).toBe(false);
    }
  });

  it("names the certificates of an identity that put no private key into the keychain and signs nothing", () => {
    const run = signWith(leaf.toUpperCase(), { noKey: true });
    expect(run.result.status).toBe(1);
    expect(run.result.stderr).toContain("put no private key into the keychain");
    expect(run.result.stderr).toContain(`SHA-1 hash: ${leaf.toUpperCase()}`);
    expect(run.calls.some((call) => call.startsWith("codesign"))).toBe(false);
    expect(run.calls.at(-1)).toStartWith("security delete-keychain");
    expect(existsSync(run.work)).toBe(false);
  });
});
