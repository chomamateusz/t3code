import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let projectRemoved = false;
  let scratch = false;
  let groupCount = 2;
  let boringSidebarEnabled = false;
  let connectedEnvironmentIds = ["environment-primary", "environment-ssh"];
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree" | null,
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  type StoredDraft = {
    readonly draftId: string;
    readonly environmentId: string;
    readonly projectId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  };
  let storedDraft: StoredDraft | null = null;
  let additionalDrafts: Record<string, StoredDraft> = {};
  let openDraftRoute: { readonly kind: "draft"; readonly draftId: string } | null = null;
  let draftsWithUserText = new Set<string>();
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    get draftThreadsByThreadKey() {
      return {
        ...(storedDraft ? { [storedDraft.draftId]: storedDraft } : {}),
        ...additionalDrafts,
      };
    },
    getComposerDraft: vi.fn((draftId: string) => ({ draftId })),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() =>
      openDraftRoute === null
        ? null
        : {
            logicalProjectKey: "remote-project",
            promotedTo: null,
            threadId: "thread-open",
            createdAt: "2026-01-01T00:00:00.000Z",
            runtimeMode: "full-access",
            interactionMode: "default",
          },
    ),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
    setPrompt: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    configureStart: (input: {
      scratch?: boolean;
      groupCount?: number;
      boringSidebarEnabled?: boolean;
    }) => {
      scratch = input.scratch ?? false;
      groupCount = input.groupCount ?? 2;
      boringSidebarEnabled = input.boringSidebarEnabled ?? false;
    },
    get scratch() {
      return scratch;
    },
    get groupCount() {
      return groupCount;
    },
    get clientSettings() {
      return { boringSidebarEnabled };
    },
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get projectRemoved() {
      return projectRemoved;
    },
    get connectedEnvironmentIds() {
      return connectedEnvironmentIds;
    },
    disconnect(environmentId: string) {
      connectedEnvironmentIds = connectedEnvironmentIds.filter((id) => id !== environmentId);
    },
    removeProject() {
      projectRemoved = true;
    },
    hasUserText: (draft: { readonly draftId?: string } | null | undefined) =>
      draft?.draftId !== undefined && draftsWithUserText.has(draft.draftId),
    giveUserText(draftId: string) {
      draftsWithUserText = new Set([...draftsWithUserText, draftId]);
    },
    get openDraftRoute() {
      return openDraftRoute;
    },
    addDraft(draft: StoredDraft) {
      additionalDrafts[draft.draftId] = draft;
    },
    openEmptyDraft(draftId: string) {
      openDraftRoute = { kind: "draft", draftId };
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree" | null,
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      additionalDrafts = {};
      openDraftRoute = null;
      draftsWithUserText = new Set();
      projectRemoved = false;
      scratch = false;
      groupCount = 2;
      boringSidebarEnabled = false;
      connectedEnvironmentIds = ["environment-primary", "environment-ssh"];
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      draftStore.setPrompt.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

const testServerConfigs = () =>
  new Map([
    [
      "environment-primary",
      {
        settings: {
          ...testState.targetSettings,
          newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
        },
      },
    ],
    ["environment-ssh", { settings: testState.targetSettings }],
  ]);

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      atom === "connected-environment-ids"
        ? testState.connectedEnvironmentIds
        : atom === "presentations"
          ? new Map([
              [
                "environment-ssh",
                {
                  connection: { phase: "connected" },
                  serverConfig: { scratchWorkspaceRoot: "/remote/scratch" },
                },
              ],
            ])
          : atom === "primary-environment"
            ? "environment-ssh"
            : testServerConfigs(),
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : testServerConfigs(),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
  resolveNewThreadEnvMode: (input: {
    projectSettings: { settings: { defaultThreadEnvMode: "local" | "worktree" } };
  }) => input.projectSettings.settings.defaultThreadEnvMode,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({
  orderItemsByPreferredIds: () => [],
  shouldCreateNewThreadInCurrentProject: () => testState.groupCount <= 1,
}));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    DraftId: { make: (value: string) => value },
    composerDraftHasUserContent: (draft: { readonly draftId?: string } | null | undefined) =>
      testState.hasUserText(draft),
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../providerInstances", () => ({ resolveDefaultProviderModelSelection: () => null }));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("@t3tools/client-runtime/state/projects", () => ({
  isScratchProject: (project: { workspaceRoot: string }, root: string | undefined) =>
    project.workspaceRoot === root,
}));
vi.mock("@t3tools/client-runtime/state/project-grouping", () => ({
  pickableProjectGroups: <T>(groups: readonly T[]) => groups,
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => {
  const project = {
    id: "project-remote",
    environmentId: "environment-ssh",
    get workspaceRoot() {
      return testState.scratch ? "/remote/scratch" : "/remote/project";
    },
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  return {
    readProject: () => (testState.projectRemoved ? null : project),
    readProjects: () => (testState.projectRemoved ? [] : [project]),
    readThreadShell: () => null,
    readThreadShells: () => [],
    useProjects: () => [],
    useThread: () => null,
  };
});
vi.mock("../state/olderSettledShelf", () => ({ readUnloadedThreadCount: () => 0 }));
vi.mock("../state/presentation", () => ({
  environmentSummaries: { connectedEnvironmentIdsAtom: "connected-environment-ids" },
  environmentPresentations: { presentationsAtom: "presentations" },
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({
  resolveThreadRouteTarget: () => testState.openDraftRoute,
}));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ getClientSettings: () => testState.clientSettings }));
vi.mock("../state/primaryEnvironment", () => ({ primaryEnvironmentIdAtom: "primary-environment" }));
vi.mock("../newThreadTargetState", () => ({
  readNewThreadTargetInput: () => ({
    groups: Array.from({ length: testState.groupCount }, () => ({
      archived: false,
      pinned: false,
    })),
  }),
}));
vi.mock("../newThreadTarget", () => ({ resolveNewThreadTarget: () => ({ kind: "full" }) }));
vi.mock("../commandPaletteBus", () => ({ openCommandPalette: () => undefined }));
vi.mock("./useScratchProject", () => ({
  createScratchProjectActions: ({
    handleNewThread,
  }: {
    handleNewThread: (ref: unknown) => Promise<unknown>;
  }) => ({
    startScratchThread: (environmentId: string) =>
      handleNewThread({ environmentId, projectId: "project-remote" }),
  }),
}));

import { useNewThreadHandler } from "./useHandleNewThread";
import { startNewThreadInMember, startNewThreadInSidebarFilter } from "../newThreadActions";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      projectId: "project-remote",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("sets the prompt before the draft shows", async () => {
    testState.reset(draft);
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { prompt: "Read the playbook. " },
    );

    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    expect(testState.draftStore.setPrompt).toHaveBeenCalledWith(
      opened?.draftId,
      "Read the playbook. ",
    );
    expect(testState.draftStore.setPrompt.mock.invocationCallOrder[0]).toBeLessThan(
      testState.router.navigate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("abandons a delayed draft open when the project is removed meanwhile", async () => {
    testState.reset(draft);
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.removeProject();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });
});

describe("useNewThreadHandler", () => {
  it.each([
    [{ groupCount: 1 }, false, "/draft/draft-delayed"],
    [{ groupCount: 0 }, false, "/draft/draft-delayed"],
    [{ boringSidebarEnabled: true }, false, "/"],
    [{ groupCount: 2 }, false, "/"],
    [{ boringSidebarEnabled: true }, true, "/"],
  ] as const)(
    "retains the upstream unfiltered policy with %j and allProjects=%s",
    async (settings, allProjects, destination) => {
      testState.reset(null);
      testState.configureStart(settings);
      await startNewThreadInSidebarFilter(useNewThreadHandler(), {
        allProjects,
        currentProject: {
          activeDraftThread: null,
          activeThread: { environmentId: "environment-ssh", projectId: "project-remote" },
          defaultProjectRef: null,
        },
      } as never);
      expect(testState.router.state.location.href).toBe(destination);
    },
  );

  it("starts a filtered scratch member through No project without pinning its draft", async () => {
    testState.reset(null);
    testState.configureStart({ scratch: true });
    await startNewThreadInMember(useNewThreadHandler(), {
      environmentId: "environment-ssh",
      id: "project-remote",
    } as never);
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      { environmentId: "environment-ssh", projectId: "project-remote" },
      "draft-delayed",
      expect.not.objectContaining({ environmentSelection: "manual" }),
    );
  });
  it.each([
    ["same member", "environment-ssh", "project-remote", "draft-existing"],
    ["another machine", "environment-primary", "project-remote", "draft-delayed"],
    ["another clone", "environment-ssh", "project-clone", "draft-delayed"],
  ])(
    "starts in the exact member with an empty draft for %s",
    async (_, environmentId, projectId, expectedDraftId) => {
      testState.reset({
        draftId: "draft-existing",
        environmentId,
        projectId,
        promotedTo: null,
        threadId: "thread-existing",
      });

      const opened = await useNewThreadHandler()(
        { environmentId: "environment-ssh", projectId: "project-remote" } as never,
        { exactProject: true },
      );

      expect(opened?.draftId).toBe(expectedDraftId);
      expect(testState.router.navigate).toHaveBeenCalledWith({
        to: "/draft/$draftId",
        params: { draftId: expectedDraftId },
        replace: false,
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        { environmentId: "environment-ssh", projectId: "project-remote" },
        expectedDraftId,
        expect.objectContaining({
          envMode: "local",
          runtimeMode: "full-access",
          environmentSelection: "manual",
          loadBalancedEnvironmentId: null,
        }),
      );
    },
  );

  it("finds an empty exact-member draft behind a populated draft", async () => {
    testState.reset({
      draftId: "draft-populated",
      environmentId: "environment-ssh",
      projectId: "project-remote",
      promotedTo: null,
      threadId: "thread-populated",
    });
    testState.giveUserText("draft-populated");
    testState.addDraft({
      draftId: "draft-empty",
      environmentId: "environment-ssh",
      projectId: "project-remote",
      promotedTo: null,
      threadId: "thread-empty",
    });

    const opened = await useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { exactProject: true },
    );

    expect(opened).toEqual({ draftId: "draft-empty", threadId: "thread-empty" });
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "draft-populated",
      expect.anything(),
    );
  });

  it("reuses an exact-member draft registered while project defaults resolve", async () => {
    testState.reset(null, { envMode: null, startFromOrigin: false });
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { exactProject: true },
    );
    testState.addDraft({
      draftId: "draft-raced",
      environmentId: "environment-ssh",
      projectId: "project-remote",
      promotedTo: null,
      threadId: "thread-raced",
    });
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toEqual({
      draftId: "draft-raced",
      threadId: "thread-raced",
    });
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      { environmentId: "environment-ssh", projectId: "project-remote" },
      "draft-raced",
      expect.objectContaining({
        environmentSelection: "manual",
        loadBalancedEnvironmentId: null,
      }),
    );
  });

  it("keeps the text of a draft that gained some while it waited", async () => {
    testState.reset(null);
    const raced = {
      draftId: "draft-raced",
      environmentId: "environment-ssh",
      projectId: "project-remote",
      promotedTo: null,
      threadId: "thread-raced",
    };
    testState.draftStore.getDraftSessionByLogicalProjectKey
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(raced as never);
    testState.giveUserText("draft-raced");

    const opened = await useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { prompt: "Read the playbook. " },
    );

    expect(opened?.draftId).toBe("draft-raced");
    expect(testState.draftStore.setPrompt).not.toHaveBeenCalled();
  });

  it("seeds the prompt into the empty draft that is already open", async () => {
    testState.reset(null);
    testState.openEmptyDraft("draft-open");

    const opened = await useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { prompt: "Read the playbook. " },
    );

    expect(opened?.draftId).toBe("draft-open");
    expect(testState.draftStore.setPrompt).toHaveBeenCalledWith(
      "draft-open",
      "Read the playbook. ",
    );
  });

  it("opens the draft without waiting on a project file from an offline machine", async () => {
    testState.reset(null, { envMode: null, startFromOrigin: false });
    testState.disconnect("environment-ssh");

    const opened = await useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);

    expect(opened).toEqual({ draftId: "draft-delayed", threadId: "thread-delayed" });
    expect(testState.router.navigate).toHaveBeenCalledOnce();
  });
});
