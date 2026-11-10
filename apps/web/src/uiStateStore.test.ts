import { ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  legacyProjectCwdPreferenceKey,
  markThreadUnread,
  markThreadVisited,
  parsePersistedState,
  PERSISTED_STATE_KEY,
  type PersistedUiState,
  persistState,
  reorderProjects,
  revealSidebarProjectScope,
  resolveProjectExpanded,
  setProjectExpanded,
  setSidebarEnvironmentScopeKeys,
  setSidebarProjectScopeKeys,
  setSidebarProjectExcludeKeys,
  setSidebarProjectFilterMode,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    sidebarProjectScopeKeys: [],
    sidebarEnvironmentScopeKeys: [],
    sidebarProjectExcludeKeys: [],
    sidebarProjectFilterMode: "include",
    sidebarProjectIconOrder: "name",
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    defaultAdvertisedEndpointKey: null,
    pullRequestMergeMethod: "merge",
    ...overrides,
  };
}

const projectModeScope = {
  groups: [],
  settings: {
    sidebarProjectGroupingMode: "repository" as const,
    sidebarProjectGroupingOverrides: {},
  },
  availableKeys: new Set(["a", "c", "local"]),
};

describe("uiStateStore pure functions", () => {
  it.each(["include", "exclude"] as const)(
    "keeps the shared %s filter across machine changes, including removed machines",
    (mode) => {
      const initial = setSidebarProjectFilterMode(
        makeUiState({ sidebarProjectScopeKeys: ["a", "offline", "removed"] }),
        mode,
        projectModeScope,
      );
      let state = initial;
      for (const keys of [["mac"], ["linux", "mac"], ["removed"], [], ["linux"]]) {
        state = setSidebarEnvironmentScopeKeys(state, keys);
        expect(state.sidebarProjectScopeKeys).toBe(initial.sidebarProjectScopeKeys);
        expect(state.sidebarProjectExcludeKeys).toBe(initial.sidebarProjectExcludeKeys);
        expect(state.sidebarProjectFilterMode).toBe(mode);
      }
      expect(setSidebarEnvironmentScopeKeys(state, ["linux", "linux"])).toBe(state);
      const pair = setSidebarEnvironmentScopeKeys(state, ["mac", "linux"]);
      expect(setSidebarEnvironmentScopeKeys(pair, ["linux", "mac"])).toBe(pair);
      const cleared = setSidebarEnvironmentScopeKeys(pair, []);
      expect(setSidebarEnvironmentScopeKeys(cleared, [])).toBe(cleared);
      const stale = setSidebarEnvironmentScopeKeys(state, ["removed"]);
      expect(setSidebarEnvironmentScopeKeys(stale, []).sidebarEnvironmentScopeKeys).toEqual([]);
      const picked = setSidebarProjectScopeKeys(state, ["picked"]);
      expect(picked.sidebarProjectFilterMode).toBe("include");
      expect(picked.sidebarProjectExcludeKeys).toBe(initial.sidebarProjectExcludeKeys);
      if (mode === "exclude") {
        const restored = setSidebarProjectFilterMode(picked, "exclude", projectModeScope);
        expect(restored.sidebarProjectExcludeKeys).toEqual(initial.sidebarProjectExcludeKeys);
        expect(restored.sidebarProjectScopeKeys).toEqual(["picked"]);
      }
      expect(picked.sidebarProjectScopeKeys).toEqual(["picked"]);
      expect(setSidebarProjectScopeKeys(picked, ["picked"])).toBe(picked);
      expect(setSidebarProjectExcludeKeys(picked, picked.sidebarProjectExcludeKeys)).toBe(picked);
    },
  );

  it.each(
    (["include", "exclude"] as const).flatMap((mode) =>
      [undefined, true, false].map((restoreExclude) => ({ mode, restoreExclude })),
    ),
  )(
    "sanitizes active $mode mode and ignores legacy restoreExclude=$restoreExclude",
    ({ mode, restoreExclude }) => {
      const valid = makeUiState({ sidebarProjectFilterMode: mode });
      expect(revealSidebarProjectScope(valid, "a", false)).toBe(valid);
      const legacySelection = { include: ["a"], exclude: ["b"], restoreExclude };
      const state = parsePersistedState({
        sidebarProjectFilterMode: mode,
        sidebarProjectScopeKeys: ["a"],
        sidebarProjectExcludeKeys: ["b"],
        sidebarProjectScopesByEnvironment: { "": legacySelection },
      });
      expect(state).not.toHaveProperty("sidebarProjectScopesByEnvironment");
      expect(state.sidebarProjectScopeKeys).toEqual(["a"]);
      expect(state.sidebarProjectExcludeKeys).toEqual(["b"]);
      expect(revealSidebarProjectScope(state, "a", false)).toBe(state);
    },
  );

  it.each(["include", "exclude"] as const)(
    "reveals a project using the shared %s selection when widening machines",
    (mode) => {
      const all = makeUiState({ sidebarProjectScopeKeys: ["a", "b"] });
      const mac = setSidebarProjectScopeKeys(setSidebarEnvironmentScopeKeys(all, ["mac"]), ["c"]);
      const state = setSidebarProjectFilterMode(mac, mode, projectModeScope);
      const revealed = revealSidebarProjectScope(state, "b", true);
      expect(revealed.sidebarEnvironmentScopeKeys).toEqual([]);
      expect(revealed.sidebarProjectScopeKeys).toEqual(mode === "include" ? ["c", "b"] : ["c"]);
      expect(revealed.sidebarProjectExcludeKeys).toEqual(mode === "exclude" ? ["c"] : []);
    },
  );

  it.each(["include", "exclude"] as const)(
    "reveals through canonical project keys while preserving unknown saved keys in %s mode",
    (mode) => {
      const all = makeUiState({ sidebarProjectScopeKeys: ["legacy-a", "unknown"] });
      const mac = setSidebarProjectScopeKeys(setSidebarEnvironmentScopeKeys(all, ["mac"]), [
        "local",
      ]);
      const state = setSidebarProjectFilterMode(mac, mode, projectModeScope);
      const revealed = revealSidebarProjectScope(
        state,
        mode === "include" ? "b" : "a",
        true,
        new Set(["a", "b"]),
        mode === "include"
          ? { include: ["a", "unknown"], exclude: [] }
          : { include: [], exclude: ["a", "unknown"] },
      );
      expect(revealed.sidebarProjectScopeKeys).toEqual(
        mode === "include" ? ["a", "unknown", "b"] : [],
      );
      expect(revealed.sidebarProjectExcludeKeys).toEqual(mode === "exclude" ? ["unknown"] : []);
      expect(revealed.sidebarEnvironmentScopeKeys).toEqual([]);
    },
  );

  it("stores server timestamps without moving visit state backwards", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState();
    const visited = markThreadVisited(initialState, threadId, "2026-02-25T12:30:00.700Z");

    expect(visited.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:30:00.700Z");
    expect(markThreadVisited(visited, threadId, "2026-02-25T12:30:00.000Z")).toBe(visited);
    expect(markThreadVisited(visited, threadId, "not-a-date")).toBe(visited);
  });

  it("marks a completed thread unread using the server completion timestamp", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, "2026-02-25T12:30:00.000Z");

    expect(next.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:29:59.999Z");
    expect(markThreadUnread(next, threadId, null)).toBe(next);
  });

  it("resolves project expansion from logical, physical, and legacy preference keys", () => {
    const physicalKey = "environment:/repo/project";
    const legacyKey = legacyProjectCwdPreferenceKey("/repo/project");

    expect(resolveProjectExpanded({ logical: false, [physicalKey]: true }, ["logical"])).toBe(
      false,
    );
    expect(resolveProjectExpanded({ [physicalKey]: false }, ["new-logical", physicalKey])).toBe(
      false,
    );
    expect(resolveProjectExpanded({ [legacyKey]: false }, ["new-logical", legacyKey])).toBe(false);
    expect(resolveProjectExpanded({}, ["new-logical"])).toBe(true);
  });

  it("sets expansion for every stable key belonging to a logical project", () => {
    const initialState = makeUiState();
    const keys = ["logical", "environment-a:/repo", "environment-b:/repo"];

    const next = setProjectExpanded(initialState, keys, false);

    expect(next.projectExpandedById).toEqual({
      logical: false,
      "environment-a:/repo": false,
      "environment-b:/repo": false,
    });
    expect(setProjectExpanded(next, keys, false)).toBe(next);
  });

  it("moves grouped project members together", () => {
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const keyB = "env-local:proj-b";
    const keyC = "env-local:proj-c";
    const currentOrder = [keyALocal, keyARemote, keyB, keyC];

    const next = reorderProjects(makeUiState(), currentOrder, [keyALocal, keyARemote], [keyC]);

    expect(next.projectOrder).toEqual([keyB, keyC, keyALocal, keyARemote]);
  });
});

