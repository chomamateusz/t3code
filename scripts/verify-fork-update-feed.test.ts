// @effect-diagnostics nodeBuiltinImport:off - Packaged archive verification uses asar's synchronous filesystem API.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { createPackage } from "@electron/asar";
import { expect, it } from "vite-plus/test";

import { verifyForkUpdateFeed } from "./verify-fork-update-feed.ts";

it.each([
  ["chomamateusz", "chomamateusz/t3code", true],
  ["pingdotgg", "chomamateusz/t3code", false],
  ["chomamateusz", "pingdotgg/t3code", false],
  ["chomamateusz", undefined, false],
] as const)(
  "checks the packaged feed owner %s and baked allowlist %s",
  async (owner, allowed, valid) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-fork-feed-"));
    try {
      const app = NodePath.join(root, "app");
      await NodeFSP.mkdir(app);
      await NodeFSP.writeFile(
        NodePath.join(app, "package.json"),
        JSON.stringify({ t3codeAllowedUpdateRepository: allowed }),
      );
      await createPackage(app, NodePath.join(root, "app.asar"));
      await NodeFSP.writeFile(
        NodePath.join(root, "app-update.yml"),
        `provider: github\nowner: ${owner}\nrepo: t3code\n`,
      );
      if (valid) expect(() => verifyForkUpdateFeed(root)).not.toThrow();
      else expect(() => verifyForkUpdateFeed(root)).toThrow();
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
