import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as ElectronUpdater from "../electron/ElectronUpdater.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

const repository = "chomamateusz/t3code";
const feed = "provider: github\nowner: chomamateusz\nrepo: t3code\n";
const refusal = `Updates for this build come only from ${repository}`;

function emitState(
  harness: ReturnType<typeof makeHarness>,
  event: "update-available" | "update-downloaded",
) {
  return Effect.gen(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const { changes } = yield* updates.subscribe;
    const next = yield* Stream.runHead(changes).pipe(Effect.forkChild);
    harness.emit(event, { version: "0.0.46-fork.2" });
    yield* Fiber.join(next);
  });
}

describe("configured desktop update repository", () => {
  it.effect.each([
    undefined,
    "provider: github\nowner: pingdotgg\nrepo: t3code\n",
    `${feed}host: updates.example.com\n`,
    `${feed}protocol: http\n`,
    "provider: generic\nurl: https://github.com/chomamateusz/t3code\n",
  ])("refuses a missing or foreign packaged feed: %s", (appUpdateYml) => {
    const harness = makeHarness({
      allowedUpdateRepository: repository,
      appUpdateYml,
      env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const download = yield* updates.download;
        const install = yield* updates.install;
        const prepared = yield* updates.installPrepared("0.0.46-fork.2");
        for (const result of [download, install, prepared]) {
          assert.equal(result.accepted, false);
          assert.equal(result.state.enabled, false);
          assert.equal(result.state.status, "disabled");
          assert.equal(result.state.message, refusal);
        }
        assert.equal(harness.downloadCount(), 0);
        assert.equal(harness.quitAndInstalls(), 0);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("downloads and installs from a case-insensitive packaged fork feed on latest", () => {
    const harness = makeHarness({
      allowedUpdateRepository: "Chomamateusz/T3code",
      appUpdateYml: "provider: github\nowner: chomamateusz\nrepo: T3Code\n",
      appVersion: "0.0.46-fork.1",
      env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal((yield* updates.getState).enabled, true);
        assert.equal(harness.channel(), "latest");
        assert.equal(harness.allowPrerelease(), false);
        assert.equal(harness.allowDowngrade(), false);
        yield* updates.setChannel("nightly");
        assert.equal((yield* updates.getState).channel, "latest");
        assert.equal(harness.channel(), "latest");
        assert.equal(harness.allowPrerelease(), false);
        assert.equal(harness.allowDowngrade(), false);
        yield* emitState(harness, "update-available");
        assert.equal((yield* updates.download).completed, true);
        yield* emitState(harness, "update-downloaded");
        assert.equal((yield* updates.install).accepted, true);
        assert.equal(harness.downloadCount(), 1);
        assert.equal(harness.quitAndInstalls(), 1);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("ignores runtime feed overrides when the allowed repository is baked", () => {
    const harness = makeHarness({
      allowedUpdateRepository: repository,
      appUpdateYml: feed,
      env: {
        T3CODE_DESKTOP_MOCK_UPDATES: "true",
        T3CODE_DESKTOP_UPDATE_REPOSITORY: "pingdotgg/t3code",
        T3CODE_ALLOWED_UPDATE_REPOSITORY: "pingdotgg/t3code",
        T3CODE_RELEASE_REPOSITORY: "pingdotgg/t3code",
        T3CODE_RELEASE_BASE_URL: "https://mirror.example/t3",
      },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const updater = yield* ElectronUpdater.ElectronUpdater;
        yield* updates.configure;
        assert.equal((yield* updates.getState).enabled, true);
        assert.equal(yield* updater.feedURL, undefined);
        yield* emitState(harness, "update-available");
        assert.equal((yield* updates.download).completed, true);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect.each([undefined, "https://mirror.example/t3"])(
    "keeps managed update restrictions alongside the fork allowlist: %s",
    (feedUrl) => {
      const harness = makeHarness({
        allowedUpdateRepository: repository,
        appUpdateYml: feed,
        policy: {
          mode: "off",
          feedUrl,
          allowNightly: false,
          message: "Managed updates are disabled.",
        },
      });
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;
          const state = yield* updates.getState;
          assert.equal(state.enabled, false);
          assert.equal(
            state.message,
            feedUrl === undefined ? "Managed updates are disabled." : refusal,
          );
          assert.equal((yield* updates.check("menu")).checked, false);
          assert.equal((yield* updates.download).accepted, false);
          assert.equal((yield* updates.install).accepted, false);
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
        }),
      ).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect("rechecks the feed after stopping backends and recovers a refused install", () => {
    let redirect = Effect.void;
    const harness = makeHarness({
      allowedUpdateRepository: repository,
      appUpdateYml: feed,
      env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
      stopBackend: Effect.suspend(() => redirect),
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const updater = yield* ElectronUpdater.ElectronUpdater;
        yield* updates.configure;
        yield* emitState(harness, "update-downloaded");
        redirect = updater.setFeedURL("https://updates.example.com");
        const result = yield* updates.installPrepared("0.0.46-fork.2");
        assert.equal(result.failed, true);
        assert.equal(result.state.status, "disabled");
        assert.equal(result.state.message, refusal);
        assert.equal(harness.quitAndInstalls(), 0);
        assert.deepEqual(harness.installSteps, ["startBackend"]);
        assert.equal(harness.updateRestartMarkers.size, 0);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect.each(["download", "install", "installPrepared"] as const)(
    "refuses a feed override before %s",
    (action) => {
      const harness = makeHarness({
        allowedUpdateRepository: repository,
        appUpdateYml: feed,
        env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
      });
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          const updater = yield* ElectronUpdater.ElectronUpdater;
          yield* updates.configure;
          yield* emitState(harness, "update-available");
          if (action !== "download") yield* emitState(harness, "update-downloaded");
          yield* updater.setFeedURL({
            provider: "github",
            owner: "chomamateusz",
            repo: "t3code",
            host: "updates.example.com",
          });
          const result = yield* action === "installPrepared"
            ? updates.installPrepared("0.0.46-fork.2")
            : updates[action];
          assert.equal(result.accepted, false);
          assert.equal(result.state.status, "disabled");
          assert.equal(result.state.message, refusal);
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
        }),
      ).pipe(Effect.provide(harness.layer));
    },
  );
});
