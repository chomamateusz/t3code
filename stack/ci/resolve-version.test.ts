import { describe, expect, it } from "bun:test";
import { resolveVersion, tagNameFromRef } from "./resolve-version.ts";

const release = (tag_name: string, draft = false, prerelease = false) => ({ tag_name, draft, prerelease });

const upstreamReleases = [
  release("v0.1.9-nightly.20261109.12", false, true),
  release("v0.2.0", true),
  release("v0.1.8"),
  release("v0.1.10-preview.1", false, true),
  release("v0.1.7"),
  release("desktop-v9.9.9"),
];

describe("resolveVersion", () => {
  it("bumps the patch of the newest published stable release and starts at build 1", () => {
    expect(resolveVersion({ upstreamReleases, forkTags: [], seriesDate: "20261110" })).toEqual({
      version: "0.1.9-local.stack.20261110.1",
      tag: "v0.1.9-local.stack.20261110.1",
      upstreamStable: "0.1.8",
      seriesDate: "20261110",
      buildNumber: 1,
    });
  });

  it("compares versions numerically, not as strings", () => {
    const resolved = resolveVersion({
      upstreamReleases: [release("v0.1.9"), release("v0.1.10"), release("v0.0.99")],
      forkTags: [],
      seriesDate: "20261110",
    });
    expect(resolved.version).toBe("0.1.11-local.stack.20261110.1");
  });

  it("continues after the highest build number for the same prefix and series date", () => {
    const forkTags = [
      "aaaa\trefs/tags/v0.1.9-local.stack.20261110.2",
      "bbbb\trefs/tags/v0.1.9-local.stack.20261110.10",
      "cccc\trefs/tags/v0.1.9-local.stack.20261110.10^{}",
      "v0.1.9-local.stack.20261110.9",
      "v0.1.9-local.stack.20261109.40",
      "v0.1.8-local.stack.20261110.77",
      "v0.1.9-local.stack.20261110.3-rc",
      "v0.1.9-local.stack.20261110.07",
      "v0.1.9-fork.2026111001",
    ];
    const resolved = resolveVersion({ upstreamReleases, forkTags, seriesDate: "20261110" });
    expect(resolved.buildNumber).toBe(11);
    expect(resolved.tag).toBe("v0.1.9-local.stack.20261110.11");
  });

  it.each([
    ["an older series date", ["v0.1.9-local.stack.20261111.1"], "20261110"],
    ["an upstream stable that went backwards", ["v0.1.10-local.stack.20261101.3"], "20261110"],
    ["a peeled tag with a newer series date", ["v0.1.9-local.stack.20261110.4", "v0.1.9-local.stack.20261201.1^{}"], "20261110"],
  ])("refuses a version that would not be newer after %s", (_case, forkTags, seriesDate) => {
    const tags = forkTags.map((tag) => `abcd\trefs/tags/${tag}`);
    expect(() => resolveVersion({ upstreamReleases, forkTags: tags, seriesDate })).toThrow("would not be newer than the existing tag");
  });

  it("allows a newer series date after higher build numbers and ignores tags installers cannot run", () => {
    const forkTags = ["v0.1.9-local.stack.20261109.40", "v0.1.9-local.stack.20261110.3-rc", "v0.1.9-local.stack.20261112.07", "v9.9.9-fork.1"];
    expect(resolveVersion({ upstreamReleases, forkTags, seriesDate: "20261110" }).version).toBe("0.1.9-local.stack.20261110.1");
  });

  it("refuses a malformed series date", () => {
    expect(() => resolveVersion({ upstreamReleases, forkTags: [], seriesDate: "2026-11-10" })).toThrow("YYYYMMDD");
  });

  it("refuses when upstream has no published stable release", () => {
    expect(() =>
      resolveVersion({ upstreamReleases: [release("v0.2.0", true), release("v0.1.9-nightly.1", false, true)], forkTags: [], seriesDate: "20261110" }),
    ).toThrow("No published stable");
  });
});

describe("tagNameFromRef", () => {
  it("accepts bare tags and ls-remote lines", () => {
    expect(tagNameFromRef("v1.2.3")).toBe("v1.2.3");
    expect(tagNameFromRef("0123abc\trefs/tags/v1.2.3^{}")).toBe("v1.2.3");
  });
});
