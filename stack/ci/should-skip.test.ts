import { describe, expect, it } from "bun:test";
import { decideSkip, newestStackRelease } from "./should-skip.ts";

const upstreamSha = "1".repeat(40);
const stackSha = "2".repeat(40);
const manifest = {
  version: "0.1.9-local.stack.20261110.1",
  upstreamSha,
  stackSha,
  seriesDate: "20261110",
  buildNumber: 1,
  runUrl: "https://github.com/chomamateusz/t3code/actions/runs/1",
};

describe("decideSkip", () => {
  it("skips when the newest release was built from the same upstream and stack commits", () => {
    expect(decideSkip({ manifest, upstreamSha, stackSha, force: false }).skip).toBe(true);
  });

  it("builds when either commit changed", () => {
    expect(decideSkip({ manifest, upstreamSha: "3".repeat(40), stackSha, force: false }).skip).toBe(false);
    expect(decideSkip({ manifest, upstreamSha, stackSha: "3".repeat(40), force: false }).skip).toBe(false);
  });

  it("builds when forced even if nothing changed", () => {
    expect(decideSkip({ manifest, upstreamSha, stackSha, force: true })).toEqual({
      skip: false,
      reason: "forced by workflow_dispatch input",
    });
  });

  it("builds when there is no readable manifest", () => {
    expect(decideSkip({ manifest: undefined, upstreamSha, stackSha, force: false }).skip).toBe(false);
    expect(decideSkip({ manifest: { version: "x" }, upstreamSha, stackSha, force: false }).skip).toBe(false);
  });
});

describe("newestStackRelease", () => {
  it("picks the newest published non-draft stack release", () => {
    const releases = [
      { tagName: "v0.1.9-local.stack.20261110.1", isDraft: false, publishedAt: "2026-11-10T03:50:00Z", createdAt: "2026-11-10T03:40:00Z" },
      { tagName: "v0.1.9-local.stack.20261110.3", isDraft: true, publishedAt: null, createdAt: "2026-11-12T03:40:00Z" },
      { tagName: "v0.1.9-local.stack.20261110.2", isDraft: false, publishedAt: "2026-11-11T03:50:00Z", createdAt: "2026-11-11T03:40:00Z" },
      { tagName: "v0.1.9-fork.2026111201", isDraft: false, publishedAt: "2026-11-12T10:00:00Z", createdAt: "2026-11-12T10:00:00Z" },
    ];
    expect(newestStackRelease(releases)).toBe("v0.1.9-local.stack.20261110.2");
  });

  it("returns nothing when no stack release exists", () => {
    expect(newestStackRelease([])).toBeUndefined();
  });
});
