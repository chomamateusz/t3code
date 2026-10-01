import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AppUpdater } from "electron-updater/out/AppUpdater.js";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";

import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

class DiscoveryUpdater extends AppUpdater {
  provider: GitHubProvider | undefined;

  constructor() {
    super(undefined, {
      version: "0.0.46-fork.1",
      name: "T3 Code",
      isPackaged: true,
      appUpdateConfigPath: "/unused/app-update.yml",
      userDataPath: "/unused/userdata",
      baseCachePath: "/unused/cache",
      whenReady: () => Promise.resolve(),
      relaunch: () => {},
      quit: () => {},
      onQuit: () => {},
    });
    this.autoDownload = false;
    this.logger = null;
  }

  protected override async getUpdateInfoAndProvider() {
    if (!this.provider) {
      throw new Error("Missing test provider");
    }
    return { info: await this.provider.getLatestVersion(), provider: this.provider };
  }

  protected override doDownloadUpdate(): Promise<string[]> {
    throw new Error("Unexpected download during discovery");
  }

  override quitAndInstall() {
    throw new Error("Unexpected install during discovery");
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("fork GitHub release discovery", () => {
  it.effect.each(
    (["darwin", "linux"] as const).flatMap((platform) =>
      (
        [
          ["0.0.46-fork.2", true],
          ["0.0.47-fork.1", true],
          ["0.0.46", true],
          ["0.0.46-fork.1", false],
          ["0.0.46-fork.0", false],
          ["0.0.45", false],
        ] as const
      ).map(([version, available]) => ({ platform, version, available })),
    ),
  )(
    "$platform: $version availability on latest is $available",
    ({ platform, version, available }) => {
      const harness = makeHarness({
        allowedUpdateRepository: "chomamateusz/t3code",
        appUpdateYml: "provider: github\nowner: chomamateusz\nrepo: t3code\n",
        appVersion: "0.0.46-fork.1",
        env: {
          T3CODE_DESKTOP_MOCK_UPDATES: "false",
          ...(platform === "linux" ? { APPIMAGE: "/tmp/t3.AppImage" } : {}),
        },
        platform,
      });
      return Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        yield* updates.setChannel("nightly");
        vi.stubEnv("TEST_UPDATER_ARCH", "x64");
        const updater = new DiscoveryUpdater();
        updater.channel = harness.channel();
        updater.allowPrerelease = harness.allowPrerelease();
        updater.allowDowngrade = harness.allowDowngrade();
        assert.equal(updater.channel, "latest");
        assert.equal(updater.allowPrerelease, false);
        assert.equal(updater.allowDowngrade, false);

        const manifest = platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml";
        const basePath = "/chomamateusz/t3code/releases";
        const requests: string[] = [];
        const executor = new ElectronHttpExecutor();
        vi.spyOn(executor, "request").mockImplementation(async (options) => {
          assert.equal(options.hostname, "github.com");
          const path = options.path ?? "";
          requests.push(path);
          if (path === `${basePath}.atom`) {
            return `<feed><entry><title>Prerelease</title><link href="https://github.com/chomamateusz/t3code/releases/tag/v99.0.0-fork.1"/><content>Preview</content></entry><entry><title>Production release</title><link href="https://github.com/chomamateusz/t3code/releases/tag/v${version}"/><content>Release notes</content></entry></feed>`;
          }
          if (path === `${basePath}/latest`) {
            return JSON.stringify({ tag_name: `v${version}`, prerelease: false });
          }
          if (path === `${basePath}/download/v${version}/${manifest}`) {
            return `version: ${version}\nfiles:\n  - url: t3.zip\n    sha512: test\n`;
          }
          throw new Error(`Unexpected release request: ${path}`);
        });
        updater.provider = new GitHubProvider(
          { provider: "github", owner: "chomamateusz", repo: "t3code" },
          updater,
          { platform, executor, isUseMultipleRangeRequest: false },
        );
        const result = yield* Effect.promise(() => updater.checkForUpdates());
        assert.equal(result?.isUpdateAvailable, available);
        assert.equal(result?.updateInfo.version, version);
        assert.equal(result?.updateInfo.releaseName, "Production release");
        assert.deepEqual(requests, [
          `${basePath}.atom`,
          `${basePath}/latest`,
          `${basePath}/download/v${version}/${manifest}`,
        ]);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    },
  );
});
