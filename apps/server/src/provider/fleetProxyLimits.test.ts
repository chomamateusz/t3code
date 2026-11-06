import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vite-plus/test";

import sample from "./fleetProxyLimits.fixture.json" with { type: "json" };
import { fleetProxyUsableAt, resolveFleetProxyResetAt } from "./fleetProxyLimits.ts";

const NOW_MS = Date.parse("2026-11-06T12:00:00.000Z");
const SONNET = "claude-sonnet-5-5";
const FABLE = "claude-fable-5-1";

type Credential = (typeof sample.credentials)[number];

const withCredentials = (
  keep: (credential: Credential) => boolean,
  map: (credential: Credential) => unknown = (credential) => credential,
  exclusions: ReadonlyArray<unknown> = [],
) => ({
  ...sample,
  exclusions,
  credentials: sample.credentials.filter(keep).map(map),
});
const withoutUsable = (exclusions: ReadonlyArray<unknown> = []) =>
  withCredentials((credential) => credential.label !== "claude-0128af49", undefined, exclusions);
const usableAt = (limits: unknown, model = SONNET) =>
  fleetProxyUsableAt(limits, { model, nowMs: NOW_MS });

describe("fleetProxyUsableAt", () => {
  it("returns null while any Claude credential can still serve the model", () => {
    expect(usableAt(sample)).toBeNull();
    expect(usableAt(sample, FABLE)).toBeNull();
  });

  it("returns the earliest time a blocked credential frees", () => {
    expect(usableAt(withoutUsable())).toEqual({
      resetAt: "2026-11-06T14:20:30.000Z",
      label: "claude-6f83155b",
    });
    expect(usableAt(withoutUsable(), FABLE)?.resetAt).toBe("2026-11-06T14:20:30.000Z");
  });

  it("applies model-scoped cooldowns only to their model", () => {
    const modelScopedOnly = withCredentials(
      (credential) => credential.label === "claude-6f83155b",
      (credential) => ({
        ...credential,
        bars: [],
        cooldowns: credential.cooldowns.filter((cooldown) => cooldown.scope === "model"),
      }),
    );
    expect(usableAt(modelScopedOnly, FABLE)?.resetAt).toBe("2026-11-06T14:20:30.000Z");
    expect(usableAt(modelScopedOnly, "claude-opus-4-8")).toBeNull();
  });

  it("dates a weekly-only rejection by the weekly reset", () => {
    const weeklyOnly = withCredentials((credential) => credential.label === "claude-dfb6a006");
    expect(usableAt(weeklyOnly)).toEqual({
      resetAt: "2026-11-08T16:00:00.000Z",
      label: "claude-dfb6a006",
    });
  });

  it("applies the Fable weekly bar only to Fable models", () => {
    const fableWeekly = withCredentials(
      (credential) => credential.label === "claude-dfb6a006",
      (credential) => ({
        ...credential,
        bars: credential.bars.filter((bar) => bar.id === "weekly_fable"),
      }),
    );
    expect(usableAt(fableWeekly, FABLE)?.resetAt).toBe("2026-11-08T16:00:00.000Z");
    expect(usableAt(fableWeekly, SONNET)).toBeNull();
  });

  it("ignores passed resets and past timestamps", () => {
    const only = (bars: ReadonlyArray<unknown>, cooldowns: ReadonlyArray<unknown> = []) =>
      withCredentials(
        (credential) => credential.label === "claude-dfb6a006",
        (credential) => ({ ...credential, bars, cooldowns }),
      );
    const rejected = sample.credentials.find(
      (credential) => credential.label === "claude-dfb6a006",
    )!.bars[0]!;
    expect(usableAt(only([{ ...rejected, reset_passed: true }]))).toBeNull();
    expect(usableAt(only([{ ...rejected, resets_at: "2026-11-06T11:00:00Z" }]))).toBeNull();
    expect(
      usableAt(
        only(
          [],
          [{ scope: "credential", model: null, until: "2026-11-06T11:59:59Z", reason: "quota" }],
        ),
      ),
    ).toBeNull();
  });

  it("ignores disabled credentials", () => {
    const disabledAndWeekly = withCredentials(
      (credential) =>
        credential.label === "claude-032ce27c" || credential.label === "claude-dfb6a006",
    );
    expect(usableAt(disabledAndWeekly)?.resetAt).toBe("2026-11-08T16:00:00.000Z");
    expect(
      usableAt(withCredentials((credential) => credential.label === "claude-032ce27c")),
    ).toBeNull();
  });

  it("ignores credentials in the error state", () => {
    const erroredAndWeekly = withCredentials(
      (credential) =>
        credential.label === "claude-0128af49" || credential.label === "claude-dfb6a006",
      (credential) =>
        credential.label === "claude-0128af49" ? { ...credential, state: "error" } : credential,
    );
    expect(usableAt(erroredAndWeekly)?.resetAt).toBe("2026-11-08T16:00:00.000Z");
    expect(
      usableAt(
        withCredentials(
          (credential) => credential.label === "claude-0128af49",
          (credential) => ({ ...credential, state: "error" }),
        ),
      ),
    ).toBeNull();
  });

  it("returns null without Claude credentials or for malformed input", () => {
    expect(usableAt(withCredentials((credential) => credential.provider === "codex"))).toBeNull();
    for (const garbage of [
      null,
      "nope",
      42,
      [],
      { credentials: "x" },
      { credentials: [null, 1] },
    ]) {
      expect(usableAt(garbage)).toBeNull();
    }
  });

  it("extends the reset to a matching exclusion only when no credential is usable", () => {
    const exclusion = {
      pattern: "claude-sonnet-*",
      provider: "claude",
      until: "2026-11-07T00:00:00Z",
    };
    expect(usableAt(withoutUsable([exclusion]))?.resetAt).toBe("2026-11-07T00:00:00.000Z");
    expect(usableAt({ ...sample, exclusions: [exclusion] })).toBeNull();
    expect(usableAt(withoutUsable([exclusion]), FABLE)?.resetAt).toBe("2026-11-06T14:20:30.000Z");
    expect(usableAt(withoutUsable([{ ...exclusion, provider: "codex" }]))?.resetAt).toBe(
      "2026-11-06T14:20:30.000Z",
    );
    expect(usableAt(withoutUsable([{ ...exclusion, until: null }]))).toBeNull();
    expect(
      usableAt(withoutUsable([{ ...exclusion, until: null, provider: "codex" }]))?.resetAt,
    ).toBe("2026-11-06T14:20:30.000Z");
  });
});

