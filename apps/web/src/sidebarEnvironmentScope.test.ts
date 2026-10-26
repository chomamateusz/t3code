import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { getProjectFaviconResourceKey } from "@t3tools/shared/projectFavicon";
import { describe, expect, it } from "vite-plus/test";

import { filterSidebarV2VisibleThreads, isInSidebarScope } from "./components/Sidebar.logic";
import {
  buildSidebarEnvironmentScopeItems,
  filterSidebarEnvironmentIds,
  filterSidebarProjectScopeKeysToEnvironment,
  projectGroupHasEnvironment,
  normalizeSidebarEnvironmentScopeKeys,
  nextSidebarEnvironmentScopeKeys,
  resolveSidebarEnvironmentScope,
  scopeSidebarProjectGroupsToEnvironment,
  sidebarEmptyThreadsLabel,
} from "./sidebarEnvironmentScope";
import {
  buildSidebarProjectSnapshots,
  getSidebarProjectSettingsKey,
} from "./sidebarProjectGrouping";
import { makeThreadFixture } from "./test-fixtures";
import type { Project } from "./types";

const macbookId = EnvironmentId.make("env-macbook");
const remoteMacId = EnvironmentId.make("env-remote-mac");
const linuxId = EnvironmentId.make("env-linux");
const environments = [
  { environmentId: remoteMacId, label: "Remote Mac" },
  { environmentId: macbookId, label: "MacBook" },
  { environmentId: linuxId, label: "Linux box" },
];

const sharedRepository = {
  canonicalKey: "github.com/example/shared",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/example/shared.git",
  },
};

function makeProject(overrides: Partial<Project> & Pick<Project, "id" | "environmentId">): Project {
  return {
    title: overrides.id,
    workspaceRoot: `/work/${overrides.id}`,
    repositoryIdentity: null,
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

const sharedOnMacbook = makeProject({
  id: ProjectId.make("shared-macbook"),
  environmentId: macbookId,
  title: "shared",
  repositoryIdentity: sharedRepository,
});
const sharedOnRemoteMac = makeProject({
  id: ProjectId.make("shared-remote"),
  environmentId: remoteMacId,
  title: "shared",
  repositoryIdentity: sharedRepository,
});
const macbookOnly = makeProject({ id: ProjectId.make("macbook-only"), environmentId: macbookId });
const linuxOnly = makeProject({ id: ProjectId.make("linux-only"), environmentId: linuxId });

const projectGroups = buildSidebarProjectSnapshots({
  projects: [sharedOnMacbook, sharedOnRemoteMac, macbookOnly, linuxOnly],
  settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
  primaryEnvironmentId: macbookId,
  resolveEnvironmentLabel: () => null,
});
const groupingInput = {
  projects: [sharedOnMacbook, sharedOnRemoteMac, macbookOnly, linuxOnly],
  settings: {
    sidebarProjectGroupingMode: "repository" as const,
    sidebarProjectGroupingOverrides: {},
  },
  primaryEnvironmentId: macbookId,
};
const sharedGroup = projectGroups.find((group) => group.displayName === "shared")!;

function threadOn(project: Project, id: string) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: project.environmentId,
    projectId: project.id,
  });
}

const threads = [
  threadOn(sharedOnMacbook, "shared-on-macbook"),
  threadOn(sharedOnRemoteMac, "shared-on-remote"),
  threadOn(macbookOnly, "macbook-only"),
  threadOn(linuxOnly, "linux-only"),
];

