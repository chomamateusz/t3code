// @effect-diagnostics nodeBuiltinImport:off - Packaged archive verification uses asar's synchronous filesystem API.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { extractFile } from "@electron/asar";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Schema from "effect/Schema";

const decodeFeed = Schema.decodeUnknownSync(
  fromYaml(
    Schema.Struct({
      provider: Schema.Literal("github"),
      owner: Schema.Literal("chomamateusz"),
      repo: Schema.Literal("t3code"),
    }),
  ),
);
const decodePackage = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      t3codeAllowedUpdateRepository: Schema.Literal("chomamateusz/t3code"),
    }),
  ),
);

export function verifyForkUpdateFeed(resourcesPath: string): void {
  decodeFeed(NodeFS.readFileSync(NodePath.join(resourcesPath, "app-update.yml"), "utf8"));
  decodePackage(
    extractFile(NodePath.join(resourcesPath, "app.asar"), "package.json").toString("utf8"),
  );
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) throw new Error("Expected at least one packaged resources directory.");
  for (const path of paths) verifyForkUpdateFeed(path);
}
