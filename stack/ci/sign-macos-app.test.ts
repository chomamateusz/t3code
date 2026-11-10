import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const leaf = "7ad2035d760ab51915234492b1938fd222840e5e";
const script = join(import.meta.dir, "sign-macos-app.sh");
const p12 = Buffer.from("fake pkcs12 bytes").toString("base64");

function stub(dir: string, name: string, body: string) {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

function signWith(identityLine: string) {
  const root = mkdtempSync(join(tmpdir(), "sign-macos-app-"));
  const bin = join(root, "bin");
  const app = join(root, "T3 Code (Beta).app");
  mkdirSync(bin);
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
esac`,
  );
  stub(bin, "codesign", "");
  const work = join(root, "signing");
  const result = spawnSync("bash", [script, app, leaf, work], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_IMPORTED: join(root, "imported.p12"),
      IDENTITY_LINE: identityLine,
      STACK_MACOS_CERT_P12_BASE64: `${p12.slice(0, 8)}\n${p12.slice(8)}`,
      STACK_MACOS_CERT_PASSWORD: "export-password",
    },
  });
  return {
    result,
    calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
    imported: existsSync(join(root, "imported.p12")) ? readFileSync(join(root, "imported.p12"), "utf8") : undefined,
    workLeft: existsSync(work),
    keychain: join(work, "signing.keychain-db"),
    app,
  };
}

describe("sign-macos-app.sh", () => {
  it("imports the identity into its own keychain, signs by certificate hash and removes the keychain", () => {
    const run = signWith(`  1) ${leaf.toUpperCase()} "T3 Code Local Signing" (CSSMERR_TP_NOT_TRUSTED)`);
    expect(run.result.status).toBe(0);
    expect(run.imported).toBe("fake pkcs12 bytes");
    expect(run.calls).toContain(`codesign --force --deep --timestamp=none --keychain ${run.keychain} --sign ${leaf} ${run.app}`);
    expect(run.calls.find((call) => call.startsWith("security list-keychains -d user -s"))).toEndWith(
      "signing.keychain-db /Users/runner/Library/Keychains/login.keychain-db",
    );
    expect(run.calls.at(-1)).toStartWith("security delete-keychain");
    expect(run.calls.join("\n")).not.toContain(p12.slice(8));
    expect(run.workLeft).toBe(false);
  });

  it("refuses an identity with another certificate and signs nothing", () => {
    const run = signWith(`  1) ${"0".repeat(40)} "T3 Code Local Signing"`);
    expect(run.result.status).toBe(1);
    expect(run.result.stderr).toContain(`no code signing identity with certificate SHA-1 ${leaf}`);
    expect(run.calls.some((call) => call.startsWith("codesign"))).toBe(false);
    expect(run.calls.at(-1)).toStartWith("security delete-keychain");
    expect(run.workLeft).toBe(false);
  });
});
