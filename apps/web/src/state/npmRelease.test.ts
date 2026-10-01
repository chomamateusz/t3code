import * as NodeAssert from "node:assert/strict";

import { EnvironmentId, ServerConfig, ServerNpmReleaseError } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterAll, afterEach, vi } from "vite-plus/test";

import { npmReleaseAtom, npmReleaseFailureMessage } from "./npmRelease";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

vi.mock("./server", () => ({
  serverEnvironment: { npmRelease: vi.fn(), configValueAtom: vi.fn() },
}));
vi.mock("./presentation", () => ({
  environmentSummaries: { connectedEnvironmentIdsAtom: Atom.make(["first", "second"]) },
}));
vi.mock("./primaryEnvironment", () => ({
  primaryEnvironmentIdAtom: Atom.make<EnvironmentId | null>(null),
}));

const fetchMock = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const version = "0.0.46-nightly.20261012.3021";
const first = EnvironmentId.make("first");
const second = EnvironmentId.make("second");
const decodeServerConfig = Schema.decodeUnknownSync(ServerConfig);

const configFor = (environmentId: EnvironmentId | null, supported = true) =>
  decodeServerConfig({
    environment: {
      environmentId,
      label: environmentId,
      platform: { os: "linux", arch: "x64" },
      serverVersion: version,
      capabilities: {
        repositoryIdentity: true,
        ...(supported ? { npmReleaseLookup: true } : {}),
      },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    cwd: "/test",
    keybindingsConfigPath: "/test/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/test/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {},
  });

function setup(supported = true) {
  vi.mocked(serverEnvironment.configValueAtom)
    .mockReset()
    .mockImplementation((environmentId) => Atom.make(configFor(environmentId, supported)));
  return vi.mocked(serverEnvironment.npmRelease).mockReset();
}

it.effect(
  "resolves track metadata through the primary environment and follows primary changes",
  () =>
    Effect.gen(function* () {
      const query = setup();
      query.mockImplementation(({ environmentId }) =>
        Atom.make(
          AsyncResult.success({ version, databaseMigration: environmentId === first ? 42 : 43 }),
        ),
      );
      const registry = AtomRegistry.make();
      const release = npmReleaseAtom("nightly");
      NodeAssert.ok(
        Atom.isWritable<EnvironmentId | null, EnvironmentId | null>(primaryEnvironmentIdAtom),
        "Expected the mocked primary environment atom to be writable.",
      );
      registry.set(primaryEnvironmentIdAtom, first);
      const unmount = registry.mount(release);
      try {
        expect(
          yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true }),
        ).toEqual({
          version,
          databaseMigration: 42,
        });
        registry.set(primaryEnvironmentIdAtom, second);
        expect(
          yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true }),
        ).toEqual({
          version,
          databaseMigration: 43,
        });
      } finally {
        unmount();
        registry.dispose();
      }
    }),
);

it.effect("resolves track metadata through a supporting server when there is no primary", () =>
  Effect.gen(function* () {
    const query = setup();
    vi.mocked(serverEnvironment.configValueAtom).mockImplementation((environmentId) =>
      Atom.make(
        environmentId === first ? configFor(environmentId, false) : configFor(environmentId),
      ),
    );
    query.mockReturnValue(Atom.make(AsyncResult.success({ version })));
    const registry = AtomRegistry.make();
    const release = npmReleaseAtom("nightly");
    const unmount = registry.mount(release);
    try {
      expect(yield* AtomRegistry.getResult(registry, release, { suspendOnWaiting: true })).toEqual({
        version,
        databaseMigration: undefined,
      });
      expect(query).toHaveBeenCalledWith({ environmentId: second, input: { spec: "nightly" } });
    } finally {
      unmount();
      registry.dispose();
    }
  }),
);

it.effect("does not call an unsupported RPC or fetch public npm for an older primary server", () =>
  Effect.gen(function* () {
    const query = setup(false);
    fetchMock.mockRejectedValue(new Error("Unexpected browser fetch"));
    const registry = AtomRegistry.make();
    NodeAssert.ok(
      Atom.isWritable<EnvironmentId | null, EnvironmentId | null>(primaryEnvironmentIdAtom),
      "Expected the mocked primary environment atom to be writable.",
    );
    registry.set(primaryEnvironmentIdAtom, first);
    const release = npmReleaseAtom("latest");
    const unmount = registry.mount(release);
    try {
      const error = yield* AtomRegistry.getResult(registry, release).pipe(Effect.flip);
      expect(npmReleaseFailureMessage(Cause.fail(error))).toContain(
        "Update it before switching tracks",
      );
      expect(query).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      unmount();
      registry.dispose();
    }
  }),
);

