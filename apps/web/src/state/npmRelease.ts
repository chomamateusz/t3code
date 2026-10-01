import { type ServerConfig, ServerNpmReleaseError } from "@t3tools/contracts";
import { newestCliReleaseVersion } from "@t3tools/shared/cliRelease";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { environmentSummaries } from "./presentation";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

const isServerNpmReleaseError = Schema.is(ServerNpmReleaseError);

function unsupportedLookup(config: ServerConfig | null): ServerNpmReleaseError | null {
  if (config === null) {
    return new ServerNpmReleaseError({ reason: "Connect to this server to check releases." });
  }
  return config.environment.capabilities.npmReleaseLookup === true
    ? null
    : new ServerNpmReleaseError({
        reason: "This server does not support registry lookups. Update it before switching tracks.",
      });
}

export function npmReleaseFailureMessage(cause: Cause.Cause<unknown>): string {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return isServerNpmReleaseError(error)
    ? error.message
    : import.meta.env.T3CODE_RELEASE_REPOSITORY?.trim()
      ? "Could not check this build's configured release repository. Check the connection and try again."
      : "Could not check this environment's npm registry. Check the connection and registry settings.";
}

const ForkRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  prerelease: Schema.optional(Schema.Boolean),
});

const forkRelease = Effect.fn("updates.forkRelease")(function* (repository: string, spec: string) {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(repository)) return null;
  if (spec !== "latest" && spec !== "nightly" && spec !== "preview") {
    const response = yield* HttpClient.get(
      `https://api.github.com/repos/${repository}/releases/tags/v${encodeURIComponent(spec)}`,
    );
    if (response.status === 404) return null;
    const release = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ForkRelease)),
    );
    return !release.draft && release.tag_name === `v${spec}`
      ? { version: spec, databaseMigration: undefined }
      : null;
  }
  for (let page = 1; page <= 10; page += 1) {
    const response = yield* HttpClient.get(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
    );
    if (response.status === 404) return null;
    const releases = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(ForkRelease))),
    );
    const version = newestCliReleaseVersion(
      spec === "latest" ? releases.filter((release) => !release.prerelease) : releases,
      spec === "latest" ? "stable" : spec,
    );
    if (version !== undefined) return { version, databaseMigration: undefined };
    if (releases.length < 100) return null;
  }
  return null;
});

export const npmReleaseAtom = Atom.family((spec: string) =>
  Atom.make((get) => {
    const repository = import.meta.env.T3CODE_RELEASE_REPOSITORY?.trim().toLowerCase();
    if (repository) {
      return forkRelease(repository, spec).pipe(
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.provide(FetchHttpClient.layer),
      );
    }
    const primary = get(primaryEnvironmentIdAtom);
    // With the desktop's local server turned off there is no primary, so a connected server answers.
    const candidates =
      primary === null ? get(environmentSummaries.connectedEnvironmentIdsAtom) : [primary];
    const environmentId =
      candidates.find(
        (id) => unsupportedLookup(get(serverEnvironment.configValueAtom(id))) === null,
      ) ?? candidates[0];
    if (environmentId === undefined) {
      return Effect.fail(
        new ServerNpmReleaseError({ reason: "Connect to a server to check releases." }),
      );
    }
    const unsupported = unsupportedLookup(get(serverEnvironment.configValueAtom(environmentId)));
    if (unsupported !== null) return Effect.fail(unsupported);
    return get
      .result(serverEnvironment.npmRelease({ environmentId, input: { spec } }))
      .pipe(
        Effect.map((release) =>
          release === null
            ? null
            : { version: release.version, databaseMigration: release.databaseMigration },
        ),
      );
  }).pipe(Atom.withLabel(`npm-release:${spec}`)),
);
