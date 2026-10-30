import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNewThreadTargetCatalog,
  newThreadTargetTooltip,
  buildNewThreadProjectActivity,
  resolveNewThreadTarget,
  type NewThreadTargetInput,
} from "./newThreadTarget";
import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";
import type { Project } from "./types";

const mac = EnvironmentId.make("mac");
const linux = EnvironmentId.make("linux");
const remote = EnvironmentId.make("remote");
const offline = EnvironmentId.make("offline");

function project(id: string, environmentId: EnvironmentId, repository: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: repository,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: {
      canonicalKey: `github.com/example/${repository}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://github.com/example/${repository}.git`,
      },
    },
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

function input(overrides: Partial<NewThreadTargetInput> = {}): NewThreadTargetInput {
  return {
    groups: buildSidebarProjectSnapshots({
      projects: [
        project("print-remote", remote, "print3d"),
        project("print-offline", offline, "print3d"),
        project("print-linux", linux, "print3d"),
        project("print-mac", mac, "print3d"),
        project("app-mac", mac, "app"),
        project("down-offline", offline, "down"),
      ],
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: mac,
      resolveEnvironmentLabel: () => null,
    }),
    environments: [
      { environmentId: remote, label: "Remote", online: true },
      { environmentId: offline, label: "Offline", online: false },
      { environmentId: linux, label: "Linux", online: true },
      { environmentId: mac, label: "MacBook Pro", online: true },
    ],
    selection: { include: [], exclude: [] },
    environmentScopeKeys: [],
    primaryEnvironmentId: mac,
    projectActivity: new Map([["linux:print-linux", Date.parse("2026-10-30T12:00:00Z")]]),
    ...overrides,
  };
}

const printKey = "github.com/example/print3d";
const appKey = "github.com/example/app";
const downKey = "github.com/example/down";