it("only displays the safe release error, not arbitrary transport diagnostics", () => {
  const error = new ServerNpmReleaseError({ reason: "Install npm on the server's PATH." });
  expect(npmReleaseFailureMessage(Cause.fail(error))).toBe(error.message);
  expect(
    npmReleaseFailureMessage(Cause.fail(new Error("sensitive transport details"))),
  ).not.toContain("sensitive");
});

it.effect("checks fork versions and tracks without consulting a server registry", () =>
  Effect.gen(function* () {
    const query = setup();
    vi.stubEnv("T3CODE_RELEASE_REPOSITORY", " Chomamateusz/T3Code ");
    const registry = AtomRegistry.make();
    const exact = npmReleaseAtom(version);
    const latest = npmReleaseAtom("latest");
    try {
      fetchMock.mockResolvedValueOnce(Response.json({ tag_name: `v${version}` }));
      expect(yield* AtomRegistry.getResult(registry, exact, { suspendOnWaiting: true })).toEqual({
        version,
        databaseMigration: undefined,
      });
      const request = new Request(fetchMock.mock.calls[0]![0], fetchMock.mock.calls[0]![1]);
      expect(request.url).toBe(
        `https://api.github.com/repos/chomamateusz/t3code/releases/tags/v${version}`,
      );
      expect(request.headers.get("traceparent")).toBeNull();
      expect(request.headers.get("b3")).toBeNull();
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(
        Response.json(
          Array.from({ length: 100 }, () => ({ tag_name: `v${version}`, prerelease: true })),
        ),
      );
      fetchMock.mockResolvedValueOnce(
        Response.json([{ tag_name: "v0.1.4-fork.2", draft: true }, { tag_name: "v0.1.4-fork.1" }]),
      );
      expect(yield* AtomRegistry.getResult(registry, latest, { suspendOnWaiting: true })).toEqual({
        version: "0.1.4-fork.1",
        databaseMigration: undefined,
      });
      expect(fetchMock.mock.calls.map(([input, init]) => new Request(input, init).url)).toEqual([
        "https://api.github.com/repos/chomamateusz/t3code/releases?per_page=100&page=1",
        "https://api.github.com/repos/chomamateusz/t3code/releases?per_page=100&page=2",
      ]);
      expect(query).not.toHaveBeenCalled();
    } finally {
      registry.dispose();
      vi.unstubAllEnvs();
    }
  }),
);

it.effect.each([
  { repository: "chomamateusz/t3code", body: null, status: 404, fails: false },
  {
    repository: "chomamateusz/t3code",
    body: { tag_name: `v${version}`, draft: true },
    status: 200,
    fails: false,
  },
  { repository: "chomamateusz/t3code", body: { tag_name: "v0.0.1" }, status: 200, fails: false },
  { repository: "chomamateusz/t3code", body: { version }, status: 200, fails: true },
  { repository: "invalid/repository/path", body: null, status: 404, fails: false },
])(
  "does not fall back from an unavailable fork release: %o",
  ({ repository, body, status, fails }) =>
    Effect.gen(function* () {
      const query = setup();
      fetchMock.mockResolvedValue(Response.json(body, { status }));
      vi.stubEnv("T3CODE_RELEASE_REPOSITORY", repository);
      const registry = AtomRegistry.make();
      try {
        const result = yield* AtomRegistry.getResult(registry, npmReleaseAtom(version), {
          suspendOnWaiting: true,
        }).pipe(Effect.result);
        expect(result._tag).toBe(fails ? "Failure" : "Success");
        if (result._tag === "Success") expect(result.success).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(repository === "chomamateusz/t3code" ? 1 : 0);
        expect(query).not.toHaveBeenCalled();
      } finally {
        registry.dispose();
        vi.unstubAllEnvs();
      }
    }),
);
