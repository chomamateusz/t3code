// @effect-diagnostics nodeBuiltinImport:off - the test runs a real TLS h2 server to see how Origin's client connects.
import * as NodeHttp2 from "node:http2";
import type * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as Undici from "undici";
import { afterAll, afterEach, beforeAll, describe, expect } from "vite-plus/test";

import { httpClientLayer } from "./OriginCli.ts";

// Non-secret, self-signed 127.0.0.1 certificate, valid until 2126; ALPN h2 requires TLS.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3EwCztQysKTvzdcR
g0LWq+axzUd4tHi9PyMdqh7PlGShRANCAARfQpoLgv/tOsHWCLriDza7Ruaey2b7
mR/nS6mLu6W7+agkEqDm0mE3F/ngpPjL4Jj0IGadeMcKNKFRSBgiLdfn
-----END PRIVATE KEY-----
`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBsDCCAVagAwIBAgIUWbn2Wt5kTxii1UU57NJMt/wTaUgwCgYIKoZIzj0EAwIw
JDEiMCAGA1UEAwwZdDNjb2RlIG91dGJvdW5kIGh0dHAgdGVzdDAgFw0yNjEwMTEy
MjQyMzZaGA8yMTI2MDkxNzIyNDIzNlowJDEiMCAGA1UEAwwZdDNjb2RlIG91dGJv
dW5kIGh0dHAgdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABF9CmguC/+06
wdYIuuIPNrtG5p7LZvuZH+dLqYu7pbv5qCQSoObSYTcX+eCk+MvgmPQgZp14xwo0
oVFIGCIt1+ejZDBiMB0GA1UdDgQWBBSsekAc30Q/zdIE/tvVDQKJL5oiCDAfBgNV
HSMEGDAWgBSsekAc30Q/zdIE/tvVDQKJL5oiCDAPBgNVHRMBAf8EBTADAQH/MA8G
A1UdEQQIMAaHBH8AAAEwCgYIKoZIzj0EAwIDSAAwRQIgebUrkyP56242EJB7nCV7
A+Ke/q0rNPya3fjQa9O5B+kCIQC1SfmdNaFcNJ4JINlus4FfrRnfKiADS2MIJR9f
99BN0A==
-----END CERTIFICATE-----
`;

const server = NodeHttp2.createSecureServer(
  { allowHTTP1: true, key: TEST_KEY, cert: TEST_CERT },
  (request, response) => response.end(request.httpVersion),
);
let connections = 0;
server.on("secureConnection", () => connections++);
let origin = "";
const defaultCaCertificates = NodeTls.getCACertificates("default");
const defaultDispatcher = Undici.getGlobalDispatcher();

beforeAll(async () => {
  NodeTls.setDefaultCACertificates([...defaultCaCertificates, TEST_CERT]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}/`;
});

afterEach(() => {
  Undici.setGlobalDispatcher(defaultDispatcher);
});

afterAll(async () => {
  NodeTls.setDefaultCACertificates(defaultCaCertificates);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("httpClientLayer", () => {
  it.effect(
    "multiplexes requests over one HTTP/2 connection when the server pins fetch to HTTP/1.1",
    () =>
      Effect.gen(function* () {
        Undici.setGlobalDispatcher(new Undici.Agent({ allowH2: false }));

        const versions = yield* Effect.all(
          Array.from({ length: 3 }, () =>
            HttpClient.get(origin).pipe(Effect.flatMap((response) => response.text)),
          ),
          { concurrency: "unbounded" },
        ).pipe(Effect.provide(httpClientLayer));

        expect(versions).toEqual(["2.0", "2.0", "2.0"]);
        expect(connections).toBe(1);
      }),
  );
});
