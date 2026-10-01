import { describe, expect, it } from "vite-plus/test";
import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";

import {
  canCheckForUpdate,
  getDesktopUpdateActionError,
  isDesktopUpdateButtonDisabled,
  shouldToastDesktopUpdateActionResult,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDownloadUrl,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateReleaseUrl,
  resolveDesktopUpdateButtonAction,
} from "./desktopUpdate.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("desktop update button state", () => {
  it("keeps reinstall downloads on the baked release repository", () => {
    for (const channel of ["stable", "nightly"]) {
      expect(getDesktopUpdateDownloadUrl(channel, "chomamateusz/t3code")).toBe(
        "https://github.com/chomamateusz/t3code/releases",
      );
    }
    expect(getDesktopUpdateDownloadUrl("stable", "")).toBe("https://t3.codes/download");
    expect(getDesktopUpdateDownloadUrl("nightly", "")).toBe(
      "https://t3.codes/download?channel=nightly",
    );
  });

  it.each(["available", "downloaded", "disabled"] as const)(
    "shows the desktop refusal instead of the %s action when updates are disabled",
    (status) => {
      const state: DesktopUpdateState = {
        ...baseState,
        enabled: false,
        status,
        availableVersion: "0.0.47-fork.1",
        downloadedVersion: "0.0.47-fork.1",
        message: "Updates for this build come only from chomamateusz/t3code",
      };
      expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
      expect(isDesktopUpdateButtonDisabled(state)).toBe(true);
      expect(getDesktopUpdateButtonTooltip(state)).toBe(state.message);
    },
  );

  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("prefers a newly available release over a stale downloaded version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
      downloadedVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("hides the install action while checking for a newer release", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "checking",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });
});

describe("getDesktopUpdateActionError", () => {
  it("shows the refusal when the desktop disables an update action", () => {
    const result: DesktopUpdateActionResult = {
      accepted: false,
      completed: false,
      state: {
        ...baseState,
        enabled: false,
        status: "disabled",
        message: "Updates for this build come only from chomamateusz/t3code",
      },
    };
    expect(getDesktopUpdateActionError(result)).toBe(result.state.message);
    expect(shouldToastDesktopUpdateActionResult(result)).toBe(true);
  });
});

describe("desktop update UI helpers", () => {
  it.each(["owner/repo/extra", "owner#notes/repo", "owner/repo?tab=notes"])(
    "falls back to upstream for an invalid configured repository: %s",
    (repository) => {
      expect(getDesktopUpdateReleaseHistoryUrl(repository)).toBe(
        "https://github.com/pingdotgg/t3code/releases",
      );
      expect(getDesktopUpdateReleaseUrl("1.2.3", repository)).toBe(
        "https://github.com/pingdotgg/t3code/releases/tag/v1.2.3",
      );
    },
  );
});

describe("canCheckForUpdate", () => {
  it("returns true once an update has been downloaded so newer releases can be found", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(true);
  });
});
