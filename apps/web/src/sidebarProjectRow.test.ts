import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { scopeSidebarProjectGroupsToEnvironment } from "./sidebarEnvironmentScope";
import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";

import {
  activeSidebarProjectSelection,
  buildSidebarProjectActivity,
  clearSidebarProjectSelection,
  effectiveSidebarProjectSelection,
  fitSidebarProjectRow,
  includeSidebarProjectSelection,
  isInSidebarProjectScope,
  legacyProjectCwdPreferenceKey,
  revealSidebarProject,
  sameSidebarProjectActivity,
  SIDEBAR_PROJECT_ICON_ORDERS,
  sidebarProjectManualMove,
  sidebarProjectManualRanks,
  sidebarProjectMemberScope,
  sortSidebarProjectGroups,
  switchSidebarProjectMode,
  toggleSidebarProjectKey,
  toggleSidebarProjectSelection,
} from "./sidebarProjectRow";
import { reorderProjects, useUiStateStore } from "./uiStateStore";

describe("sidebar project activity", () => {
  it("orders and counts scoped members, falling back to project activity only without threads", () => {
    const projects = [
      {
        projectKey: "shared",
        displayName: "Shared",
        pinned: false,
        updatedAt: "2026-10-30T12:00:00Z",
        memberProjects: [],
        memberProjectRefs: [
          { environmentId: "mac", projectId: "a" },
          { environmentId: "linux", projectId: "a" },
        ],
      },
      {
        projectKey: "empty",
        displayName: "Empty",
        pinned: false,
        updatedAt: "2026-10-30T11:00:00Z",
        memberProjects: [],
        memberProjectRefs: [{ environmentId: "mac", projectId: "b" }],
      },
    ];
    const threads = [
      { environmentId: "mac", projectId: "a", updatedAt: "2026-10-30T09:00:00Z", archivedAt: null },
      {
        environmentId: "linux",
        projectId: "a",
        updatedAt: "2026-10-30T10:00:00Z",
        archivedAt: null,
      },
      {
        environmentId: "mac",
        projectId: "a",
        updatedAt: "2026-10-30T13:00:00Z",
        archivedAt: "2026-10-30T13:00:00Z",
      },
      {
        environmentId: "other",
        projectId: "a",
        updatedAt: "2026-10-30T14:00:00Z",
        archivedAt: null,
      },
    ];
    const activity = buildSidebarProjectActivity(projects, threads, "activity");
    expect(activity).toEqual([
      { projectKey: "empty", threadCount: 0, lastActivity: Date.parse("2026-10-30T11:00:00Z") },
      { projectKey: "shared", threadCount: 2, lastActivity: Date.parse("2026-10-30T10:00:00Z") },
    ]);
    const scoped = buildSidebarProjectActivity(
      projects.map((project) => ({
        ...project,
        memberProjectRefs: project.memberProjectRefs.filter((ref) => ref.environmentId === "mac"),
      })),
      threads,
      "activity",
    );
    expect(scoped[1]).toEqual({
      projectKey: "shared",
      threadCount: 1,
      lastActivity: Date.parse("2026-10-30T09:00:00Z"),
    });

    const unchangedOrder = buildSidebarProjectActivity(
      projects,
      [{ ...threads[0]!, updatedAt: "2026-10-30T10:30:00Z" }, ...threads.slice(1)],
      "activity",
    );
    expect(sameSidebarProjectActivity(activity, unchangedOrder)).toBe(true);
    const reordered = buildSidebarProjectActivity(
      projects,
      [{ ...threads[0]!, updatedAt: "2026-10-30T12:30:00Z" }, ...threads.slice(1)],
      "activity",
    );
    expect(sameSidebarProjectActivity(activity, reordered)).toBe(false);
    expect(sameSidebarProjectActivity(activity, scoped)).toBe(false);
  });

  it("orders pinned first, then by name, latest activity or the manual order, and reports a changed order", () => {
    const projects = [
      {
        projectKey: "a",
        displayName: "Zulu",
        pinned: false,
        updatedAt: "2026-11-03T09:00:00Z",
        memberProjects: [{ physicalProjectKey: "mac:/a", workspaceRoot: "/a" }],
        memberProjectRefs: [{ environmentId: "mac", projectId: "a" }],
      },
      {
        projectKey: "b",
        displayName: "Alpha",
        pinned: false,
        updatedAt: "2026-11-03T09:00:00Z",
        memberProjects: [{ physicalProjectKey: "mac:/b", workspaceRoot: "/b" }],
        memberProjectRefs: [{ environmentId: "mac", projectId: "b" }],
      },
      {
        projectKey: "c",
        displayName: "Alpha",
        pinned: false,
        updatedAt: "2026-11-03T09:00:00Z",
        memberProjects: [{ physicalProjectKey: "mac:/c", workspaceRoot: "/c" }],
        memberProjectRefs: [{ environmentId: "mac", projectId: "c" }],
      },
    ];
    const threads = (zuluActiveAt: string) => [
      { environmentId: "mac", projectId: "a", updatedAt: zuluActiveAt, archivedAt: null },
      { environmentId: "mac", projectId: "b", updatedAt: "2026-11-03T10:00:00Z", archivedAt: null },
      { environmentId: "mac", projectId: "c", updatedAt: "2026-11-03T10:00:00Z", archivedAt: null },
    ];
    const keys = (activity: readonly { readonly projectKey: string }[]) =>
      activity.map((entry) => entry.projectKey);
    const alphaPinned = [projects[0]!, { ...projects[1]!, pinned: true }, projects[2]!];

    const byName = buildSidebarProjectActivity(projects, threads("2026-11-03T10:00:00Z"), "name");
    expect(keys(byName)).toEqual(["b", "c", "a"]);
    const byNameZuluNewer = buildSidebarProjectActivity(
      projects,
      threads("2026-11-03T11:00:00Z"),
      "name",
    );
    expect(keys(byNameZuluNewer)).toEqual(["b", "c", "a"]);
    expect(sameSidebarProjectActivity(byName, byNameZuluNewer)).toBe(true);
    const byNamePinned = buildSidebarProjectActivity(
      [projects[0]!, projects[1]!, { ...projects[2]!, pinned: true }],
      threads("2026-11-03T11:00:00Z"),
      "name",
    );
    expect(keys(byNamePinned)).toEqual(["c", "b", "a"]);
    expect(sameSidebarProjectActivity(byNameZuluNewer, byNamePinned)).toBe(false);

    const tied = buildSidebarProjectActivity(projects, threads("2026-11-03T10:00:00Z"), "activity");
    expect(keys(tied)).toEqual(["b", "c", "a"]);
    const zuluNewer = buildSidebarProjectActivity(
      projects,
      threads("2026-11-03T11:00:00Z"),
      "activity",
    );
    expect(keys(zuluNewer)).toEqual(["a", "b", "c"]);
    expect(sameSidebarProjectActivity(tied, zuluNewer)).toBe(false);
    const activityPinned = buildSidebarProjectActivity(
      alphaPinned,
      threads("2026-11-03T11:00:00Z"),
      "activity",
    );
    expect(keys(activityPinned)).toEqual(["b", "a", "c"]);
    expect(sameSidebarProjectActivity(zuluNewer, activityPinned)).toBe(false);

    const manualRanks = sidebarProjectManualRanks(projects, [
      legacyProjectCwdPreferenceKey("/c"),
      "mac:/a",
      "mac:/gone",
    ]);
    const manual = buildSidebarProjectActivity(
      projects,
      threads("2026-11-03T10:00:00Z"),
      "manual",
      manualRanks,
    );
    expect(keys(manual)).toEqual(["c", "a", "b"]);
    const manualZuluNewer = buildSidebarProjectActivity(
      projects,
      threads("2026-11-03T11:00:00Z"),
      "manual",
      manualRanks,
    );
    expect(sameSidebarProjectActivity(manual, manualZuluNewer)).toBe(true);
    const manualPinned = buildSidebarProjectActivity(
      alphaPinned,
      threads("2026-11-03T11:00:00Z"),
      "manual",
      manualRanks,
    );
    expect(keys(manualPinned)).toEqual(["b", "c", "a"]);
    expect(sameSidebarProjectActivity(manualZuluNewer, manualPinned)).toBe(false);

    for (const order of SIDEBAR_PROJECT_ICON_ORDERS) {
      const groups = sortSidebarProjectGroups(
        alphaPinned,
        threads("2026-11-03T11:00:00Z"),
        order,
        manualRanks,
      );
      expect(keys(groups)).toEqual(
        keys(
          buildSidebarProjectActivity(
            alphaPinned,
            threads("2026-11-03T11:00:00Z"),
            order,
            manualRanks,
          ),
        ),
      );
    }
  });

  it("moves a project within its section of the manual order", () => {
    const group = (projectKey: string, pinned: boolean, ...roots: string[]) => ({
      projectKey,
      displayName: projectKey,
      pinned,
      updatedAt: "2026-11-03T09:00:00Z",
      memberProjects: roots.map((root) => ({
        physicalProjectKey: `mac:${root}`,
        workspaceRoot: root,
      })),
      memberProjectRefs: [],
    });
    const groups = [
      group("pinned", true, "/pinned"),
      group("zulu", false, "/zulu"),
      group("alpha", false, "/alpha"),
      group("shared", false, "/shared", "/shared-copy"),
    ];
    const stored = [
      "mac:/zulu",
      "linux:/offline",
      legacyProjectCwdPreferenceKey("/alpha"),
      "mac:/shared-copy",
      "mac:/alpha",
    ];
    const sortManually = (projectOrder: readonly string[], listed = groups) =>
      sortSidebarProjectGroups(
        listed,
        [],
        "manual",
        sidebarProjectManualRanks(listed, projectOrder),
      );
    const moveAndSort = (activeKey: string, overKey: string, listed = groups, order = stored) => {
      const move = sidebarProjectManualMove(listed, order, activeKey, overKey);
      if (move === null) return null;
      const { projectOrder } = reorderProjects(
        { ...useUiStateStore.getInitialState(), projectOrder: order },
        ...move,
      );
      return {
        projectOrder,
        keys: sortManually(projectOrder, listed).map((entry) => entry.projectKey),
      };
    };

    expect(sortManually(stored)).toEqual(groups);
    expect(moveAndSort("zulu", "alpha")).toEqual({
      projectOrder: [
        "linux:/offline",
        legacyProjectCwdPreferenceKey("/alpha"),
        "mac:/zulu",
        "mac:/shared-copy",
        "mac:/alpha",
        "mac:/pinned",
      ],
      keys: ["pinned", "alpha", "zulu", "shared"],
    });
    expect(moveAndSort("alpha", "shared")).toEqual({
      projectOrder: [
        "mac:/zulu",
        "linux:/offline",
        "mac:/shared-copy",
        legacyProjectCwdPreferenceKey("/alpha"),
        "mac:/alpha",
        "mac:/pinned",
      ],
      keys: ["pinned", "zulu", "shared", "alpha"],
    });
    expect(moveAndSort("shared", "pinned")?.keys).toEqual(["pinned", "shared", "zulu", "alpha"]);
    expect(moveAndSort("pinned", "zulu")).toBeNull();
    expect(moveAndSort("alpha", "alpha")).toBeNull();

    const notesOn = (projectKey: string, machine: string) => ({
      ...group(projectKey, false),
      memberProjects: [{ physicalProjectKey: `${machine}:/notes`, workspaceRoot: "/notes" }],
    });
    const sameRoot = [
      group("first", false, "/first"),
      notesOn("laptop", "mac"),
      notesOn("server", "linux"),
    ];
    const legacyOnly = ["/first", "/notes"].map(legacyProjectCwdPreferenceKey);
    expect(sortManually(legacyOnly, sameRoot).map((entry) => entry.projectKey)).toEqual([
      "first",
      "laptop",
      "server",
    ]);
    expect(moveAndSort("laptop", "server", sameRoot, legacyOnly)).toEqual({
      projectOrder: [legacyProjectCwdPreferenceKey("/first"), "linux:/notes", "mac:/notes"],
      keys: ["first", "server", "laptop"],
    });
    expect(moveAndSort("server", "first", sameRoot, legacyOnly)?.keys).toEqual([
      "server",
      "first",
      "laptop",
    ]);
  });

  it("keeps the manual order of logical projects when the view narrows to another machine", () => {
    const project = (name: string, environmentId: EnvironmentId) => ({
      id: ProjectId.make(`${name}-${environmentId}`),
      environmentId,
      title: name,
      workspaceRoot: `/${environmentId}/${name}`,
      repositoryIdentity: {
        canonicalKey: `github.com/example/${name}`,
        locator: {
          source: "git-remote" as const,
          remoteName: "origin",
          remoteUrl: `https://github.com/example/${name}.git`,
        },
      },
      defaultModelSelection: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      scripts: [],
    });
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    const input = {
      projects: [local, remote].flatMap((id) => [project("alpha", id), project("zulu", id)]),
      settings: {
        sidebarProjectGroupingMode: "repository" as const,
        sidebarProjectGroupingOverrides: {},
      },
      primaryEnvironmentId: local,
    };
    const unscoped = buildSidebarProjectSnapshots({
      ...input,
      resolveEnvironmentLabel: () => null,
    });
    const localKey = (name: string) =>
      unscoped
        .find((group) => group.displayName === name)!
        .memberProjects.find((member) => member.environmentId === local)!.physicalProjectKey;
    const ranks = sidebarProjectManualRanks(unscoped, [localKey("zulu"), localKey("alpha")]);
    const names = (environmentIds: ReadonlySet<EnvironmentId> | null) =>
      sortSidebarProjectGroups(
        scopeSidebarProjectGroupsToEnvironment(unscoped, environmentIds, input),
        [],
        "manual",
        ranks,
      ).map((group) => group.displayName);

    expect(names(null)).toEqual(["zulu", "alpha"]);
    expect(names(new Set([remote]))).toEqual(["zulu", "alpha"]);
    expect(names(new Set([local, remote]))).toEqual(["zulu", "alpha"]);
  });
});