describe("parsePersistedState", () => {
  it.each([
    { legacy: undefined, keys: undefined, expected: [] },
    { legacy: null, keys: undefined, expected: [] },
    { legacy: "", keys: undefined, expected: [] },
    { legacy: 42, keys: undefined, expected: [] },
    { legacy: "mac", keys: undefined, expected: ["mac"] },
    { legacy: "mac", keys: [], expected: [] },
    { legacy: "mac", keys: ["linux", "unknown", "linux", "", 42], expected: ["linux", "unknown"] },
  ])("migrates and sanitizes machine scopes $legacy / $keys", ({ legacy, keys, expected }) => {
    expect(
      parsePersistedState({
        sidebarEnvironmentScopeKey: legacy as string | null,
        ...(keys === undefined ? {} : { sidebarEnvironmentScopeKeys: keys as string[] }),
      }).sidebarEnvironmentScopeKeys,
    ).toEqual(expected);
  });

  it.each([undefined, null, [], "invalid", 42])(
    "ignores invalid project scope maps, mode and icon order %s",
    (value) => {
      const parsed = parsePersistedState({
        sidebarEnvironmentScopeKeys: ["__proto__"],
        sidebarProjectScopesByEnvironment: value as unknown as NonNullable<
          PersistedUiState["sidebarProjectScopesByEnvironment"]
        >,
        sidebarProjectFilterMode: value as unknown as NonNullable<
          PersistedUiState["sidebarProjectFilterMode"]
        >,
        sidebarProjectExcludeKeys: value as unknown as string[],
        sidebarProjectIconOrder: value as unknown as NonNullable<
          PersistedUiState["sidebarProjectIconOrder"]
        >,
      });
      expect(parsed.sidebarProjectIconOrder).toBe("name");
      expect(parsed.sidebarProjectScopeKeys).toEqual([]);
      expect(parsed).not.toHaveProperty("sidebarProjectScopesByEnvironment");
      expect(parsed.sidebarProjectFilterMode).toBe("include");
      expect(parsed.sidebarProjectExcludeKeys).toEqual([]);
    },
  );

  it("sanitizes selections while keeping unknown machine and project keys", () => {
    const parsed = parsePersistedState(
      JSON.parse(
        JSON.stringify({
          sidebarProjectExcludeKeys: ["a", "", "a", 42, "unknown"],
          sidebarProjectFilterMode: "exclude",
          sidebarProjectScopesByEnvironment: {
            "": { include: ["all"], exclude: [] },
            unknown: { include: ["a", "a", false], exclude: ["b", ""] },
            malformed: { include: null, exclude: 42 },
            ignored: null,
            array: [],
          },
        }),
      ) as PersistedUiState,
    );
    expect(parsed.sidebarProjectExcludeKeys).toEqual(["a", "unknown"]);
    expect(parsed.sidebarProjectFilterMode).toBe("exclude");
    expect(parsed).not.toHaveProperty("sidebarProjectScopesByEnvironment");
  });

  it("hydrates raw UI-owned state without server entities", () => {
    const parsed = parsePersistedState({
      projectExpandedById: {
        logical: false,
        invalid: "no" as unknown as boolean,
      },
      projectOrder: ["physical-b", "", "physical-a", "physical-b"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
        invalid: "not-a-date",
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      threadChangedFilesExpansionVersion: 2,
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
    });

    expect(parsed).toEqual({
      projectExpandedById: {
        logical: false,
      },
      projectOrder: ["physical-b", "physical-a"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectScopeKeys: [],
      sidebarEnvironmentScopeKeys: [],
      sidebarProjectExcludeKeys: [],
      sidebarProjectFilterMode: "include",
      sidebarProjectIconOrder: "name",
      pullRequestMergeMethod: "merge",
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
    });
  });

  it.each([undefined, 1])("ignores changed-file expansion version %s", (version) => {
    const parsed = parsePersistedState({
      ...(version === undefined ? {} : { threadChangedFilesExpansionVersion: version }),
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
        },
      },
    });

    expect(parsed.threadChangedFilesExpandedById).toEqual({});
  });

  it("migrates legacy CWD project preferences into local alias keys", () => {
    const parsed = parsePersistedState({
      collapsedProjectCwds: ["/repo/b"],
      expandedProjectCwds: ["/repo/a"],
      projectOrderCwds: ["/repo/b", "/repo/a"],
    });
    const projectAKey = legacyProjectCwdPreferenceKey("/repo/a");
    const projectBKey = legacyProjectCwdPreferenceKey("/repo/b");

    expect(parsed.projectOrder).toEqual([projectBKey, projectAKey]);
    expect(resolveProjectExpanded(parsed.projectExpandedById, [projectAKey])).toBe(true);
    expect(resolveProjectExpanded(parsed.projectExpandedById, [projectBKey])).toBe(false);
    expect(resolveProjectExpanded(parsed.projectExpandedById, ["unknown"])).toBe(true);
  });
});

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("uiStateStore persistence", () => {
  let localStorageStub: Storage;

  beforeEach(() => {
    localStorageStub = createLocalStorageStub();
    vi.stubGlobal("window", { localStorage: localStorageStub });
    vi.stubGlobal("localStorage", localStorageStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists raw UI preferences including thread visit markers", () => {
    const state = makeUiState({
      projectExpandedById: {
        logical: false,
      },
      projectOrder: ["physical-b", "physical-a"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
      },
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectIconOrder: "activity",
    });

    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(persisted).toEqual({
      projectExpandedById: {
        logical: false,
      },
      projectOrder: ["physical-b", "physical-a"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectScopeKeys: [],
      sidebarProjectScopeKey: null,
      sidebarEnvironmentScopeKeys: [],
      sidebarProjectExcludeKeys: [],
      sidebarProjectFilterMode: "include",
      sidebarProjectIconOrder: "activity",
      threadChangedFilesExpansionVersion: 2,
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
      pullRequestMergeMethod: "merge",
    });
    expect(parsePersistedState(persisted)).toEqual({
      ...state,
    });
  });

  it.each(
    [
      { top: ["current"], active: ["machine"], all: ["all"], expected: ["current"] },
      { top: [], active: ["machine"], all: ["all"], expected: ["machine"] },
      { top: undefined, active: ["machine"], all: ["all"], expected: ["machine"] },
      { top: [], active: [], all: ["all"], expected: ["all"] },
      { top: undefined, active: undefined, all: ["all"], expected: ["all"] },
      { top: [], active: [], all: [], expected: [] },
      { top: [], inactiveTop: ["saved"], active: [], all: [], expected: [] },
      {
        top: [],
        inactiveTop: ["inactive"],
        active: ["machine"],
        all: ["all"],
        expected: ["machine"],
      },
      { top: [], active: [], inactiveActive: ["inactive"], all: ["all"], expected: ["all"] },
      {
        top: ["current"],
        inactiveTop: ["other-mode"],
        active: ["machine"],
        all: ["all"],
        expected: ["current"],
      },
      {
        top: ["", 42],
        active: ["machine", "machine", 42, ""],
        all: ["all"],
        expected: ["machine"],
      },
    ].flatMap((row) =>
      (["include", "exclude"] as const).flatMap((mode) =>
        [["mac"], ["mac", "linux"]].map((machines) => ({ ...row, mode, machines })),
      ),
    ),
  )(
    "restores the shared $mode filter across reloads: $top / $active / $all on $machines",
    ({ top, inactiveTop, active, inactiveActive, all, expected, mode, machines }) => {
      const activeKey = machines.length === 1 ? machines[0]! : JSON.stringify([...machines].sort());
      const state = parsePersistedState({
        sidebarEnvironmentScopeKeys: machines,
        sidebarProjectFilterMode: mode,
        [mode === "include" ? "sidebarProjectExcludeKeys" : "sidebarProjectScopeKeys"]: inactiveTop,
        ...(top === undefined
          ? {}
          : {
              [mode === "include" ? "sidebarProjectScopeKeys" : "sidebarProjectExcludeKeys"]: top,
            }),
        sidebarProjectScopesByEnvironment: {
          [activeKey]: {
            include: [],
            exclude: [],
            [mode === "include" ? "exclude" : "include"]: inactiveActive,
            [mode]: active,
          },
          "": { include: [], exclude: [], [mode]: all },
        },
      } as PersistedUiState);
      const field = mode === "include" ? "sidebarProjectScopeKeys" : "sidebarProjectExcludeKeys";
      expect(state[field]).toEqual(expected);
      const inactiveField =
        mode === "include" ? "sidebarProjectExcludeKeys" : "sidebarProjectScopeKeys";
      expect(state[inactiveField]).toEqual(inactiveTop ?? []);
      persistState(state);
      const saved = JSON.parse(localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}");
      expect(saved).not.toHaveProperty("sidebarProjectScopesByEnvironment");
      expect(saved.sidebarProjectScopeKey).toBe(
        state.sidebarProjectScopeKeys.length === 1 ? state.sidebarProjectScopeKeys[0] : null,
      );
      expect(parsePersistedState(saved)).toEqual(state);
      expect(state.sidebarEnvironmentScopeKeys).toEqual(machines);
      expect(state.sidebarProjectFilterMode).toBe(mode);
    },
  );

  it("keeps a single-project scope readable by older clients", () => {
    persistState(makeUiState({ sidebarProjectScopeKeys: ["github.com/pingdotgg/t3code"] }));

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;

    expect(persisted.sidebarProjectScopeKey).toBe("github.com/pingdotgg/t3code");
  });

  it("restores a single-project scope saved before multi-project filtering", () => {
    expect(
      parsePersistedState({ sidebarProjectScopeKey: "github.com/pingdotgg/t3code" })
        .sidebarProjectScopeKeys,
    ).toEqual(["github.com/pingdotgg/t3code"]);
  });
});
