import { describe, expect, it } from "bun:test";
import { classifyRun, summaryMarkdown } from "./classify-run.ts";

const prepareOutputs = {
  skip: "false",
  skip_reason: "upstream or stack changed since 0.1.9-local.stack.20261110.1",
  version: "0.1.9-local.stack.20261110.2",
  tag: "v0.1.9-local.stack.20261110.2",
  upstream_sha: "1".repeat(40),
  stack_sha: "2".repeat(40),
  series_date: "20261110",
  build_number: "2",
};

function needs(results: Record<string, string>, outputs: Record<string, string> = prepareOutputs) {
  const all: Record<string, string> = {
    prepare: "success",
    quality: "success",
    test: "success",
    test_web: "success",
    test_server: "success",
    build_linux_x64: "success",
    accept_linux_x64: "success",
    release: "success",
    ...results,
  };
  return Object.fromEntries(
    Object.entries(all).map(([job, result]) => [job, { result, outputs: job === "prepare" ? outputs : {} }]),
  );
}

const runUrl = "https://github.com/chomamateusz/t3code/actions/runs/7";
const failedApply = {
  status: "failed",
  upstreamSha: "1".repeat(40),
  patches: 14,
  failedIndex: 3,
  failedPatch: "0003-Accept-app-updates-only-from-the-configured-fork.patch",
  failedSubject: "🔒 Accept app updates only from the configured fork",
  conflictedPaths: ["apps/desktop/src/updates/DesktopUpdates.ts"],
};

describe("classifyRun", () => {
  it("reports success when every job passed", () => {
    const result = classifyRun({ needs: needs({}), applyResult: undefined, runUrl });
    expect(result.status).toBe("success");
    expect(result.stage).toBeNull();
    expect(result.version).toBe("0.1.9-local.stack.20261110.2");
    expect(result.workflowDrift).toBe(false);
  });

  it("carries workflow drift without failing the run", () => {
    const result = classifyRun({ needs: needs({}, { ...prepareOutputs, workflow_drift: "true" }), applyResult: undefined, runUrl });
    expect(result.status).toBe("success");
    expect(result.workflowDrift).toBe(true);
  });

  it("reports apply with the failing patch and paths when prepare failed applying the series", () => {
    const result = classifyRun({
      needs: needs({ prepare: "failure", quality: "skipped", test: "skipped", test_web: "skipped", test_server: "skipped", build_linux_x64: "skipped", accept_linux_x64: "skipped", release: "skipped" }),
      applyResult: failedApply,
      runUrl,
    });
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("apply");
    expect(result.apply).toEqual(failedApply);
    expect(summaryMarkdown(result)).toContain("`apps/desktop/src/updates/DesktopUpdates.ts`");
  });

  it("reports prepare when it failed before or without a failed apply", () => {
    const result = classifyRun({ needs: needs({ prepare: "failure", release: "skipped" }), applyResult: { status: "applied" }, runUrl });
    expect(result.stage).toBe("prepare");
    expect(result.apply).toBeNull();
  });

  it.each([
    [{ quality: "failure" }, "test"],
    [{ test_server: "failure", build_linux_x64: "skipped" }, "test"],
    [{ build_linux_x64: "failure", accept_linux_x64: "skipped" }, "build"],
    [{ build_macos_arm64: "failure" }, "build"],
    [{ accept_linux_x64: "failure", release: "skipped" }, "accept"],
    [{ release: "failure" }, "release"],
    [{ test_web: "failure", release: "failure" }, "test"],
  ])("maps failed jobs %j to stage %s", (results, stage) => {
    const result = classifyRun({ needs: needs(results), applyResult: undefined, runUrl });
    expect(result.status).toBe("failed");
    expect(result.stage).toBe(stage);
  });

  it("reports a cancelled run with the stage it stopped in", () => {
    const result = classifyRun({ needs: needs({ build_linux_x64: "cancelled", accept_linux_x64: "skipped", release: "skipped" }), applyResult: undefined, runUrl });
    expect(result.status).toBe("cancelled");
    expect(result.stage).toBe("build");
  });

  it("reports a quiet skip with its reason", () => {
    const skipped = Object.fromEntries(["quality", "test", "test_web", "test_server", "build_linux_x64", "accept_linux_x64", "release"].map((job) => [job, "skipped"]));
    const result = classifyRun({
      needs: needs(skipped, { ...prepareOutputs, skip: "true", skip_reason: "already built" }),
      applyResult: undefined,
      runUrl,
    });
    expect(result.status).toBe("skipped");
    expect(result.stage).toBeNull();
    expect(result.reason).toBe("already built");
  });

  it("treats a required job that silently did not run as a failure", () => {
    const result = classifyRun({ needs: needs({ release: "skipped" }), applyResult: undefined, runUrl });
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("release");
  });
});
