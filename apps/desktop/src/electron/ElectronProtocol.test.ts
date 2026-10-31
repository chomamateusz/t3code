import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { beforeEach, vi } from "vite-plus/test";

const { handleMock, netFetchMock, unhandleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  netFetchMock: vi.fn(),
  unhandleMock: vi.fn(),
}));

vi.mock("electron", () => ({
  net: { fetch: netFetchMock },
  protocol: { handle: handleMock, unhandle: unhandleMock },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

const layerProtocol = ElectronProtocol.layer.pipe(Layer.provide(NodeServices.layer));

describe("ElectronProtocol", () => {
  beforeEach(() => {
    handleMock.mockReset();
    netFetchMock.mockReset();
    unhandleMock.mockReset();
  });

  it("purges renderer caches on first launch and every version change", () => {
    assert.isTrue(ElectronProtocol.shouldClearRendererCache(null, "0.0.18"));
    assert.isTrue(ElectronProtocol.shouldClearRendererCache("0.0.17", "0.0.18"));
    assert.isTrue(ElectronProtocol.shouldClearRendererCache("0.0.18", "0.0.17"));
    assert.isFalse(ElectronProtocol.shouldClearRendererCache("0.0.18", "0.0.18"));
  });

  it.effect("sets cache policies for bundled documents and assets", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.makeDirectory(`${directory}/assets`);
      for (const file of [
        "index.html",
        "help.html",
        "assets/page-BKx6Wqpp.html",
        "assets/atomRegistry-BKx6Wqpp.js",
        "assets/style-D9_A-b12.css",
        "assets/app.js",
        "app-BKx6Wqpp.js",
        "favicon.ico",
      ]) {
        yield* fileSystem.writeFileString(`${directory}/${file}`, "bundled content");
      }
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      const protocol = yield* ElectronProtocol.ElectronProtocol;
      yield* protocol.registerDesktopProtocol({
        scheme: "t3code",
        assetDirectory: directory,
        baseDir: directory,
        appVersion: "1.2.3",
        clerkFrontendApiHostname: undefined,
      });

      for (const [pathname, cacheControl] of [
        ["/", "no-store"],
        ["/settings/connections", "no-store"],
        ["/help.html", "no-store"],
        ["/assets/page-BKx6Wqpp.html", "no-store"],
        ["/assets/atomRegistry-BKx6Wqpp.js?v=1", "public, max-age=31536000, immutable"],
        ["/assets/style-D9_A-b12.css", "public, max-age=31536000, immutable"],
        ["/assets/app.js", "no-cache"],
        ["/app-BKx6Wqpp.js", "no-cache"],
        ["/favicon.ico", "no-cache"],
      ]) {
        const response = yield* Effect.promise(() =>
          handler!(new Request(`t3code://app${pathname}`)),
        );
        assert.equal(response.headers.get("cache-control"), cacheControl, pathname);
      }
    }).pipe(Effect.provide(Layer.merge(layerProtocol, NodeServices.layer)), Effect.scoped),
  );

  it.effect("serves the bundled client from disk without a backend", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.writeFileString(`${directory}/index.html`, "<html>app</html>");
      yield* fileSystem.writeFileString(`${directory}/app.js`, "export default 1;");
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      const protocol = yield* ElectronProtocol.ElectronProtocol;
      yield* protocol.registerDesktopProtocol({
        scheme: "t3code",
        assetDirectory: directory,
        baseDir: directory,
        appVersion: "1.2.3",
        clerkFrontendApiHostname: undefined,
      });
      const request = (pathname: string, init?: RequestInit) =>
        Effect.promise(() => handler!(new Request(`t3code://app${pathname}`, init)));

      const page = yield* request("/settings/connections");
      assert.equal(yield* Effect.promise(() => page.text()), "<html>app</html>");
      assert.include(page.headers.get("content-security-policy") ?? "", "default-src 'self'");
      const dottedRoute = yield* request("/environment/thread.with.dots", {
        headers: { accept: "text/html" },
      });
      assert.equal(yield* Effect.promise(() => dottedRoute.text()), "<html>app</html>");

      const script = yield* request("/app.js?v=1");
      assert.equal(yield* Effect.promise(() => script.text()), "export default 1;");
      assert.include(script.headers.get("content-type") ?? "", "javascript");

      const head = yield* request("/app.js", { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("cache-control"), "no-cache");
      assert.equal(yield* Effect.promise(() => head.text()), "");

      for (const [pathname, status, method] of [
        ["/missing.js", 404, "GET"],
        ["/assets/missing-BKx6Wqpp.js", 404, "GET"],
        ["/assets/missing-BKx6Wqpp.js", 404, "HEAD"],
        ["/%2e%2e%2fsecret.txt", 404, "GET"],
        ["/%invalid", 400, "GET"],
        ["/%00", 400, "GET"],
        ["/", 405, "POST"],
      ] as const) {
        const response = yield* request(pathname, { method });
        assert.equal(response.status, status, pathname);
        assert.equal(response.headers.get("cache-control"), "no-store", pathname);
        if (method === "HEAD") {
          assert.equal(yield* Effect.promise(() => response.text()), "");
        }
      }
      const otherHost = yield* Effect.promise(() => handler!(new Request("t3code://other/")));
      assert.equal(otherHost.status, 404);
      assert.equal(otherHost.headers.get("cache-control"), "no-store");

      yield* fileSystem.remove(`${directory}/index.html`);
      const missingIndex = yield* request("/");
      assert.equal(missingIndex.status, 404);
      assert.equal(missingIndex.headers.get("cache-control"), "no-store");
      assert.equal(netFetchMock.mock.calls.length, 0);
    }).pipe(Effect.provide(Layer.merge(layerProtocol, NodeServices.layer)), Effect.scoped),
  );

  it.effect("selects versioned overrides per request and confines their assets", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const bundled = `${directory}/bundled`;
      const overrides = `${directory}/web-override`;
      yield* fileSystem.makeDirectory(bundled);
      yield* fileSystem.makeDirectory(overrides);
      yield* fileSystem.writeFileString(`${bundled}/index.html`, "bundled");
      yield* fileSystem.writeFileString(`${directory}/secret.txt`, "secret");
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      const warnings: unknown[] = [];
      const logger = Logger.make(({ message }) => warnings.push(message));
      const protocol = yield* ElectronProtocol.make.pipe(
        Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      );
      yield* protocol.registerDesktopProtocol({
        scheme: "t3code",
        assetDirectory: bundled,
        baseDir: directory,
        appVersion: "1.2.3-local",
        clerkFrontendApiHostname: undefined,
      });
      const request = (pathname = "/") =>
        Effect.promise(() => handler!(new Request(`t3code://app${pathname}`)));
      const page = () =>
        request().pipe(Effect.flatMap((response) => Effect.promise(() => response.text())));
      const select = (target: string) =>
        Effect.gen(function* () {
          yield* fileSystem.symlink(target, `${overrides}/next`);
          yield* fileSystem.rename(`${overrides}/next`, `${overrides}/current`);
        });
      assert.equal(yield* page(), "bundled");
      for (const [name, stamp, hasIndex] of [
        ["missing", null, true],
        ["mismatch", '{"appVersion":"1.2.3"}', true],
        ["malformed", "{", true],
        ["wrong-shape", '{"appVersion":123}', true],
        ["no-index", '{"appVersion":"1.2.3-local"}', false],
      ] as const) {
        const target = `${overrides}/${name}`;
        yield* fileSystem.makeDirectory(target);
        if (hasIndex) yield* fileSystem.writeFileString(`${target}/index.html`, name);
        if (stamp !== null)
          yield* fileSystem.writeFileString(`${target}/t3-web-override.json`, stamp);
        yield* select(target);
        assert.equal(yield* page(), "bundled", name);
        assert.equal(yield* page(), "bundled", name);
      }
      assert.equal(warnings.length, 5);
      for (const name of ["first", "second"]) {
        const target = `${overrides}/${name}`;
        yield* fileSystem.makeDirectory(`${target}/assets`, { recursive: true });
        yield* fileSystem.writeFileString(`${target}/index.html`, name);
        yield* fileSystem.writeFileString(`${target}/assets/app-12345678.js`, name);
        yield* fileSystem.writeFileString(
          `${target}/t3-web-override.json`,
          '{"appVersion":"1.2.3-local"}',
        );
        yield* fileSystem.symlink(`${directory}/secret.txt`, `${target}/escape.txt`);
        yield* select(target);
        const response = yield* request();
        assert.equal(yield* Effect.promise(() => response.text()), name);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const asset = yield* request("/assets/app-12345678.js");
        assert.equal(yield* Effect.promise(() => asset.text()), name);
        assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
        for (const pathname of ["/escape.txt", "/%2e%2e%2fsecret.txt"]) {
          const refused = yield* request(pathname);
          assert.equal(refused.status, 404);
          assert.equal(refused.headers.get("cache-control"), "no-store");
        }
      }
      yield* select(`${overrides}/malformed`);
      assert.equal(yield* page(), "bundled");
      assert.equal(warnings.length, 5);
      yield* select(`${overrides}/first`);
      assert.equal(yield* page(), "first");
      yield* fileSystem.remove(`${overrides}/current`);
      assert.equal(yield* page(), "bundled");
      assert.equal(netFetchMock.mock.calls.length, 0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("proxies the stable renderer origin to the current app server", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock.mockResolvedValue(new Response("ok"));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3code-dev",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
            clerkFrontendApiHostname: "clerk.t3.codes",
          });
          assert.isDefined(handler);

          const response = yield* Effect.promise(() =>
            handler!(
              new Request("t3code-dev://app/api/health?verbose=1", {
                headers: {
                  accept: "application/json",
                  origin: "t3code-dev://app",
                  referer: "t3code-dev://app/",
                  "sec-fetch-site": "same-origin",
                },
              }),
            ),
          );
          assert.equal(yield* Effect.promise(() => response.text()), "ok");
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://clerk.t3.codes https://challenges.cloudflare.com",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "connect-src 'self' blob: http: https: ws: wss:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "img-src 'self' t3code-dev: blob: data: http: https:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "font-src 'self' t3code-dev: data:",
          );
        }),
      );

      assert.deepEqual(
        handleMock.mock.calls.map((call) => call[0]),
        ["t3code-dev"],
      );
      assert.equal(netFetchMock.mock.calls[0]?.[0], "http://127.0.0.1:3773/api/health?verbose=1");
      const forwardedHeaders = new Headers(netFetchMock.mock.calls[0]?.[1]?.headers);
      assert.equal(forwardedHeaders.get("accept"), "application/json");
      assert.isNull(forwardedHeaders.get("origin"));
      assert.isNull(forwardedHeaders.get("referer"));
      assert.isNull(forwardedHeaders.get("sec-fetch-site"));
      assert.deepEqual(unhandleMock.mock.calls, [["t3code-dev"]]);
    }).pipe(Effect.provide(layerProtocol)),
  );

  it.effect("keeps proxied paths on the configured server", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock.mockImplementation(async () => new Response("ok"));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3code-dev",
            targetOrigin: new URL("http://127.0.0.1:5733/"),
            clerkFrontendApiHostname: undefined,
          });
          yield* Effect.promise(() =>
            handler!(new Request("t3code-dev://app//example.com/src/main.tsx?t=1")),
          );
          yield* Effect.promise(() => handler!(new Request("t3code-dev://app/\\example.com/")));
        }),
      );

      assert.deepEqual(
        netFetchMock.mock.calls.map((call) => call[0]),
        [
          "http://127.0.0.1:5733//example.com/src/main.tsx?t=1",
          "http://127.0.0.1:5733//example.com/",
        ],
      );
    }).pipe(Effect.provide(layerProtocol)),
  );

  it.effect("rejects custom protocol requests for another host", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3code",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
            clerkFrontendApiHostname: undefined,
          });
          return yield* Effect.promise(() => handler!(new Request("t3code://other/")));
        }),
      );

      assert.equal(response.status, 404);
      assert.equal(netFetchMock.mock.calls.length, 0);
    }).pipe(Effect.provide(layerProtocol)),
  );
});