function projectKeysOf(group: (typeof projectGroups)[number]) {
  return new Set(group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`));
}

describe("sidebar machine scope items", () => {
  it("offers no machine filter with a single environment", () => {
    expect(
      buildSidebarEnvironmentScopeItems({
        environments: [{ environmentId: macbookId, label: "MacBook" }],
        primaryEnvironmentId: macbookId,
      }),
    ).toEqual([]);
  });

  it("lists all machines first, then this machine, then the rest in catalog order", () => {
    expect(
      buildSidebarEnvironmentScopeItems({ environments, primaryEnvironmentId: macbookId }).map(
        (item) => [item.label, item.environmentId],
      ),
    ).toEqual([
      ["All machines", null],
      ["MacBook", macbookId],
      ["Remote Mac", remoteMacId],
      ["Linux box", linuxId],
    ]);
  });
});

describe("resolving the sidebar machine scope", () => {
  it.each([
    { keys: [linuxId], expected: [linuxId], normalized: [linuxId], plain: [], additive: [] },
    { keys: [], expected: [], normalized: [], plain: [linuxId], additive: [linuxId] },
    {
      keys: ["env-gone"],
      expected: [],
      normalized: ["env-gone"],
      plain: [linuxId],
      additive: ["env-gone", linuxId],
    },
    {
      keys: [linuxId, "env-gone", remoteMacId],
      expected: [remoteMacId, linuxId],
      normalized: [linuxId, "env-gone", remoteMacId],
      plain: [linuxId],
      additive: ["env-gone", remoteMacId],
    },
    {
      keys: [linuxId, remoteMacId, macbookId],
      expected: [],
      normalized: [],
      plain: [linuxId],
      additive: [remoteMacId, macbookId],
    },
    {
      keys: [remoteMacId, macbookId],
      expected: [remoteMacId, macbookId],
      normalized: [remoteMacId, macbookId],
      plain: [linuxId],
      additive: [],
    },
  ])("resolves $keys in catalog order", ({ keys, expected, normalized, plain, additive }) => {
    expect(
      resolveSidebarEnvironmentScope({ environments, keys }).map((entry) => entry.environmentId),
    ).toEqual(expected);
    expect(
      resolveSidebarEnvironmentScope({ environments: environments.slice(0, 1), keys }),
    ).toEqual([]);
    const knownIds = environments.map((entry) => entry.environmentId);
    expect(normalizeSidebarEnvironmentScopeKeys(keys, knownIds)).toEqual(normalized);
    expect(nextSidebarEnvironmentScopeKeys(keys, linuxId, false, knownIds)).toEqual(plain);
    expect(nextSidebarEnvironmentScopeKeys(keys, linuxId, true, knownIds)).toEqual(additive);
  });
});

describe("scoping project groups to a machine", () => {
  it("uses the remote scratch member for settings, project refs and the favicon source", () => {
    const local = makeProject({
      id: ProjectId.make("local-scratch"),
      environmentId: macbookId,
      workspaceRoot: "/local/scratch",
      faviconPath: "/local/icon.png",
      isScratch: true,
    });
    const remote = makeProject({
      id: ProjectId.make("remote-scratch"),
      environmentId: remoteMacId,
      workspaceRoot: "/remote/scratch",
      faviconPath: "/remote/icon.png",
      isScratch: true,
    });
    const input = {
      projects: [local, remote],
      settings: {
        sidebarProjectGroupingMode: "repository" as const,
        sidebarProjectGroupingOverrides: {},
      },
      primaryEnvironmentId: macbookId,
      resolveEnvironmentLabel: (environmentId: EnvironmentId) =>
        environments.find((environment) => environment.environmentId === environmentId)?.label ??
        null,
    };
    const groups = buildSidebarProjectSnapshots({ ...input, groupScratchProjects: true });
    expect(groups).toHaveLength(1);

    const scoped = scopeSidebarProjectGroupsToEnvironment(groups, new Set([remoteMacId]), input);
    expect(scoped).toHaveLength(1);
    const group = scoped[0]!;
    const remoteSettingsGroup = buildSidebarProjectSnapshots({ ...input, projects: [remote] })[0]!;
    expect(getSidebarProjectSettingsKey(group, input.settings, input.projects)).toBe(
      remoteSettingsGroup.projectKey,
    );
    expect(group.memberProjectRefs).toEqual([{ environmentId: remoteMacId, projectId: remote.id }]);
    expect(group).toMatchObject({ environmentId: remoteMacId, id: remote.id });
    expect(
      getProjectFaviconResourceKey(group.environmentId, group.workspaceRoot, group.faviconPath),
    ).toBe(getProjectFaviconResourceKey(remoteMacId, remote.workspaceRoot, remote.faviconPath));
    expect(group.environmentPresence).toBe("remote-only");
    expect(group.remoteEnvironmentLabels).toEqual(["Remote Mac"]);
  });

  it("reduces groups to their members on the machine and drops groups without one", () => {
    const scoped = scopeSidebarProjectGroupsToEnvironment(
      projectGroups,
      new Set([remoteMacId]),
      groupingInput,
    );

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.projectKey).toBe(sharedGroup.projectKey);
    expect(scoped[0]?.memberProjectRefs).toEqual([
      { environmentId: remoteMacId, projectId: sharedOnRemoteMac.id },
    ]);
    expect(scoped[0]?.memberProjects.map((member) => member.id)).toEqual([sharedOnRemoteMac.id]);
    expect(scoped[0]?.groupedProjectCount).toBe(1);

    const olderRemote = {
      ...sharedOnRemoteMac,
      id: ProjectId.make("older-remote"),
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const currentRemote = { ...sharedOnRemoteMac, repositoryIdentity: null };
    const input = { ...groupingInput, projects: [sharedOnMacbook, olderRemote, currentRemote] };
    const groups = buildSidebarProjectSnapshots({ ...input, resolveEnvironmentLabel: () => null });
    const reduced = scopeSidebarProjectGroupsToEnvironment(groups, new Set([remoteMacId]), input);
    expect(reduced).toHaveLength(1);
    expect(reduced[0]?.projectKey).toBe(sharedGroup.projectKey);
    expect(reduced[0]?.memberProjects.map((member) => member.id)).toEqual([currentRemote.id]);
    expect(reduced[0]?.memberProjectRefs).toEqual([
      { environmentId: remoteMacId, projectId: olderRemote.id },
      { environmentId: remoteMacId, projectId: currentRemote.id },
    ]);
  });

  it("ignores saved projects absent from the scoped machine without changing the saved keys", () => {
    const scoped = scopeSidebarProjectGroupsToEnvironment(
      projectGroups,
      new Set([linuxId]),
      groupingInput,
    );
    const savedKeys = [sharedGroup.projectKey];
    const effectiveKeys = filterSidebarProjectScopeKeysToEnvironment(scoped, savedKeys, null);
    expect(effectiveKeys).toEqual([]);
    expect(savedKeys).toEqual([sharedGroup.projectKey]);
    const selectedGroups = scoped.filter((group) => effectiveKeys.includes(group.projectKey));
    const projectKeys = selectedGroups.length === 0 ? null : projectKeysOf(selectedGroups[0]!);
    expect(
      filterSidebarV2VisibleThreads(threads, projectKeys, new Set(), new Set([linuxId])).map(
        (thread) => thread.id,
      ),
    ).toEqual(["linux-only"]);
    expect(
      filterSidebarEnvironmentIds([macbookId, linuxId], projectKeys, new Set([linuxId])),
    ).toEqual([linuxId]);
    const linuxGroup = scoped[0]!;
    expect(
      filterSidebarProjectScopeKeysToEnvironment(
        scoped,
        [...savedKeys, linuxGroup.projectKey],
        null,
      ),
    ).toEqual([linuxGroup.projectKey]);
  });

  it("keeps the groups untouched for all machines", () => {
    expect(scopeSidebarProjectGroupsToEnvironment(projectGroups, null, groupingInput)).toBe(
      projectGroups,
    );
    const multiple = scopeSidebarProjectGroupsToEnvironment(
      projectGroups,
      new Set([remoteMacId, linuxId]),
      groupingInput,
    );
    expect(multiple).toHaveLength(2);
    expect(multiple[0]).toBe(sharedGroup);
    expect(multiple[0]?.memberProjectRefs).toEqual(sharedGroup.memberProjectRefs);
  });

  it("tells whether a project group lives on a machine", () => {
    expect(projectGroupHasEnvironment(sharedGroup, remoteMacId)).toBe(true);
    expect(projectGroupHasEnvironment(sharedGroup, linuxId)).toBe(false);
    const selected = projectGroups.map((group) => group.projectKey);
    expect(
      filterSidebarProjectScopeKeysToEnvironment(projectGroups, selected, new Set([remoteMacId])),
    ).toEqual([sharedGroup.projectKey]);
    expect(
      filterSidebarProjectScopeKeysToEnvironment(projectGroups, selected, new Set([macbookId])),
    ).toEqual(
      projectGroups
        .filter((group) =>
          group.memberProjects.some((member) => member.environmentId === macbookId),
        )
        .map((group) => group.projectKey),
    );
    expect(filterSidebarProjectScopeKeysToEnvironment(projectGroups, selected, null)).toBe(
      selected,
    );
  });
});

describe("filtering sidebar threads by machine", () => {
  const idsOf = (list: readonly { id: string }[]) => list.map((thread) => thread.id);

  it("keeps only the threads that live on the scoped machine", () => {
    expect(
      idsOf(filterSidebarV2VisibleThreads(threads, null, new Set(), new Set([macbookId]))),
    ).toEqual(["shared-on-macbook", "macbook-only"]);
    expect(idsOf(filterSidebarV2VisibleThreads(threads, null, new Set(), null))).toHaveLength(
      threads.length,
    );
  });

  it("composes the machine scope with the project scope", () => {
    const sharedKeys = projectKeysOf(sharedGroup);

    expect(idsOf(filterSidebarV2VisibleThreads(threads, sharedKeys, new Set(), null))).toEqual([
      "shared-on-macbook",
      "shared-on-remote",
    ]);
    expect(
      idsOf(filterSidebarV2VisibleThreads(threads, sharedKeys, new Set(), new Set([remoteMacId]))),
    ).toEqual(["shared-on-remote"]);
    expect(
      filterSidebarV2VisibleThreads(threads, sharedKeys, new Set(), new Set([linuxId])),
    ).toEqual([]);
    const environmentIds = environments.map((environment) => environment.environmentId);
    expect(filterSidebarEnvironmentIds(environmentIds, sharedKeys, new Set([linuxId]))).toEqual([]);
    expect(filterSidebarEnvironmentIds(environmentIds, sharedKeys, new Set([remoteMacId]))).toEqual(
      [remoteMacId],
    );
    expect(filterSidebarEnvironmentIds(environmentIds, sharedKeys, null)).toEqual([
      remoteMacId,
      macbookId,
    ]);
    expect(filterSidebarEnvironmentIds(environmentIds, null, new Set([linuxId]))).toEqual([
      linuxId,
    ]);
    expect(filterSidebarEnvironmentIds(environmentIds, new Set(), null)).toEqual([]);
    const selectedMachines = new Set([remoteMacId, linuxId]);
    expect(
      idsOf(filterSidebarV2VisibleThreads(threads, null, new Set(), selectedMachines)),
    ).toEqual(["shared-on-remote", "linux-only"]);
    expect(filterSidebarEnvironmentIds(environmentIds, sharedKeys, selectedMachines)).toEqual([
      remoteMacId,
    ]);
    expect(
      filterSidebarProjectScopeKeysToEnvironment(
        projectGroups,
        projectGroups.map((group) => group.projectKey),
        selectedMachines,
      ),
    ).toEqual([
      sharedGroup.projectKey,
      projectGroups.find((group) => group.id === linuxOnly.id)!.projectKey,
    ]);
    const selectedKeys = new Set([...sharedKeys, `${macbookOnly.environmentId}:${macbookOnly.id}`]);
    expect(
      idsOf(filterSidebarV2VisibleThreads(threads, selectedKeys, new Set(), new Set([macbookId]))),
    ).toEqual(["shared-on-macbook", "macbook-only"]);
    expect(
      idsOf(
        filterSidebarV2VisibleThreads(threads, selectedKeys, new Set(), new Set([remoteMacId])),
      ),
    ).toEqual(["shared-on-remote"]);
  });

  it("applies the same scope to drafts", () => {
    const draft = { environmentId: linuxId, projectId: linuxOnly.id };

    expect(isInSidebarScope(draft, null, new Set([linuxId]))).toBe(true);
    expect(isInSidebarScope(draft, null, new Set([macbookId]))).toBe(false);
    expect(isInSidebarScope(draft, projectKeysOf(sharedGroup), new Set([linuxId]))).toBe(false);
  });
});

describe("sidebar empty thread copy", () => {
  it("names the scoped project and machine", () => {
    expect(sidebarEmptyThreadsLabel({ projectName: null, machineLabel: null })).toBe(
      "No threads yet",
    );
    expect(sidebarEmptyThreadsLabel({ projectName: "shared", machineLabel: null })).toBe(
      "No threads in shared yet",
    );
    expect(sidebarEmptyThreadsLabel({ projectName: null, machineLabel: "Linux box" })).toBe(
      "No threads on Linux box yet",
    );
    expect(sidebarEmptyThreadsLabel({ projectName: "shared", machineLabel: "Remote Mac" })).toBe(
      "No threads in shared on Remote Mac yet",
    );
  });
});
