import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { exclusionPattern, parseExclusions, type TestExclusion } from "./test-exclusions.ts";

function exclusion(packageName: string, name: string): TestExclusion {
  return {
    package: packageName,
    name,
    file: "apps/server/src/example.test.ts",
    reason: "runner only",
    evidence: "https://github.com/chomamateusz/t3code/actions/runs/1",
    removeWhen: "upstream fixes it",
  };
}

describe("exclusionPattern", () => {
  it("excludes exactly the listed name even when it contains regex characters", () => {
    const name = "suite > handles (a|b) [x]+? at $HOME^{1}.\\path";
    const pattern = new RegExp(exclusionPattern([exclusion("t3", name)], "t3"));
    expect(pattern.test(name)).toBe(false);
    expect(pattern.test("suite > handles a at $HOME")).toBe(true);
    expect(pattern.test(`${name} again`)).toBe(true);
    expect(pattern.test(`outer > ${name}`)).toBe(true);
  });

  it("excludes several names of the package and nothing from other packages", () => {
    const exclusions = [exclusion("t3", "a > first"), exclusion("@t3tools/web", "b > web"), exclusion("t3", "c > second")];
    const pattern = new RegExp(exclusionPattern(exclusions, "t3"));
    expect(pattern.test("a > first")).toBe(false);
    expect(pattern.test("c > second")).toBe(false);
    expect(pattern.test("b > web")).toBe(true);
    expect(pattern.test("a > first second")).toBe(true);
  });

  it("is empty for a package without entries", () => {
    expect(exclusionPattern([exclusion("t3", "a > first")], "@t3tools/web")).toBe("");
    expect(exclusionPattern([], "t3")).toBe("");
  });
});

describe("parseExclusions", () => {
  it("accepts the committed list", () => {
    expect(parseExclusions(readFileSync(new URL("./test-exclusions.json", import.meta.url), "utf8")).length).toBeGreaterThan(0);
  });

  it("rejects malformed files", () => {
    const { removeWhen: _removeWhen, ...withoutRemoval } = exclusion("t3", "a");
    expect(() => parseExclusions("{")).toThrow();
    expect(() => parseExclusions('{"package": "t3"}')).toThrow("JSON array");
    expect(() => parseExclusions("[null]")).toThrow("must be an object");
    expect(() => parseExclusions(JSON.stringify([withoutRemoval]))).toThrow('"removeWhen"');
    expect(() => parseExclusions(JSON.stringify([{ ...exclusion("t3", "a"), name: " " }]))).toThrow('"name"');
    expect(() => parseExclusions(JSON.stringify([{ ...exclusion("t3", "a"), extra: "x" }]))).toThrow("unknown fields: extra");
  });
});
