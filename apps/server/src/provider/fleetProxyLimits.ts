import type { ClaudeSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as ProcessRunner from "../processRunner.ts";
import { readClaudeApiSettings } from "./Drivers/ClaudeSkills.ts";

const OptionalString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalList = Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown)));

const decodeLimits = Schema.decodeUnknownOption(
  Schema.Struct({ credentials: OptionalList, exclusions: OptionalList }),
);
const decodeCredential = Schema.decodeUnknownOption(
  Schema.Struct({
    label: OptionalString,
    provider: OptionalString,
    state: OptionalString,
    bars: OptionalList,
    cooldowns: OptionalList,
  }),
);
const decodeBar = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    status: OptionalString,
    resets_at: OptionalString,
    reset_passed: Schema.optional(Schema.NullOr(Schema.Boolean)),
  }),
);
const decodeCooldown = Schema.decodeUnknownOption(
  Schema.Struct({ scope: OptionalString, model: OptionalString, until: OptionalString }),
);
const decodeExclusion = Schema.decodeUnknownOption(
  Schema.Struct({ pattern: Schema.String, provider: OptionalString, until: OptionalString }),
);

const decodeEach = <A>(
  values: ReadonlyArray<unknown> | null | undefined,
  decode: (value: unknown) => Option.Option<A>,
): ReadonlyArray<A> => (values ?? []).flatMap((value) => Option.toArray(decode(value)));

const futureMs = (iso: string | null | undefined, nowMs: number): number | undefined => {
  const ms = iso == null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) && ms > nowMs ? ms : undefined;
};

const barAppliesToModel = (barId: string, model: string): boolean =>
  barId === "session_5h" ||
  barId === "weekly_all" ||
  barId.startsWith("window_") ||
  (barId === "weekly_fable" && model.includes("fable"));

const globMatches = (pattern: string, value: string): boolean =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(value);

export interface FleetProxyUsableAt {
  readonly resetAt: string;
  readonly label: string | null;
}

export function fleetProxyUsableAt(
  limits: unknown,
  input: { readonly model: string; readonly nowMs: number },
): FleetProxyUsableAt | null {
  const decoded = decodeLimits(limits);
  if (Option.isNone(decoded)) return null;
  const credentials = decodeEach(decoded.value.credentials, decodeCredential).filter(
    (credential) =>
      credential.provider === "claude" &&
      credential.state !== "disabled" &&
      credential.state !== "error",
  );
  if (credentials.length === 0) return null;

  let earliest: { readonly ms: number; readonly label: string | null } | undefined;
  for (const credential of credentials) {
    const cooldownUntil = decodeEach(credential.cooldowns, decodeCooldown)
      .filter((cooldown) => cooldown.scope === "credential" || cooldown.model === input.model)
      .map((cooldown) => futureMs(cooldown.until, input.nowMs));
    const barResets = decodeEach(credential.bars, decodeBar)
      .filter(
        (bar) =>
          bar.status === "rejected" &&
          bar.reset_passed !== true &&
          barAppliesToModel(bar.id, input.model),
      )
      .map((bar) => futureMs(bar.resets_at, input.nowMs));
    const blocks = [...cooldownUntil, ...barResets].filter((ms) => ms !== undefined);
    if (blocks.length === 0) return null;
    const blockedUntilMs = Math.max(...blocks);
    if (earliest === undefined || blockedUntilMs < earliest.ms) {
      earliest = { ms: blockedUntilMs, label: credential.label ?? null };
    }
  }
  if (earliest === undefined) return null;

  const exclusions = decodeEach(decoded.value.exclusions, decodeExclusion).filter(
    (exclusion) =>
      (exclusion.provider == null || exclusion.provider === "claude") &&
      globMatches(exclusion.pattern, input.model),
  );
  if (exclusions.some((exclusion) => exclusion.until == null)) return null;
  const exclusionUntil = exclusions
    .map((exclusion) => futureMs(exclusion.until, input.nowMs))
    .filter((ms) => ms !== undefined);
  const resetMs = Math.max(earliest.ms, ...exclusionUntil);
  return { resetAt: DateTime.formatIso(DateTime.makeUnsafe(resetMs)), label: earliest.label };
}