const groups = [
  { projectKey: "a", memberProjectRefs: [{ environmentId: "mac", projectId: "a" }] },
  { projectKey: "b", memberProjectRefs: [{ environmentId: "mac", projectId: "b" }] },
  { projectKey: "c", memberProjectRefs: [{ environmentId: "linux", projectId: "c" }] },
];

function shown(include: string[], exclude: string[], environmentId: string | null = null) {
  const available = groups.filter(
    (group) =>
      environmentId === null ||
      group.memberProjectRefs.some((ref) => ref.environmentId === environmentId),
  );
  const members = sidebarProjectMemberScope(available, { include, exclude });
  return groups
    .filter((group) =>
      group.memberProjectRefs.some((ref) =>
        isInSidebarProjectScope(
          ref,
          members,
          environmentId === null ? null : new Set([environmentId]),
        ),
      ),
    )
    .map((group) => group.projectKey);
}

describe("sidebar project selection", () => {
  it.each([
    { include: [], exclude: [], environmentId: null, expected: ["a", "b", "c"] },
    { include: ["a", "c"], exclude: [], environmentId: null, expected: ["a", "c"] },
    { include: [], exclude: ["b"], environmentId: null, expected: ["a", "c"] },
    { include: ["a", "b"], exclude: ["a"], environmentId: null, expected: ["b"] },
    { include: ["a"], exclude: ["a"], environmentId: null, expected: [] },
    { include: [], exclude: ["a", "b", "c"], environmentId: null, expected: [] },
    { include: ["c"], exclude: [], environmentId: "mac", expected: ["a", "b"] },
    { include: ["a", "c"], exclude: [], environmentId: "mac", expected: ["a"] },
    { include: [], exclude: ["c"], environmentId: "mac", expected: ["a", "b"] },
    { include: ["unknown"], exclude: ["unknown"], environmentId: "linux", expected: ["c"] },
  ])(
    "combines $include / $exclude / $environmentId",
    ({ include, exclude, environmentId, expected }) => {
      expect(shown(include, exclude, environmentId)).toEqual(expected);
    },
  );

  it("ignores unavailable keys without erasing the saved selection", () => {
    const selection = { include: ["a", "unknown"], exclude: ["b", "offline"] };
    expect(effectiveSidebarProjectSelection(selection, new Set(["a", "b"]))).toEqual({
      include: ["a"],
      exclude: ["b"],
    });
    expect(selection).toEqual({ include: ["a", "unknown"], exclude: ["b", "offline"] });
    expect(
      isInSidebarProjectScope(
        { environmentId: "mac", projectId: "a" },
        null,
        null,
        new Set(["mac:a"]),
      ),
    ).toBe(false);
  });

  it.each(["include", "exclude"] as const)(
    "switches to %s using the destination's visible selection and preserves the source",
    (to) => {
      const from = to === "include" ? "exclude" : "include";
      for (const { source, destination, available, expected } of [
        { source: ["a", "b"], destination: [], available: ["a", "b"], expected: ["a", "b"] },
        {
          source: ["remote-source", "b"],
          destination: ["remote-destination", "a"],
          available: ["a", "b"],
          expected: ["remote-destination", "a"],
        },
        {
          source: ["remote-source", "b"],
          destination: ["remote-destination"],
          available: ["a", "b"],
          expected: ["remote-destination", "b"],
        },
        {
          source: ["remote-source"],
          destination: ["remote-destination"],
          available: ["a", "b"],
          expected: ["remote-destination"],
        },
        {
          source: ["remote-source", "b"],
          destination: ["remote-destination"],
          available: ["remote-source", "remote-destination", "b"],
          expected: ["remote-destination"],
        },
      ]) {
        const initial = { include: [], exclude: [], [from]: source, [to]: destination };
        const scope = {
          groups: [],
          settings: {
            sidebarProjectGroupingMode: "repository" as const,
            sidebarProjectGroupingOverrides: {},
          },
          availableKeys: new Set(available),
        };
        const switched = switchSidebarProjectMode(initial, from, to, scope);
        expect(switched[to]).toEqual(expected);
        expect(switched[from]).toBe(source);
        expect(initial[to]).toBe(destination);
        if (destination.some((key) => scope.availableKeys.has(key))) {
          expect(switched).toBe(initial);
        }
        expect(switchSidebarProjectMode(initial, from, from, scope)).toBe(initial);
      }
    },
  );

  it.each([
    { available: ["b1"], expected: ["n", "b1"] },
    { available: ["n", "X", "b1"], expected: ["n"] },
  ])(
    "switches back to Hide after a native include and machine change with $available visible",
    ({ available, expected }) => {
      const scope = {
        groups: [],
        settings: {
          sidebarProjectGroupingMode: "repository" as const,
          sidebarProjectGroupingOverrides: {},
        },
        effectiveKeys: ["n"],
        availableKeys: new Set(["n", "X"]),
      };
      const initial = { include: [], exclude: ["n"] };
      const included = {
        ...initial,
        include: includeSidebarProjectSelection(initial, "exclude", "X", scope),
      };
      expect(included).toEqual({ include: ["X"], exclude: ["n"] });
      const picked = {
        ...included,
        include: toggleSidebarProjectSelection(included, "include", "b1", false, {
          ...scope,
          effectiveKeys: [],
        }),
      };
      expect(picked).toEqual({ include: ["X", "b1"], exclude: ["n"] });
      const hidden = switchSidebarProjectMode(picked, "include", "exclude", {
        ...scope,
        availableKeys: new Set(available),
      });
      expect(hidden).toEqual({ include: ["X", "b1"], exclude: expected });
      expect(hidden.include).toBe(picked.include);
      expect(picked.exclude).toEqual(["n"]);
    },
  );

  it.each(["include", "exclude"] as const)(
    "selects only or toggles projects in %s mode",
    (mode) => {
      for (const { keys, key, additive, expected, visibleKeys, cleared } of [
        { keys: [], key: "a", additive: false, expected: ["a"] },
        { keys: ["a"], key: "b", additive: false, expected: ["b"] },
        { keys: ["a", "b"], key: "b", additive: false, expected: ["b"] },
        { keys: ["b"], key: "b", additive: false, expected: [] },
        { keys: [], key: "a", additive: true, expected: ["a"] },
        { keys: ["a"], key: "b", additive: true, expected: ["a", "b"] },
        { keys: ["a", "b"], key: "a", additive: true, expected: ["b"] },
        { keys: ["b"], key: "b", additive: true, expected: [] },
        {
          keys: ["remote", "a", "b"],
          visibleKeys: ["a", "b"],
          cleared: ["remote"],
          key: "c",
          additive: false,
          expected: ["remote", "c"],
        },
        {
          keys: ["remote", "a", "b"],
          visibleKeys: ["a", "b"],
          cleared: ["remote"],
          key: "b",
          additive: false,
          expected: ["remote", "b"],
        },
        {
          keys: ["remote", "b"],
          visibleKeys: ["b"],
          cleared: ["remote"],
          key: "b",
          additive: false,
          expected: ["remote"],
        },
        {
          keys: ["remote"],
          visibleKeys: [],
          cleared: ["remote"],
          key: "c",
          additive: false,
          expected: ["remote", "c"],
        },
        {
          keys: ["remote", "a"],
          visibleKeys: ["a"],
          cleared: ["remote"],
          key: "b",
          additive: true,
          expected: ["remote", "a", "b"],
        },
        {
          keys: ["remote", "a", "b"],
          visibleKeys: ["a", "b"],
          cleared: ["remote"],
          key: "a",
          additive: true,
          expected: ["remote", "b"],
        },
      ]) {
        const selection = { include: ["remote-include", "a"], exclude: [], [mode]: keys };
        const effectiveKeys = visibleKeys ?? keys;
        const scope = {
          effectiveKeys,
          groups: [],
          settings: {
            sidebarProjectGroupingMode: "repository" as const,
            sidebarProjectGroupingOverrides: {},
          },
        };
        if (visibleKeys === undefined) {
          expect(toggleSidebarProjectKey(keys, key, additive)).toEqual(expected);
        }
        expect(toggleSidebarProjectSelection(selection, mode, key, additive, scope)).toEqual(
          expected,
        );
        expect(clearSidebarProjectSelection(selection, mode, scope)).toEqual(cleared ?? []);
        if (!additive) {
          for (const { include, availableKeys, included } of [
            { include: [], availableKeys: ["a", "b", "c"], included: [key] },
            {
              include: ["remote-include", "a"],
              availableKeys: ["a", "b", "c"],
              included: ["remote-include", key],
            },
            {
              include: ["remote-include", "a"],
              availableKeys: ["remote-include", "a", "b", "c"],
              included: [key],
            },
          ]) {
            const persisted = mode === "include" ? selection : { ...selection, include };
            expect(
              includeSidebarProjectSelection(persisted, mode, key, {
                ...scope,
                availableKeys: new Set(availableKeys),
              }),
            ).toEqual(mode === "include" ? expected : included);
            expect(persisted.exclude).toEqual(mode === "exclude" ? keys : []);
          }
        }
        expect(selection[mode]).toEqual(keys);
        const first = activeSidebarProjectSelection(selection, mode);
        const second = activeSidebarProjectSelection(selection, mode);
        expect(first.include).toBe(second.include);
        expect(first.exclude).toBe(second.exclude);
      }
    },
  );

  it.each(["include", "exclude"] as const)(
    "resolves persisted %s aliases for selection changes and retains absent keys",
    (mode) => {
      const settings = {
        sidebarProjectGroupingMode: "repository" as const,
        sidebarProjectGroupingOverrides: {},
      };
      const groups = buildSidebarProjectSnapshots({
        projects: [
          {
            id: ProjectId.make("scratch"),
            environmentId: EnvironmentId.make("mac"),
            title: "No project",
            workspaceRoot: "/old/scratch",
            isScratch: true,
            defaultModelSelection: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            scripts: [],
          },
        ],
        settings,
        primaryEnvironmentId: EnvironmentId.make("mac"),
        groupScratchProjects: true,
        resolveEnvironmentLabel: () => null,
      });
      const scratch = groups[0]!;
      const alias = scratch.memberProjects[0]!.physicalProjectKey;
      expect(alias).not.toBe(scratch.projectKey);
      for (const absent of [[], ["absent"], ["offline", "removed"]]) {
        const selection = {
          include: mode === "include" ? [alias, ...absent] : [],
          exclude: mode === "exclude" ? [alias, ...absent] : [],
        };
        const otherMode = mode === "include" ? "exclude" : "include";
        const modeScope = { groups, settings, availableKeys: new Set([scratch.projectKey]) };
        const carried = switchSidebarProjectMode(selection, mode, otherMode, modeScope);
        expect(carried[mode]).toBe(selection[mode]);
        expect(carried[otherMode]).toEqual([alias]);
        expect(switchSidebarProjectMode(selection, otherMode, mode, modeScope)).toBe(selection);
        expect(
          clearSidebarProjectSelection(selection, mode, {
            groups,
            settings,
            effectiveKeys: [scratch.projectKey],
          }),
        ).toEqual(absent);
        expect(
          toggleSidebarProjectSelection(selection, mode, scratch.projectKey, true, {
            groups,
            settings,
            effectiveKeys: [scratch.projectKey],
          }),
        ).toEqual(absent);
        expect(
          toggleSidebarProjectSelection(selection, mode, scratch.projectKey, false, {
            groups,
            settings,
            effectiveKeys: [scratch.projectKey],
          }),
        ).toEqual(absent);
        expect(
          toggleSidebarProjectSelection(selection, mode, "other", false, {
            groups,
            settings,
            effectiveKeys: [scratch.projectKey],
          }),
        ).toEqual([...absent, "other"]);
        expect(
          toggleSidebarProjectSelection(selection, mode, "other", true, {
            groups,
            settings,
            effectiveKeys: [scratch.projectKey],
          }),
        ).toEqual([scratch.projectKey, ...absent, "other"]);
      }
    },
  );

  it("reveals only the opened project and leaves unfiltered include unchanged", () => {
    expect(
      revealSidebarProject(
        { include: ["absent", "a"], exclude: ["b"] },
        "include",
        "archived",
        new Set(["a", "b"]),
      ),
    ).toEqual({ include: ["absent"], exclude: ["b"] });
    expect(
      revealSidebarProject(
        { include: ["unknown"], exclude: [] },
        "include",
        "b",
        new Set(["a", "b"]),
      ),
    ).toEqual({ include: ["unknown"], exclude: [] });
    expect(
      revealSidebarProject(
        { include: ["unknown", "a"], exclude: [] },
        "include",
        "b",
        new Set(["a", "b"]),
      ),
    ).toEqual({ include: ["unknown", "a", "b"], exclude: [] });
    expect(revealSidebarProject({ include: ["a"], exclude: [] }, "include", "b")).toEqual({
      include: ["a", "b"],
      exclude: [],
    });
    expect(revealSidebarProject({ include: [], exclude: [] }, "include", "b")).toEqual({
      include: [],
      exclude: [],
    });
    expect(revealSidebarProject({ include: [], exclude: ["a", "b"] }, "exclude", "b")).toEqual({
      include: [],
      exclude: ["a"],
    });
  });
});