const recordingClient = (status: number, body: string) => {
  const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ url: request.url, headers: { ...request.headers } });
      return HttpClientResponse.fromWeb(request, new Response(body, { status }));
    }),
  );
  return { client, requests };
};

const writeSettings = Effect.fn(function* (settings: unknown) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fleet-limits-" });
  yield* fileSystem.writeFileString(path.join(homePath, "settings.json"), JSON.stringify(settings));
  return homePath;
});

const resolve = (input: {
  readonly homePath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly client: HttpClient.HttpClient;
}) =>
  resolveFleetProxyResetAt({
    model: SONNET,
    settings: { homePath: input.homePath },
    cwd: undefined,
    environment: input.environment,
    now: DateTime.makeUnsafe(NOW_MS),
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.client),
    Effect.provideService(HostProcess.Platform, "linux"),
  );

describe("resolveFleetProxyResetAt", () => {
  effectIt.effect("asks the settings base URL with the apiKeyHelper key", () =>
    Effect.gen(function* () {
      const homePath = yield* writeSettings({
        env: { ANTHROPIC_BASE_URL: "http://proxy.test:8317/" },
        apiKeyHelper: "printf ' helper-key\\n'",
      });
      const { client, requests } = recordingClient(200, JSON.stringify(withoutUsable()));
      const resetAt = yield* resolve({
        homePath,
        environment: { ANTHROPIC_BASE_URL: "http://ignored.test" },
        client,
      });
      expect(resetAt).toBe("2026-11-06T14:20:30.000Z");
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe("http://proxy.test:8317/v1/fleet/limits");
      expect(requests[0]!.headers.authorization).toBe("Bearer helper-key");
      expect(requests[0]!.headers.accept).toBe("application/json");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  effectIt.effect("prefers the environment token and keeps a base path", () =>
    Effect.gen(function* () {
      const homePath = yield* writeSettings({ apiKeyHelper: "exit 1" });
      const { client, requests } = recordingClient(200, JSON.stringify(withoutUsable()));
      const resetAt = yield* resolve({
        homePath,
        environment: {
          ANTHROPIC_BASE_URL: "https://proxy.test/claude",
          ANTHROPIC_AUTH_TOKEN: "env-token",
          ANTHROPIC_API_KEY: "api-key",
        },
        client,
      });
      expect(resetAt).toBe("2026-11-06T14:20:30.000Z");
      expect(requests[0]!.url).toBe("https://proxy.test/claude/v1/fleet/limits");
      expect(requests[0]!.headers.authorization).toBe("Bearer env-token");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  effectIt.effect("returns null without a base URL, a key, a 200 or valid JSON", () =>
    Effect.gen(function* () {
      const emptyHome = yield* writeSettings({});
      const failingHelperHome = yield* writeSettings({ apiKeyHelper: "exit 3" });
      const ok = recordingClient(200, JSON.stringify(withoutUsable()));
      expect(
        yield* resolve({
          homePath: emptyHome,
          environment: { ANTHROPIC_API_KEY: "k" },
          client: ok.client,
        }),
      ).toBeNull();
      expect(
        yield* resolve({
          homePath: failingHelperHome,
          environment: { ANTHROPIC_BASE_URL: "http://proxy.test" },
          client: ok.client,
        }),
      ).toBeNull();
      expect(ok.requests).toHaveLength(0);
      for (const [status, body] of [
        [404, "{}"],
        [200, "not json"],
      ] as const) {
        const { client } = recordingClient(status, body);
        expect(
          yield* resolve({
            homePath: emptyHome,
            environment: { ANTHROPIC_BASE_URL: "http://proxy.test", ANTHROPIC_API_KEY: "k" },
            client,
          }),
        ).toBeNull();
      }
      const failing = HttpClient.make(() => Effect.die(new Error("network down")));
      expect(
        yield* resolve({
          homePath: emptyHome,
          environment: { ANTHROPIC_BASE_URL: "http://proxy.test", ANTHROPIC_API_KEY: "k" },
          client: failing,
        }),
      ).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  effectIt.effect("returns null once the overall lookup exceeds six seconds", () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient(200, JSON.stringify(withoutUsable()));
      const pending = yield* resolve({
        homePath: "/fleet-home",
        environment: { ANTHROPIC_BASE_URL: "http://proxy.test", ANTHROPIC_API_KEY: "k" },
        client,
      }).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({ readFileString: () => Effect.never }),
        ),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* TestClock.adjust("5999 millis");
      expect(pending.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 millis");
      expect(yield* Fiber.join(pending)).toBeNull();
      expect(requests).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