const HELPER_TIMEOUT = "5 seconds";
const HELPER_MAX_OUTPUT_BYTES = 4 * 1024;
const REQUEST_TIMEOUT = "4 seconds";
const OVERALL_TIMEOUT = "6 seconds";

const logResetAt = (model: string, outcome: Record<string, unknown>) =>
  Effect.logDebug("fleet-proxy.limits.reset-at", { model, ...outcome });

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const runApiKeyHelper = Effect.fn("runFleetProxyApiKeyHelper")(function* (
  command: string,
  cwd: string | undefined,
  environment: NodeJS.ProcessEnv,
) {
  if ((yield* HostProcess.Platform) === "win32") return undefined;
  const runner = yield* ProcessRunner.make();
  const output = yield* runner.run({
    command: "/bin/sh",
    args: ["-c", command],
    cwd,
    env: environment,
    timeout: HELPER_TIMEOUT,
    maxOutputBytes: HELPER_MAX_OUTPUT_BYTES,
  });
  return output.code === 0 ? nonEmpty(output.stdout) : undefined;
});

const fetchFleetLimits = Effect.fn("fetchFleetProxyLimits")(function* (baseUrl: URL, key: string) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(
      HttpClientRequest.get(new URL("v1/fleet/limits", baseUrl)).pipe(
        HttpClientRequest.bearerToken(key),
        HttpClientRequest.acceptJson,
      ),
    )
    .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));
  if (response.status !== 200) return { status: response.status } as const;
  return { status: 200, body: yield* response.json } as const;
});

const parseBaseUrl = (value: string | undefined): URL | undefined => {
  const base = URL.parse(value?.trim() ?? "");
  if (base === null || (base.protocol !== "http:" && base.protocol !== "https:")) return undefined;
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  return base;
};

export const resolveFleetProxyResetAt = Effect.fn("resolveFleetProxyResetAt")(
  function* (input: {
    readonly model: string;
    readonly settings: Pick<ClaudeSettings, "homePath">;
    readonly cwd: string | undefined;
    readonly environment: NodeJS.ProcessEnv;
    readonly now: DateTime.Utc;
  }) {
    const logOutcome = (outcome: Record<string, unknown>) => logResetAt(input.model, outcome);
    const settings = yield* readClaudeApiSettings(input.settings, input.cwd, input.environment);
    const baseUrl = parseBaseUrl(
      settings.env.ANTHROPIC_BASE_URL ?? input.environment.ANTHROPIC_BASE_URL,
    );
    if (baseUrl === undefined) {
      yield* logOutcome({ resetAt: null, reason: "no-base-url" });
      return null;
    }
    const helper = nonEmpty(settings.apiKeyHelper);
    const key =
      nonEmpty(input.environment.ANTHROPIC_AUTH_TOKEN) ??
      nonEmpty(input.environment.ANTHROPIC_API_KEY) ??
      (helper === undefined
        ? undefined
        : yield* runApiKeyHelper(helper, input.cwd, input.environment).pipe(
            Effect.orElseSucceed(() => undefined),
          ));
    if (key === undefined) {
      yield* logOutcome({ resetAt: null, reason: "no-key" });
      return null;
    }
    const response = yield* fetchFleetLimits(baseUrl, key).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.orElseSucceed(() => undefined),
    );
    if (response === undefined || response.status !== 200) {
      yield* logOutcome({
        resetAt: null,
        reason: response === undefined ? "request-failed" : `http-${response.status}`,
      });
      return null;
    }
    const usable = fleetProxyUsableAt(response.body, {
      model: input.model,
      nowMs: DateTime.toEpochMillis(input.now),
    });
    yield* logOutcome(
      usable === null
        ? { resetAt: null, reason: "usable-or-unknown" }
        : { resetAt: usable.resetAt, label: usable.label },
    );
    return usable?.resetAt ?? null;
  },
  (effect, input) =>
    effect.pipe(
      Effect.timeout(OVERALL_TIMEOUT),
      Effect.catch((error) =>
        logResetAt(input.model, {
          resetAt: null,
          reason: Cause.isTimeoutError(error) ? "timeout" : "failed",
        }).pipe(Effect.as(null)),
      ),
      Effect.catchDefect(() =>
        logResetAt(input.model, { resetAt: null, reason: "defect" }).pipe(Effect.as(null)),
      ),
    ),
);