describe("sidebar project row fitting", () => {
  const input = {
    keys: ["a", "b", "c", "d"],
    selected: new Set<string>(),
    width: 110,
    itemWidth: 26,
    gap: 2,
    overflowWidth: 26,
  };

  it("uses the whole width without reserving overflow when everything fits", () => {
    expect(fitSidebarProjectRow(input)).toEqual({ visible: input.keys, overflow: [] });
    expect(fitSidebarProjectRow({ ...input, width: 109 })).toEqual({
      visible: ["a", "b"],
      overflow: ["c", "d"],
    });
  });

  it("replaces the last ordinary slot with selected projects in their original order", () => {
    expect(fitSidebarProjectRow({ ...input, width: 109, selected: new Set(["d"]) })).toEqual({
      visible: ["a", "d"],
      overflow: ["b", "c"],
    });
    expect(fitSidebarProjectRow({ ...input, width: 109, selected: new Set(["c", "d"]) })).toEqual({
      visible: ["c", "d"],
      overflow: ["a", "b"],
    });
    expect(
      fitSidebarProjectRow({ ...input, width: 109, selected: new Set(["d", "b", "c"]) }),
    ).toEqual({
      visible: ["b", "c"],
      overflow: ["a", "d"],
    });
    expect(fitSidebarProjectRow({ ...input, width: 26, selected: new Set(input.keys) })).toEqual({
      visible: [],
      overflow: input.keys,
    });
  });
});