describe("new thread targets", () => {
  it("uses each project's latest thread update or creation, without a visit watermark", () => {
    const activity = buildNewThreadProjectActivity([
      {
        environmentId: remote,
        projectId: "print-remote",
        updatedAt: "2026-10-30T14:00:00Z",
        createdAt: "2026-10-30T09:00:00Z",
      },
      {
        environmentId: remote,
        projectId: "print-remote",
        updatedAt: "2026-10-30T11:00:00Z",
        createdAt: "2026-10-30T10:00:00Z",
      },
      {
        environmentId: linux,
        projectId: "print-linux",
        updatedAt: "invalid-date",
        createdAt: "2026-10-30T12:00:00Z",
      },
    ]);
    expect([...activity]).toEqual([
      ["remote:print-remote", Date.parse("2026-10-30T14:00:00Z")],
      ["linux:print-linux", Date.parse("2026-10-30T12:00:00Z")],
    ]);
    expect(buildNewThreadProjectActivity([]).size).toBe(0);
  });

  it.each([
    { name: "no filter", overrides: {}, kind: "full" },
    {
      name: "archived saved selection is inactive",
      overrides: {
        groups: input().groups.map((group) => ({
          ...group,
          archived: group.projectKey === appKey,
        })),
        selection: { include: [appKey], exclude: [] },
      },
      kind: "full",
    },
    {
      name: "one open project beside archived selections",
      overrides: {
        groups: input().groups.map((group) => ({
          ...group,
          archived: group.projectKey !== appKey,
        })),
        selection: { include: [printKey, appKey], exclude: [] },
      },
      kind: "direct",
    },
    {
      name: "only archived projects on the selected machine",
      overrides: {
        groups: input().groups.map((group) => ({ ...group, archived: true })),
        environmentScopeKeys: [mac],
      },
      kind: "unreachable-note",
    },
    {
      name: "one reachable member",
      overrides: { selection: { include: [appKey], exclude: [] } },
      kind: "direct",
    },
    {
      name: "one project on several machines",
      overrides: { selection: { include: [printKey], exclude: [] } },
      kind: "restricted",
    },
    {
      name: "several included projects",
      overrides: { selection: { include: [printKey, appKey], exclude: [] } },
      kind: "restricted",
    },
    {
      name: "several projects after exclusions",
      overrides: { selection: { include: [], exclude: [downKey] } },
      kind: "restricted",
    },
    {
      name: "everything offline",
      overrides: { selection: { include: [downKey], exclude: [] } },
      kind: "unreachable-note",
    },
    {
      name: "everything filtered out",
      overrides: { selection: { include: [], exclude: [printKey, appKey, downKey] } },
      kind: "unreachable-note",
    },
    {
      name: "include and exclude intersect",
      overrides: { selection: { include: [printKey, appKey], exclude: [printKey] } },
      kind: "direct",
    },
    {
      name: "exclude wins over include",
      overrides: { selection: { include: [appKey], exclude: [appKey] } },
      kind: "unreachable-note",
    },
    {
      name: "unknown machine with no project filter",
      overrides: { environmentScopeKeys: ["removed"] },
      kind: "full",
    },
    {
      name: "unknown machine with a project filter",
      overrides: {
        environmentScopeKeys: ["removed"],
        selection: { include: [printKey], exclude: [] },
      },
      kind: "restricted",
    },
    {
      name: "all machines selected is unfiltered",
      overrides: { environmentScopeKeys: [remote, offline, linux, mac] },
      kind: "full",
    },
    {
      name: "single known machine ignores saved scope",
      overrides: {
        environmentScopeKeys: [mac],
        environments: [{ environmentId: mac, label: "MacBook Pro", online: true }],
      },
      kind: "full",
    },
    {
      name: "machine and project scope",
      overrides: { environmentScopeKeys: [mac], selection: { include: [printKey], exclude: [] } },
      kind: "direct",
    },
    {
      name: "empty Hide mode",
      overrides: { selection: { include: [], exclude: [] }, sidebarProjectFilterMode: "exclude" },
      kind: "full",
    },
    {
      name: "empty Show only mode",
      overrides: { selection: { include: [], exclude: [] }, sidebarProjectFilterMode: "include" },
      kind: "full",
    },
  ])("resolves $name to $kind", ({ overrides, kind }) => {
    const target = resolveNewThreadTarget(input(overrides));
    expect(target.kind).toBe(kind);
    if (target.kind === "unreachable-note") {
      expect(target.note).toBe("No project in the current filter is reachable");
    }
  });

  it("orders machines by this machine, project thread activity, then offline", () => {
    const target = resolveNewThreadTarget(
      input({ selection: { include: [printKey], exclude: [] } }),
    );
    expect(target.kind).toBe("restricted");
    if (target.kind !== "restricted") return;
    expect(target.title).toBe("print3d — which machine?");
    expect(target.members.map((member) => [member.environmentId, member.online])).toEqual([
      [mac, true],
      [linux, true],
      [remote, true],
      [offline, false],
    ]);
    const activityInput = {
      selection: { include: [printKey], exclude: [] },
      projectActivity: new Map([
        ["remote:print-remote", Date.parse("2026-10-30T14:00:00Z")],
        ["linux:print-linux", Date.parse("2026-10-30T12:00:00Z")],
        ["linux:unrelated-project", Date.parse("2026-10-30T16:00:00Z")],
        ["offline:print-offline", Date.parse("2026-10-30T18:00:00Z")],
      ]),
    };
    const byActivity = resolveNewThreadTarget(input(activityInput));
    expect(byActivity.kind).toBe("restricted");
    if (byActivity.kind !== "restricted") return;
    expect(byActivity.members.map((member) => member.environmentId)).toEqual([
      mac,
      remote,
      linux,
      offline,
    ]);
    expect(newThreadTargetTooltip(target)).toBe(
      "New thread — choose machine for print3d\n⌥-click: all projects",
    );
  });

  it("offers reachable siblings of the single scoped offline member without picking one", () => {
    const target = resolveNewThreadTarget(
      input({ environmentScopeKeys: [offline], selection: { include: [printKey], exclude: [] } }),
    );
    expect(target.kind).toBe("restricted");
    if (target.kind !== "restricted") return;
    expect(target.members.map((member) => member.environmentId)).toEqual([
      mac,
      linux,
      remote,
      offline,
    ]);
    expect(target.members.at(-1)?.online).toBe(false);

    const onlyOneOnline = input({
      environmentScopeKeys: [offline],
      selection: { include: [printKey], exclude: [] },
      environments: input().environments.map((environment) => ({
        ...environment,
        online: environment.environmentId === linux,
      })),
    });
    expect(resolveNewThreadTarget(onlyOneOnline).kind).toBe("restricted");
    expect(resolveNewThreadTarget({ ...onlyOneOnline, environmentScopeKeys: [] })).toMatchObject({
      kind: "direct",
      member: { id: "print-linux", environmentId: linux },
    });
  });

  it.each([[mac], [mac, linux]])(
    "never blindly picks between two clones on one machine (%j)",
    (...keys) => {
      const target = resolveNewThreadTarget(
        input({
          environmentScopeKeys: keys,
          selection: { include: [printKey], exclude: [] },
          groups: buildSidebarProjectSnapshots({
            projects: [project("clone-a", mac, "print3d"), project("clone-b", mac, "print3d")],
            settings: {
              sidebarProjectGroupingMode: "repository",
              sidebarProjectGroupingOverrides: {},
            },
            primaryEnvironmentId: mac,
            resolveEnvironmentLabel: () => null,
          }),
        }),
      );
      expect(target.kind).toBe("restricted");
      if (target.kind !== "restricted") return;
      expect(target.members.map((member) => [member.id, member.workspaceRoot])).toEqual([
        ["clone-a", "/work/clone-a"],
        ["clone-b", "/work/clone-b"],
      ]);
      expect(target.title).toBe("New thread in print3d");
    },
  );

  it("ignores sidebar search and captures a target independently of later selection changes", () => {
    const selection = { include: [printKey], exclude: [] };
    const initial = input({ selection });
    const withSearch = { ...initial, searchQuery: "no matching threads" };
    const before = resolveNewThreadTarget(initial);
    expect(resolveNewThreadTarget(withSearch)).toEqual(before);
    selection.include = [appKey];
    expect(resolveNewThreadTarget(initial)).toMatchObject({
      kind: "direct",
      member: { environmentId: mac, id: "app-mac" },
    });
    expect(before.kind).toBe("restricted");
    if (before.kind !== "restricted") return;
    expect(before.members.every((member) => member.projectKey === printKey)).toBe(true);
  });

  it("keeps the full catalog, with filtered targets first and offline entries last", () => {
    const catalog = buildNewThreadTargetCatalog(
      input({ selection: { include: [appKey], exclude: [] } }),
    );
    expect(catalog.map((member) => member.id)).toEqual([
      "app-mac",
      "print-mac",
      "print-linux",
      "print-remote",
      "print-offline",
      "down-offline",
    ]);
    expect(
      buildNewThreadTargetCatalog(
        input({ environmentScopeKeys: [linux], selection: { include: [printKey], exclude: [] } }),
      )[0],
    ).toMatchObject({ environmentId: linux, id: "print-linux" });
    const archivedInput = input({
      groups: input().groups.map((group) => ({
        ...group,
        archived: group.projectKey === printKey,
      })),
      selection: { include: [printKey], exclude: [] },
    });
    expect(buildNewThreadTargetCatalog(archivedInput).map((member) => member.id)).toEqual([
      "app-mac",
      "down-offline",
    ]);
    expect(
      buildNewThreadTargetCatalog({
        ...archivedInput,
        groups: archivedInput.groups.map((group) => ({ ...group, archived: true })),
      }),
    ).toEqual([]);
    expect(
      buildNewThreadTargetCatalog(
        input({
          groups: input().groups.map((group) => ({
            ...group,
            pinned: group.projectKey === appKey,
          })),
          projectActivity: new Map([["mac:print-mac", 100]]),
        }),
      )[0],
    ).toMatchObject({ id: "app-mac" });
    const mixedInput = input({
      groups: input().groups.map((group) => ({
        ...group,
        memberProjects: group.memberProjects.map((member) => ({
          ...member,
          archivedAt: member.id === "print-mac" ? "2026-11-03T00:00:00Z" : null,
        })),
      })),
      environmentScopeKeys: [mac],
      selection: { include: [printKey], exclude: [] },
    });
    expect(
      buildNewThreadTargetCatalog(mixedInput).some((member) => member.id === "print-mac"),
    ).toBe(false);
    expect(resolveNewThreadTarget(mixedInput)).toMatchObject({
      kind: "direct",
      member: { id: "app-mac", environmentId: mac },
    });
    expect(
      resolveNewThreadTarget({ ...mixedInput, selection: { include: [], exclude: [printKey] } }),
    ).toMatchObject({ kind: "direct", member: { id: "app-mac", environmentId: mac } });
    expect(resolveNewThreadTarget({ ...mixedInput, environmentScopeKeys: [linux] })).toMatchObject({
      kind: "direct",
      member: { id: "print-linux", environmentId: linux },
    });
    const mixedMachinesInput = {
      ...mixedInput,
      environmentScopeKeys: [mac, offline],
      groups: mixedInput.groups.map((group) => ({
        ...group,
        memberProjects: group.memberProjects.map((member) => ({
          ...member,
          archivedAt: member.id === "print-offline" ? "2026-11-03T00:00:00Z" : member.archivedAt,
        })),
      })),
    };
    expect(resolveNewThreadTarget(mixedMachinesInput).kind).toBe("unreachable-note");
    expect(
      resolveNewThreadTarget({ ...mixedMachinesInput, environmentScopeKeys: [mac, linux] }),
    ).toMatchObject({ kind: "direct", member: { id: "print-linux", environmentId: linux } });
  });

  it.each([
    {
      name: "online sibling ahead of the last-used offline machine",
      keys: [offline, linux],
      activity: new Map([
        ["offline:print-offline", 20],
        ["linux:print-linux", 10],
      ]),
      expected: linux,
    },
    {
      name: "latest activity ahead of the primary machine",
      keys: [mac, linux],
      activity: new Map([["linux:print-linux", 10]]),
      expected: linux,
    },
    {
      name: "catalog order without activity, regardless of selection order",
      keys: [linux, mac],
      activity: new Map<string, number>(),
      expected: mac,
    },
    {
      name: "first non-primary catalog machine without activity",
      keys: [linux, remote],
      activity: new Map<string, number>(),
      expected: remote,
    },
    {
      name: "activity on unselected machines is ignored",
      keys: [linux, remote],
      activity: new Map([
        ["mac:print-mac", 20],
        ["linux:print-linux", 10],
      ]),
      expected: linux,
    },
    {
      name: "activity in another project is ignored",
      keys: [mac, linux],
      activity: new Map([
        ["mac:app-mac", 20],
        ["linux:print-linux", 10],
      ]),
      expected: linux,
    },
  ])("chooses $name for multiple selected machines", ({ keys, activity, expected }) => {
    const target = resolveNewThreadTarget(
      input({
        environmentScopeKeys: keys,
        selection: { include: [printKey], exclude: [] },
        projectActivity: activity,
      }),
    );
    expect(target).toMatchObject({ kind: "direct", member: { environmentId: expected } });
    if (target.kind !== "direct") return;
    expect(newThreadTargetTooltip(target)).toBe(
      `New thread in print3d · ${target.member.environmentLabel}\n⌥-click: all projects`,
    );
  });

  it("describes direct creation with its exact project, machine and shortcut", () => {
    const target = resolveNewThreadTarget(
      input({ environmentScopeKeys: [mac], selection: { include: [printKey], exclude: [] } }),
    );
    expect(target).toMatchObject({
      kind: "direct",
      member: { id: "print-mac", environmentId: mac },
    });
    expect(newThreadTargetTooltip(target, "⌘N")).toBe(
      "New thread in print3d · MacBook Pro (⌘N)\n⌥-click: all projects",
    );
    expect(
      newThreadTargetTooltip({
        kind: "unreachable-note",
        note: "No project in the current filter is reachable",
      }),
    ).toBe("New thread…");
    expect(newThreadTargetTooltip({ kind: "full" })).toBe("New thread…");
  });
});
