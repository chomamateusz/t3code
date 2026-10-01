import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

const { autoUpdaterMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: "latest",
    disableDifferentialDownload: false,
    fullChangelog: false,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import * as ElectronUpdater from "./ElectronUpdater.ts";

describe("ElectronUpdater", () => {
  it.effect("tracks an immutable snapshot of the feed passed to electron-updater", () =>
    Effect.gen(function* () {
      const updater = yield* ElectronUpdater.ElectronUpdater;
      const options = {
        provider: "github" as const,
        owner: "chomamateusz",
        repo: "t3code",
        host: "github.com",
      };
      yield* updater.setFeedURL(options);
      options.host = "updates.example.com";
      assert.deepEqual(yield* updater.feedURL, { ...options, host: "github.com" });
      assert.deepEqual(autoUpdaterMock.setFeedURL.mock.calls, [
        [{ ...options, host: "github.com" }],
      ]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );
});
