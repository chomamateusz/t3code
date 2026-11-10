import { threadKey } from "@t3tools/client-runtime/state/entities";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking as isSidebarThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import * as DateTime from "effect/DateTime";
import { deriveActiveWorkStartedAt } from "../session-logic.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  shouldCreateNewThreadInCurrentProject,
  deleteSelectedThreadEntries,
  getFallbackThreadIdAfterDelete,
  hasUnseenCompletion,
  resolveSidebarRowThreadId,
  orderItemsByPreferredIds,
  pinOrderKeyBetween,
  resolveSidebarSweepKeys,
  resolveSidebarThreadStatus,
  resolveSidebarThreadTopStatus,
  resolveSidebarThreadReadAction,
  buildSidebarProjectBadges,
  countSidebarProjectBadgeThreads,
  sidebarBadgeWakeClock,
  combineSidebarProjectBadges,
  summarizeSidebarProjectBadge,
  sameSidebarProjectBadges,
  sameSidebarProjectBadgeThreads,
  resolveThreadStatusPill,
  resolveWorkingStartedAt,
  searchSidebarThreads,
  shouldRecedeSidebarThread,
  sortInboxThreadsByReturn,
  resolveSidebarDropTarget,
  resolveSidebarFolderDropTarget,
  resolveSidebarDropWrites,
  sidebarMarkerId,
  planSidebarThreadDrop,
  resolveSidebarReorderableThreadKeys,
  sortPinnedThreadsForSidebar,
  sortScopedProjectsForSidebar,
  sortSidebarV2ProjectGroups,
  shouldNavigateAfterThreadPark,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
  resolveSidebarDropVerb,
  groupSidebarThreadsByProject,
  sidebarFolderExpansionKeys,
  resolveSidebarFolderToggle,
} from "./Sidebar.logic";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
} from "@t3tools/client-runtime/state/thread-sort";
import { resolveProjectExpanded } from "../uiStateStore";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";
import { makeThreadFixture, type ThreadFixtureOverrides } from "../test-fixtures";
import {
  completeSidebarRouteReveal,
  pendingSidebarRouteReveal,
  resolveSidebarRouteReveal,
} from "./sidebar/routeReveal";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("deleteSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = AsyncResult.success(undefined);
  const failure = AsyncResult.failure(Cause.fail(new Error("Delete failed")));
  const interrupted = AsyncResult.failure(Cause.interrupt());

  it("waits for each delete and excludes only earlier successes from worktree checks", async () => {
    let resolveDelete!: (result: typeof success) => void;
    const pendingDelete = new Promise<typeof success>((resolve) => {
      resolveDelete = resolve;
    });
    const worktreeChecks: { threadKey: string; deletedThreadKeys: string[] }[] = [];
    const deletion = deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }, deletedThreadKeys) => {
        worktreeChecks.push({ threadKey, deletedThreadKeys: [...deletedThreadKeys] });
        return threadKey === "one" ? pendingDelete : success;
      },
    });

    expect(worktreeChecks).toEqual([{ threadKey: "one", deletedThreadKeys: [] }]);
    resolveDelete(success);
    const outcome = await deletion;

    expect(worktreeChecks).toEqual([
      { threadKey: "one", deletedThreadKeys: [] },
      { threadKey: "two", deletedThreadKeys: ["one"] },
      { threadKey: "three", deletedThreadKeys: ["one", "two"] },
    ]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["one", "two", "three"]),
      firstFailure: null,
    });
  });

  it("continues after ordinary failures and keeps the first failure", async () => {
    const laterFailure = AsyncResult.failure(Cause.fail(new Error("Later failure")));
    const deletedKeysAtLastEntry: string[][] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries: [...entries, { threadKey: "four" }],
      delete: async ({ threadKey }, deletedThreadKeys) => {
        if (threadKey === "one") return failure;
        if (threadKey === "three") return laterFailure;
        if (threadKey === "four") deletedKeysAtLastEntry.push([...deletedThreadKeys]);
        return success;
      },
    });

    expect(deletedKeysAtLastEntry).toEqual([["two"]]);
    expect(outcome).toEqual({
      deletedThreadKeys: new Set(["two", "four"]),
      firstFailure: failure,
    });
  });

  it.each([
    { firstResult: success, deletedThreadKeys: new Set(["one"]), firstFailure: null },
    { firstResult: failure, deletedThreadKeys: new Set<string>(), firstFailure: failure },
  ])("stops on interruption and preserves earlier results %#", async (testCase) => {
    const attemptedThreadKeys: string[] = [];
    const outcome = await deleteSelectedThreadEntries({
      entries,
      delete: async ({ threadKey }) => {
        attemptedThreadKeys.push(threadKey);
        return threadKey === "one" ? testCase.firstResult : interrupted;
      },
    });

    expect(attemptedThreadKeys).toEqual(["one", "two"]);
    expect(outcome).toEqual({
      deletedThreadKeys: testCase.deletedThreadKeys,
      firstFailure: testCase.firstFailure,
    });
  });
});

describe("sidebar thread lineage helpers", () => {
  it("maps an open subagent to its nearest visible ancestor's sidebar row", () => {
    const environmentId = EnvironmentId.make("environment-row");
    const otherEnvironmentId = EnvironmentId.make("environment-other");
    const subagentOf = (id: string, parentId: ThreadId, environment = environmentId) =>
      makeThreadFixture({
        id: ThreadId.make(id),
        environmentId: environment,
        lineage: {
          rootThreadId: parentId,
          parentThreadId: parentId,
          relationshipToParent: "subagent",
        },
      });
    const root = makeThreadFixture({ id: ThreadId.make("thread-root"), environmentId });
    const fork = makeThreadFixture({
      id: ThreadId.make("thread-fork"),
      environmentId,
      lineage: {
        rootThreadId: root.id,
        parentThreadId: root.id,
        relationshipToParent: "fork",
      },
    });
    const child = subagentOf("thread-child", root.id);
    const grandchild = subagentOf("thread-grandchild", child.id);
    const forkChild = subagentOf("thread-fork-child", fork.id);
    const orphan = subagentOf("thread-orphan", ThreadId.make("thread-missing"));
    const elsewhere = subagentOf("thread-elsewhere", root.id, otherEnvironmentId);
    const threads = [root, fork, child, grandchild, forkChild, orphan, elsewhere];

    expect(resolveSidebarRowThreadId(child.id, environmentId, threads)).toBe(root.id);
    expect(resolveSidebarRowThreadId(grandchild.id, environmentId, threads)).toBe(root.id);
    expect(resolveSidebarRowThreadId(forkChild.id, environmentId, threads)).toBe(fork.id);
    expect(resolveSidebarRowThreadId(elsewhere.id, otherEnvironmentId, threads)).toBe(elsewhere.id);
    expect(resolveSidebarRowThreadId(orphan.id, environmentId, threads)).toBe(orphan.id);
    const loopA = subagentOf("thread-loop-a", ThreadId.make("thread-loop-b"));
    const loopB = subagentOf("thread-loop-b", loopA.id);
    expect(resolveSidebarRowThreadId(loopA.id, environmentId, [loopA, loopB])).toBe(loopA.id);
  });
});

function makeLatestRun(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): NonNullable<Thread["latestRun"]> {
  return {
    runId: "turn-1" as never,
    status: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt:
      overrides?.startedAt !== undefined ? overrides.startedAt : "2026-03-09T10:00:00.000Z",
    completedAt:
      overrides?.completedAt !== undefined ? overrides.completedAt : "2026-03-09T10:05:00.000Z",
  };
}

describe("orderItemsByPreferredIds", () => {
  it("resolves legacy preference aliases without materializing project state", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: "physical-a", cwd: "/work/a" },
        { id: "physical-b", cwd: "/work/b" },
        { id: "physical-c", cwd: "/work/c" },
      ],
      preferredIds: ["legacy:/work/c", "legacy:/work/a"],
      getId: (project) => project.id,
      getPreferenceIds: (project) => [project.id, `legacy:${project.cwd}`],
    });

    expect(ordered.map((project) => project.id)).toEqual([
      "physical-c",
      "physical-a",
      "physical-b",
    ]);
  });
});

describe("resolveSidebarThreadStatus", () => {
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };

  const idle = { hasPendingApprovals: false, hasPendingUserInput: false, runtime: null };

  it("prioritizes awaiting input over a running runtime, below approval", () => {
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingUserInput: true,
        runtime,
        blockedOnThreadWait: true,
      }),
    ).toBe("input");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        blockedOnThreadWait: true,
        runtime,
      }),
    ).toBe("approval");
  });

  it("shows a waiting guest message as a Request, below the agent's own requests", () => {
    expect(resolveSidebarThreadStatus({ ...idle, pendingGuestMessageCount: 1, runtime })).toBe(
      "request",
    );
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        hasPendingUserInput: true,
        pendingGuestMessageCount: 1,
      }),
    ).toBe("input");
  });

  it("keeps usage-limit stops Limited and visible until the thread recovers", () => {
    const limited = {
      ...runtime,
      status: "failed" as const,
      lastError: "Plan limit reached",
      lastErrorClass: "usage_limit" as const,
    };
    expect(resolveSidebarThreadStatus({ ...idle, runtime: limited })).toBe("limited");
    expect(
      resolveSidebarThreadStatus({ ...idle, runtime: { ...limited, status: "running" } }),
    ).toBe("working");
    expect(
      resolveSidebarThreadStatus({ ...idle, runtime: { ...limited, status: "completed" } }),
    ).toBe("ready");
    expect(
      shouldRecedeSidebarThread({
        status: "limited",
        isUnread: false,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(false);
  });

  it("reports worktree setup as preparing, and failed only while the latest run failed", () => {
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "preparing" as const },
      }),
    ).toBe("preparing");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "failed" as const, lastError: "boom" },
      }),
    ).toBe("failed");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "completed" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
    expect(
      resolveSidebarThreadStatus({
        ...idle,
        runtime: { ...runtime, status: "idle" as const, lastError: "persisted" },
      }),
    ).toBe("waiting");
  });
});

describe("searchSidebarThreads", () => {
  const searchThread = (id: string, title: string, latestUserMessageAt: string) => ({
    environmentId: localEnvironmentId,
    id: ThreadId.make(id),
    title,
    branch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: latestUserMessageAt,
    latestUserMessageAt,
    opens: null,
  });
  const threads = [
    searchThread("thread-1", "Fix workspace search", "2026-10-20T00:00:00.000Z"),
    searchThread("thread-2", "Review providers", "2026-10-22T00:00:00.000Z"),
    searchThread("thread-3", "WORKTREE cleanup", "2026-09-01T00:00:00.000Z"),
    searchThread("thread-4", "Homework notes", "2026-10-22T00:00:00.000Z"),
  ];
  const now = Date.parse("2026-10-23T00:00:00.000Z");
  const contentKeys = (...ids: ReadonlyArray<string>) =>
    new Set(
      ids.map((id) =>
        threadSearchMatchKey({ environmentId: localEnvironmentId, threadId: ThreadId.make(id) }),
      ),
    );

  it("ranks word matches by recent use, then lists message matches once", () => {
    expect(searchSidebarThreads(threads, "work", contentKeys("thread-1", "thread-2"), now)).toEqual(
      {
        titleMatches: [threads[0], threads[2], threads[3]],
        contentMatches: [threads[1]],
      },
    );
  });
});

describe("resolveWorkingStartedAt", () => {
  const runtime = {
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    activeRunId: RunId.make("turn-1"),
    lastError: null,
    updatedAt: "2026-03-09T10:02:00.000Z",
  };

  it("does not invent a start from activity updates when the newest run completed", () => {
    expect(
      resolveWorkingStartedAt({
        latestRun: makeLatestRun(),
        runtime,
      }),
    ).toBeNull();
  });

  it.each(["queued", "cancelled"] as const)(
    "shares the detail timer when a newer run is %s",
    (status) => {
      const activityStartedAt = "2026-03-09T10:00:00.000Z";
      const latestRun = {
        ...makeLatestRun(),
        runId: RunId.make("newer-run"),
        status,
        startedAt: null,
        completedAt: status === "queued" ? null : "2026-03-09T10:05:00.000Z",
      };
      for (const updatedAt of ["2026-03-09T10:30:00.000Z", "2026-03-09T10:50:00.000Z"]) {
        const activeRuntime = { ...runtime, updatedAt, activityStartedAt };
        expect(resolveWorkingStartedAt({ latestRun, runtime: activeRuntime })).toBe(
          activityStartedAt,
        );
        expect(deriveActiveWorkStartedAt(latestRun, activeRuntime, updatedAt)).toBe(
          activityStartedAt,
        );
      }
      expect(
        deriveActiveWorkStartedAt(
          latestRun,
          { ...runtime, activityStartedAt: null },
          "2026-03-09T10:50:00.000Z",
        ),
      ).toBeNull();
    },
  );
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "plan" as const,
    latestRun: null,
    lastVisitedAt: undefined,
    runtime: {
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      activeRunId: "turn-1" as never,
      lastError: null,
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  };

  it("shows an active thread wait without a pulse and resumes Working when it ends", () => {
    const blocked = { ...baseThread, blockedOnThreadWait: true };
    expect(resolveSidebarThreadStatus(blocked)).toBe("waiting");
    expect(resolveThreadStatusPill({ thread: blocked })).toMatchObject({
      label: "Waiting",
      pulse: false,
    });

    const resumed = { ...blocked, blockedOnThreadWait: false };
    expect(resolveSidebarThreadStatus(resumed)).toBe("working");
    expect(resolveThreadStatusPill({ thread: resumed })).toMatchObject({
      label: "Working",
      pulse: true,
    });
  });

  it("shows waiting for an idle thread with pending background tasks", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          pendingBackgroundTasks: [
            { taskId: "bg-1", description: "Watch build", kind: "monitor", awaited: true },
          ],
          runtime: {
            ...baseThread.runtime,
            status: "idle",
            activeRunId: null,
          },
        },
      }),
    ).toMatchObject({
      label: "Waiting",
      colorClass: "text-sidebar-muted-foreground",
      dotClass: "bg-sidebar-muted-foreground",
      pulse: false,
    });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasActionableProposedPlan: true,
          latestRun: makeLatestRun(),
          runtime: {
            ...baseThread.runtime,
            status: "completed",
            activeRunId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not manufacture completed state without a client visit marker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestRun: makeLatestRun(),
          runtime: {
            ...baseThread.runtime,
            status: "completed",
            activeRunId: null,
          },
        },
      }),
    ).toBeNull();
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestRun: makeLatestRun(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          runtime: {
            ...baseThread.runtime,
            status: "completed",
            activeRunId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows failed, not completed, when the unseen run failed", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          runtime: {
            ...baseThread.runtime,
            status: "failed",
            activeRunId: null,
            lastError: "Provider turn failed.",
          },
        },
      }),
    ).toMatchObject({ label: "Failed", pulse: false });
  });

  it("shows failed, not plan ready, when a plan run proposed a plan and then failed", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasActionableProposedPlan: true,
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          runtime: { ...baseThread.runtime, status: "failed", activeRunId: null },
        },
      }),
    ).toMatchObject({ label: "Failed" });
  });

  it("drops the failed pill once the failure has been seen", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestRun: { ...makeLatestRun(), status: "failed" },
          lastVisitedAt: "2026-03-09T10:06:00.000Z",
          runtime: { ...baseThread.runtime, status: "failed", activeRunId: null },
        },
      }),
    ).toBeNull();
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.make("project-1"),
    environmentId: localEnvironmentId,
    title: "Project",
    workspaceRoot: "/tmp/project",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...rest,
  };
}

function makeThread(overrides: ThreadFixtureOverrides = {}): Thread {
  return makeThreadFixture({
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    runtime: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestRun: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  });
}

describe("getFallbackThreadIdAfterDelete", () => {
  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-next"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      deletedThreadIds: new Set([ThreadId.make("thread-active"), ThreadId.make("thread-newest")]),
      sortOrder: "created_at",
      now: "2026-03-09T10:10:00.000Z",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-next"));
  });

  it.each([
    [
      "snoozed",
      { snoozedUntil: "2099-01-01T00:00:00.000Z", snoozedAt: "2026-03-09T10:06:00.000Z" },
    ],
    ["settled", { settledOverride: "settled", settledAt: "2026-03-09T10:06:00.000Z" }],
  ] as const)("skips a %s thread parked on its shelf", (_state, parked) => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-visible"),
          createdAt: "2026-03-09T10:01:00.000Z",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-parked"),
          createdAt: "2026-03-09T10:02:00.000Z",
          updatedAt: "2026-03-09T10:06:00.000Z",
          ...parked,
        }),
        makeThread({
          id: ThreadId.make("thread-active"),
          createdAt: "2026-03-09T10:03:00.000Z",
          updatedAt: "2026-03-09T10:03:00.000Z",
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      sortOrder: "created_at",
      now: "2026-03-09T10:10:00.000Z",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-visible"));
  });
});

describe("sortScopedProjectsForSidebar", () => {
  it("keeps identical project ids in different environments separate", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const sharedProjectId = ProjectId.make("shared-project");
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: sharedProjectId,
        title: "Local project",
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: sharedProjectId,
        title: "Remote project",
      }),
    ];
    const threads = [
      makeThread({
        environmentId: localEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual(["Remote project", "Local project"]);
  });

  it("does not use archived threads as project activity", () => {
    const projects = [
      makeProject({
        id: ProjectId.make("project-visible"),
        title: "Visible project",
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeProject({
        id: ProjectId.make("project-archived"),
        title: "Archived-only project",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
    ];
    const threads = [
      makeThread({
        id: ThreadId.make("thread-visible"),
        projectId: ProjectId.make("project-visible"),
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-archived"),
        projectId: ProjectId.make("project-archived"),
        updatedAt: "2026-03-09T10:10:00.000Z",
        archivedAt: "2026-03-09T10:11:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual([
      "Visible project",
      "Archived-only project",
    ]);
  });
});

describe("sortSidebarV2ProjectGroups", () => {
  it("does not let a hidden subagent thread reorder projects", () => {
    const olderProjectId = ProjectId.make("project-older");
    const newerProjectId = ProjectId.make("project-newer");
    const olderRootThreadId = ThreadId.make("thread-older-root");
    const projects = [
      {
        ...makeProject({ id: olderProjectId, title: "A older project" }),
        projectKey: "logical-older",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: olderProjectId }],
      },
      {
        ...makeProject({ id: newerProjectId, title: "Z newer project" }),
        projectKey: "logical-newer",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: newerProjectId }],
      },
    ];
    const threads = [
      makeThread({
        id: olderRootThreadId,
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-newer-root"),
        projectId: newerProjectId,
        updatedAt: "2026-03-09T10:05:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-hidden-subagent"),
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
        lineage: {
          rootThreadId: olderRootThreadId,
          parentThreadId: olderRootThreadId,
          relationshipToParent: "subagent",
        },
      }),
    ];

    expect(
      sortSidebarV2ProjectGroups(projects, threads, "updated_at", new Set()).map(
        (project) => project.projectKey,
      ),
    ).toEqual(["logical-newer", "logical-older"]);
  });
});

describe("pinOrderKeyBetween", () => {
  it("stays strictly ordered under repeated top insertion", () => {
    let head: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const key: string = pinOrderKeyBetween(null, head)!;
      expect(key).not.toBeNull();
      if (head !== null) expect(key < head).toBe(true);
      keys.push(key);
      head = key;
    }
    expect(new Set(keys).size).toBe(100);
  });

  it("stays strictly ordered under repeated middle insertion", () => {
    let low = pinOrderKeyBetween(null, null)!;
    let high = pinOrderKeyBetween(low, null)!;
    for (let i = 0; i < 100; i += 1) {
      const key: string = pinOrderKeyBetween(low, high)!;
      expect(low < key && key < high).toBe(true);
      if (i % 2 === 0) low = key;
      else high = key;
    }
  });

  it("returns null for corrupt or out-of-order bounds instead of throwing", () => {
    expect(pinOrderKeyBetween("z", "a")).toBeNull();
    expect(pinOrderKeyBetween("A!", null)).toBeNull();
    expect(pinOrderKeyBetween(null, "ma")).toBeNull();
    expect(pinOrderKeyBetween("m", "m")).toBeNull();
  });
});

describe("sortPinnedThreadsForSidebar", () => {
  const pinnable = (input: { id: string; createdAt: string; pinOrderKey?: string | null }) => ({
    id: input.id,
    createdAt: input.createdAt,
    pinOrderKey: input.pinOrderKey ?? null,
  });

  it("sorts keyed threads by key ahead of keyless threads in creation order", () => {
    const sorted = sortPinnedThreadsForSidebar([
      pinnable({ id: "keyless-old", createdAt: "2026-03-09T08:00:00.000Z" }),
      pinnable({ id: "second", createdAt: "2026-03-09T09:00:00.000Z", pinOrderKey: "t" }),
      pinnable({ id: "keyless-new", createdAt: "2026-03-09T12:00:00.000Z" }),
      pinnable({ id: "first", createdAt: "2026-03-09T07:00:00.000Z", pinOrderKey: "g" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual([
      "first",
      "second",
      "keyless-new",
      "keyless-old",
    ]);
  });

  it("breaks equal keys by id so raced writes render identically everywhere", () => {
    const sorted = sortPinnedThreadsForSidebar([
      pinnable({ id: "b", createdAt: "2026-03-09T10:00:00.000Z", pinOrderKey: "m" }),
      pinnable({ id: "a", createdAt: "2026-03-09T11:00:00.000Z", pinOrderKey: "m" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });
});

describe("resolveSidebarSweepKeys", () => {
  const ordered = ["a", "b", "c", "d", "blocked"];
  const canSettle = (key: string) => key !== "blocked";

  it("leaves out rows that cannot settle and rows that left the list", () => {
    expect(resolveSidebarSweepKeys(ordered, "c", "blocked", canSettle)).toEqual(["c", "d"]);
    expect(resolveSidebarSweepKeys(ordered, "gone", "a", canSettle)).toEqual([]);
  });
});

describe("navigation after parking a thread", () => {
  it.each([
    ["settle", "settled", null, "thread", true],
    ["settle", "active", null, "thread", false],
    ["settle", "settled", null, "other-thread", false],
    ["snooze", null, "2099-01-01T00:00:00.000Z", "thread", true],
    ["snooze", null, null, "thread", false],
    ["snooze", null, "2026-09-12T09:00:00.000Z", "thread", false],
    ["snooze", null, "2099-01-01T00:00:00.000Z", "thread", false, true],
    ["snooze", null, "2099-01-01T00:00:00.000Z", "other-thread", false],
  ] as const)(
    "%s with state %s / %s on %s navigates: %s",
    (
      action,
      settledOverride,
      snoozedUntil,
      currentThreadKey,
      expected,
      hasPendingApprovals: boolean = false,
    ) => {
      expect(
        shouldNavigateAfterThreadPark({
          threadKey: "thread",
          currentThreadKey,
          action,
          now: "2026-09-12T10:00:00.000Z",
          thread: {
            settledOverride,
            snoozedUntil,
            snoozedAt: null,
            session: null,
            latestTurn: null,
            hasPendingApprovals,
            hasPendingUserInput: false,
          },
        }),
      ).toBe(expected);
    },
  );
});

describe("unseen completion with background work", () => {
  it.each([
    {
      roster: "dev server",
      task: { kind: "command" },
      status: "ready",
      receded: false,
      pill: "Completed",
    },
    {
      roster: "dev server watchdog",
      task: { kind: "monitor" },
      status: "ready",
      receded: false,
      pill: "Completed",
    },
    {
      roster: "awaited command",
      task: { kind: "command", awaited: true },
      status: "waiting",
      receded: true,
      pill: "Waiting",
    },
  ] as const)("presents a completed thread with a $roster roster", (expected) => {
    const thread = presentThreadShell(localEnvironmentId, {
      ...makeThreadFixture().source,
      latestRunId: RunId.make("run-background-completion"),
      status: "completed",
      latestRunCompletedAt: DateTime.makeUnsafe("2026-06-20T01:00:00.000Z"),
      lastVisitedAt: DateTime.makeUnsafe("2026-06-20T00:59:00.000Z"),
      pendingBackgroundTasks: [{ taskId: "background-work", ...expected.task }],
    });
    const status = resolveSidebarThreadStatus(thread);
    const isUnread = hasUnseenCompletion(thread);

    expect(isUnread).toBe(true);
    expect(status).toBe(expected.status);
    expect(
      shouldRecedeSidebarThread({
        status,
        isUnread,
        isWoke: false,
        isActive: false,
        isSelected: false,
      }),
    ).toBe(expected.receded);
    expect(isSidebarThreadWorking(thread)).toBe(expected.receded);
    expect(resolveThreadStatusPill({ thread })).toMatchObject({ label: expected.pill });
  });
});

describe("Working shelf (beta)", () => {
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };
  const backgroundTask = {
    taskId: "bg-1",
    description: "Watch build",
    kind: "monitor" as const,
    awaited: true as const,
  };
  const idle = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default" as const,
    latestRun: makeLatestRun(),
    runtime: null,
  };
  const waiting = {
    ...idle,
    runtime: { ...runtime, status: "idle" as const },
    pendingBackgroundTasks: [backgroundTask],
  };

  it("folds away running threads and threads waiting on background work only", () => {
    expect(isSidebarThreadWorking({ ...idle, runtime })).toBe(true);
    expect(isSidebarThreadWorking(waiting)).toBe(true);
    expect(isSidebarThreadWorking(idle)).toBe(false);
    expect(isSidebarThreadWorking({ ...idle, runtime, hasPendingApprovals: true })).toBe(false);
    expect(isSidebarThreadWorking({ ...idle, runtime, hasPendingUserInput: true })).toBe(false);
    expect(
      isSidebarThreadWorking({
        ...waiting,
        runtime: { ...runtime, status: "failed" as const, lastError: "boom" },
      }),
    ).toBe(false);
  });

  it("keeps a ready plan in the inbox while background work runs", () => {
    expect(
      isSidebarThreadWorking({
        ...waiting,
        interactionMode: "plan",
        hasActionableProposedPlan: true,
      }),
    ).toBe(false);
  });

  describe("sortInboxThreadsByReturn", () => {
    const thread = (
      id: string,
      input: { createdAt: string; completedAt?: string | null; unsettledAt?: string },
    ) => ({
      id: ThreadId.make(id),
      environmentId: localEnvironmentId,
      createdAt: input.createdAt,
      unsettledAt: input.unsettledAt ?? null,
      latestRun:
        input.completedAt === undefined
          ? null
          : { ...makeLatestRun({ completedAt: input.completedAt }), requestedAt: input.createdAt },
    });

    it("puts the thread that finished last on top, whatever its age", () => {
      const sorted = sortInboxThreadsByReturn([
        thread("new", { createdAt: "2026-03-09T11:00:00.000Z" }),
        thread("old-finished-now", {
          createdAt: "2026-03-01T09:00:00.000Z",
          completedAt: "2026-03-09T12:00:00.000Z",
        }),
        thread("reopened", {
          createdAt: "2026-03-02T09:00:00.000Z",
          unsettledAt: "2026-03-09T11:30:00.000Z",
        }),
      ]);
      expect(sorted.map((entry) => entry.id)).toEqual(["old-finished-now", "reopened", "new"]);
    });

    it("counts a return the server does not stamp, like an approval request", () => {
      const waiting = thread("asks-approval", {
        createdAt: "2026-03-09T09:00:00.000Z",
        completedAt: null,
      });
      const finished = thread("finished", {
        createdAt: "2026-03-09T09:30:00.000Z",
        completedAt: "2026-03-09T11:00:00.000Z",
      });
      expect(sortInboxThreadsByReturn([finished, waiting]).map((entry) => entry.id)).toEqual([
        "finished",
        "asks-approval",
      ]);
      expect(
        sortInboxThreadsByReturn([finished, waiting], (entry) =>
          entry === waiting ? Date.parse("2026-03-09T11:05:00.000Z") : undefined,
        ).map((entry) => entry.id),
      ).toEqual(["asks-approval", "finished"]);
    });
  });

  describe("dragging", () => {
    const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });
    const row = (key: string, section: SidebarSection): SidebarListItem => ({
      kind: "thread",
      key,
      section,
    });
    const items: readonly SidebarListItem[] = [
      marker("pinned-header"),
      row("p1", "pinned"),
      marker("pinned-divider"),
      row("a1", "active"),
      row("a2", "active"),
      marker("working-header"),
      row("w1", "working"),
      marker("settled-header"),
      row("s1", "settled"),
    ];

    it("never drops into the Working shelf, and keeps it out of the inbox order", () => {
      expect(resolveSidebarDropTarget(items, "a1", "w1")).toBeNull();
      expect(resolveSidebarDropTarget(items, "p1", "a2")).toEqual({
        section: "active",
        pinnedOrder: [],
        activeOrder: ["a1", "a2", "p1"],
      });
      expect(resolveSidebarDropVerb("active", "working")).toBeNull();
    });

    it.each([
      ["pinned", "p1"],
      ["active", "a2"],
      ["settled", "s1"],
    ] as const)(
      "does not move a Working thread into %s when its reference drag ends in the sidebar",
      (section, overKey) => {
        const target = resolveSidebarDropTarget(items, "w1", overKey);
        expect(target?.section).toBe(section);
        expect(
          planSidebarThreadDrop({
            activeKey: "w1",
            activeSection: "working",
            target: target!,
            pinnedOrder: ["p1"],
            pinnedKeysById: new Map([["p1", "m"]]),
            activeOrder: ["a1", "a2"],
            activeKeysById: new Map([
              ["a1", "f"],
              ["a2", "t"],
            ]),
            activeTimeOrdered: true,
          }),
        ).toEqual({ kind: "none" });
      },
    );

    it("arranges the rows it can write when another row's server cannot store an order", () => {
      const plan = planSidebarThreadDrop({
        activeKey: "a2",
        activeSection: "active",
        target: {
          section: "active",
          pinnedOrder: [],
          activeOrder: ["offline", "a2", "a1"],
        },
        pinnedOrder: [],
        pinnedKeysById: new Map(),
        activeOrder: ["offline", "a1", "a2"],
        activeKeysById: new Map([
          ["offline", null],
          ["a1", null],
          ["a2", null],
        ]),
        activeReorderableKeys: new Set(["a1", "a2"]),
      });
      expect(plan.kind).toBe("move-active");
      if (plan.kind !== "move-active") return;
      expect(plan.assignments.map(({ id }) => id)).toEqual(["a2", "a1"]);
      const [a2, a1] = plan.assignments.map(({ orderKey }) => orderKey);
      expect(a2! < a1!).toBe(true);

      const above = planSidebarThreadDrop({
        activeKey: "a2",
        activeSection: "active",
        target: { section: "active", pinnedOrder: [], activeOrder: ["a2", "offline"] },
        pinnedOrder: [],
        pinnedKeysById: new Map(),
        activeOrder: ["offline", "a2"],
        activeKeysById: new Map([
          ["offline", "m"],
          ["a2", "t"],
        ]),
        activeReorderableKeys: new Set(["a2"]),
      });
      expect(above.kind === "move-active" && above.assignments[0]!.orderKey < "m").toBe(true);
    });

    it("reorders a grouped card only within its folder, as the ungrouped list would store it", () => {
      const activeOrder = ["a1", "b1", "a2", "hidden", "b2", "a3"];
      const activeKeysById = new Map([
        ["a1", "c"],
        ["b1", "d"],
        ["a2", "f"],
        ["hidden", "h"],
        ["b2", "k"],
        ["a3", "m"],
      ]);
      const inFolder = (key: string, projectFolder: string): SidebarListItem => ({
        kind: "thread",
        key,
        section: "active",
        projectFolder,
      });
      const grouped: readonly SidebarListItem[] = [
        marker("pinned-header"),
        row("p1", "pinned"),
        marker("pinned-divider"),
        marker("active-placeholder"),
        inFolder("b1", "beta"),
        inFolder("b2", "beta"),
        inFolder("a1", "alpha"),
        inFolder("a2", "alpha"),
        inFolder("a3", "alpha"),
        marker("settled-header"),
        row("s1", "settled"),
      ];
      const flat: readonly SidebarListItem[] = [
        marker("pinned-header"),
        row("p1", "pinned"),
        marker("pinned-divider"),
        marker("active-placeholder"),
        ...activeOrder.map((key) => row(key, "active")),
        marker("settled-header"),
        row("s1", "settled"),
      ];
      const plan = (
        activeKey: string,
        target: Parameters<typeof planSidebarThreadDrop>[0]["target"],
      ) =>
        planSidebarThreadDrop({
          activeKey,
          activeSection: "active",
          target,
          pinnedOrder: ["p1"],
          pinnedKeysById: new Map([["p1", "m"]]),
          activeOrder,
          activeKeysById,
          activeReorderableKeys: new Set(activeOrder),
        });
      const folderDrop = (activeKey: string, overId: string) =>
        resolveSidebarFolderDropTarget(grouped, activeKey, overId, activeOrder);

      for (const [activeKey, groupedOver, flatOver] of [
        ["a3", "a1", "a1"],
        ["a1", "a2", "a2"],
        ["a1", "a3", "a3"],
        ["b2", "b1", "b1"],
      ] as const) {
        const folderPlan = plan(activeKey, folderDrop(activeKey, groupedOver)!);
        expect(folderPlan.kind).toBe("move-active");
        expect(folderPlan).toEqual(
          plan(activeKey, resolveSidebarDropTarget(flat, activeKey, flatOver)!),
        );
      }
      expect(plan("a3", folderDrop("a3", "a1")!)).toMatchObject({
        order: ["a3", "a1", "b1", "a2", "hidden", "b2"],
        assignments: [{ id: "a3", orderKey: expect.any(String) }],
      });

      expect(plan("a2", folderDrop("a2", "a2")!)).toEqual({ kind: "none" });
      for (const overId of [
        "b1",
        "p1",
        "s1",
        "hidden",
        sidebarMarkerId("pinned-divider"),
        sidebarMarkerId("active-placeholder"),
        sidebarMarkerId("settled-header"),
      ]) {
        expect(folderDrop("a2", overId)).toBeNull();
      }
      expect(folderDrop("p1", "a1")).toBeNull();
      expect(folderDrop("s1", "a1")).toBeNull();
    });

    it("writes every planned key of a grouped drop, including threads of a collapsed folder", () => {
      const activeOrder = ["a1", "b1", "a2"];
      const grouped: readonly SidebarListItem[] = [
        marker("pinned-header"),
        marker("pinned-divider"),
        marker("active-placeholder"),
        { kind: "thread", key: "a1", section: "active", projectFolder: "alpha" },
        { kind: "thread", key: "a2", section: "active", projectFolder: "alpha" },
        marker("settled-header"),
        marker("settled-placeholder"),
      ];
      const plan = planSidebarThreadDrop({
        activeKey: "a2",
        activeSection: "active",
        target: resolveSidebarFolderDropTarget(grouped, "a2", "a1", activeOrder)!,
        pinnedOrder: [],
        pinnedKeysById: new Map(),
        activeOrder,
        activeKeysById: new Map(activeOrder.map((key) => [key, null])),
        activeReorderableKeys: new Set(activeOrder),
      });
      expect(plan).toMatchObject({ kind: "move-active", order: ["a2", "a1", "b1"] });
      const planned = plan.kind === "move-active" ? plan.assignments : [];
      const threadByKey = (keys: readonly string[]) => new Map(keys.map((key) => [key, { key }]));

      expect(resolveSidebarDropWrites(plan, threadByKey(activeOrder))).toEqual(
        planned.map(({ id, orderKey }) => ({ thread: { key: id }, orderKey })),
      );
      expect(planned.map(({ id }) => id).toSorted()).toEqual(["a1", "a2", "b1"]);
      expect(resolveSidebarDropWrites(plan, threadByKey(["a1", "a2"]))).toBeNull();
    });

    describe("reordering with cached offline configuration", () => {
      const onlineEnvironmentId = EnvironmentId.make("online");
      const offlineEnvironmentId = EnvironmentId.make("offline");
      const capabilities = {
        repositoryIdentity: true,
        threadPinning: true,
        threadPinReorder: true,
        threadActiveReorder: true,
      };
      const config = (environmentId: EnvironmentId) => ({
        environment: {
          environmentId,
          label: environmentId,
          platform: { os: "linux" as const, arch: "x64" as const },
          serverVersion: "0.1.1",
          capabilities,
        },
      });
      const serverConfigs = new Map([
        [onlineEnvironmentId, config(onlineEnvironmentId)],
        [offlineEnvironmentId, config(offlineEnvironmentId)],
      ]);
      const thread = (
        id: string,
        environmentId = onlineEnvironmentId,
        key: string | null = null,
      ) => ({
        id: ThreadId.make(id),
        environmentId,
        createdAt: `2026-03-09T${id === "offline" ? "12" : id === "online" ? "11" : "10"}:00:00.000Z`,
        activeOrderKey: key,
        pinOrderKey: key,
      });
      const keyOf = (entry: ReturnType<typeof thread>) =>
        scopedThreadKey(scopeThreadRef(entry.environmentId, entry.id));
      const online = thread("online");
      const offline = thread("offline", offlineEnvironmentId);
      const membership = (connectedEnvironmentIds = [onlineEnvironmentId]) =>
        resolveSidebarReorderableThreadKeys({
          threads: [online, offline],
          serverConfigs,
          connectedEnvironmentIds,
        });
      const planDrop = (input: {
        section: "active" | "pinned";
        rows: ReturnType<typeof thread>[];
        moved: ReturnType<typeof thread>;
        order: ReturnType<typeof thread>[];
        from?: "active" | "pinned";
        connectedEnvironmentIds?: EnvironmentId[];
      }) => {
        const writable = resolveSidebarReorderableThreadKeys({
          threads: input.rows,
          serverConfigs,
          connectedEnvironmentIds: input.connectedEnvironmentIds ?? [onlineEnvironmentId],
        });
        const sort = (rows: typeof input.rows) =>
          input.section === "active"
            ? sortActiveThreadsByOrderKey(rows)
            : sortPinnedThreadsByOrderKey(rows);
        const originalOrder = sort(input.rows).map(keyOf);
        const targetOrder = input.order.map(keyOf);
        const keysById = new Map(input.rows.map((entry) => [keyOf(entry), entry.activeOrderKey]));
        const plan = planSidebarThreadDrop({
          activeKey: keyOf(input.moved),
          activeSection: input.from ?? input.section,
          target: { section: input.section, pinnedOrder: targetOrder, activeOrder: targetOrder },
          pinnedOrder: originalOrder,
          activeOrder: originalOrder,
          pinnedKeysById: keysById,
          activeKeysById: keysById,
          reorderableKeys: writable.draggableThreadKeys,
          activeReorderableKeys: writable.activeReorderableThreadKeys,
        });
        const assignments =
          plan.kind === "move-active" || plan.kind === "reorder-pinned"
            ? plan.assignments
            : plan.kind === "pin"
              ? [
                  ...plan.extraAssignments,
                  ...(plan.orderKey === undefined
                    ? []
                    : [{ id: keyOf(input.moved), orderKey: plan.orderKey }]),
                ]
              : [];
        const assignedKeys = new Map(assignments.map(({ id, orderKey }) => [id, orderKey]));
        const actualOrder = sort(
          input.rows.map((entry) => ({
            ...entry,
            activeOrderKey: assignedKeys.get(keyOf(entry)) ?? entry.activeOrderKey,
            pinOrderKey: assignedKeys.get(keyOf(entry)) ?? entry.pinOrderKey,
          })),
        ).map(keyOf);

        return { plan, assignments, actualOrder, targetOrder };
      };

      it("excludes cached capable offline rows from both writable sets", () => {
        const writable = membership();

        expect([...writable.draggableThreadKeys]).toEqual([keyOf(online)]);
        expect([...writable.activeReorderableThreadKeys]).toEqual([keyOf(online)]);
        expect(serverConfigs.has(offlineEnvironmentId)).toBe(true);
      });

      it("updates membership through disconnect, reconnect, and missing configuration", () => {
        expect(membership([]).draggableThreadKeys.size).toBe(0);
        const connected = membership([onlineEnvironmentId, offlineEnvironmentId]);
        expect(connected.draggableThreadKeys.size).toBe(2);
        expect(connected.activeReorderableThreadKeys.size).toBe(2);

        const changed = resolveSidebarReorderableThreadKeys({
          threads: [online, offline],
          connectedEnvironmentIds: [onlineEnvironmentId, offlineEnvironmentId],
          serverConfigs: new Map([[onlineEnvironmentId, config(onlineEnvironmentId)]]),
        });
        expect([...changed.draggableThreadKeys]).toEqual([keyOf(online)]);
        expect([...changed.activeReorderableThreadKeys]).toEqual([keyOf(online)]);
      });

      it.each(["active", "pinned"] as const)(
        "replans a disconnected drag source in %s",
        (section) => {
          const bound = thread("offline", offlineEnvironmentId, "m");
          const moved = thread("online", onlineEnvironmentId, "t");
          const input = { section, rows: [bound, moved], moved, order: [moved, bound] };
          expect(planDrop(input).plan.kind).toBe(
            section === "active" ? "move-active" : "reorder-pinned",
          );

          const disconnected = planDrop({ ...input, connectedEnvironmentIds: [] });

          expect(disconnected.plan).toEqual({ kind: "none" });
          expect(disconnected.assignments).toEqual([]);
        },
      );

      it.each(["active", "pinned"] as const)("preserves a keyed offline bound in %s", (section) => {
        const bound = thread("offline", offlineEnvironmentId, "m");
        const moved = thread("online", onlineEnvironmentId, "t");
        const result = planDrop({ section, rows: [bound, moved], moved, order: [moved, bound] });

        expect(result.plan.kind).toBe(section === "active" ? "move-active" : "reorder-pinned");
        expect(result.assignments.map(({ id }) => id)).toEqual([keyOf(moved)]);
        expect(result.actualOrder).toEqual(result.targetOrder);
      });

      it.each(["active", "pinned"] as const)(
        "rejects rebalancing a keyed offline bound in %s",
        (section) => {
          const bound = thread("offline", offlineEnvironmentId, "m");
          const neighbor = thread("neighbor");
          const result = planDrop({
            section,
            rows: [bound, online, neighbor],
            moved: online,
            order: [bound, neighbor, online],
          });

          expect(result.plan).toEqual({ kind: "none" });
          expect(result.assignments).toEqual([]);
        },
      );

      it.each(["active", "pinned"] as const)(
        "rejects crossing the frozen keyless boundary in %s",
        (section) => {
          const bound = {
            ...offline,
            createdAt:
              section === "active" ? "2026-03-09T12:00:00.000Z" : "2026-03-09T10:00:00.000Z",
          };
          const order = section === "active" ? [online, bound] : [bound, online];
          const result = planDrop({ section, rows: [bound, online], moved: online, order });

          expect(result.plan).toEqual({ kind: "none" });
          expect(result.assignments).toEqual([]);
        },
      );

      it.each(["active", "pinned"] as const)(
        "allows realizable moves beside a frozen keyless row in %s",
        (section) => {
          const neighbor = thread("neighbor");
          const order =
            section === "active" ? [offline, neighbor, online] : [online, neighbor, offline];
          const result = planDrop({
            section,
            rows: [offline, online, neighbor],
            moved: online,
            order,
          });

          expect(result.plan.kind).toBe(section === "active" ? "move-active" : "reorder-pinned");
          expect(result.assignments.length).toBeGreaterThan(0);
          expect(result.assignments.every(({ id }) => id !== keyOf(offline))).toBe(true);
          expect(result.actualOrder).toEqual(result.targetOrder);
        },
      );

      it.each(["active", "pinned"] as const)(
        "checks fallback assignments to other rows at the %s boundary",
        (section) => {
          const neighbor = thread("neighbor");
          const order =
            section === "active" ? [neighbor, offline, online] : [online, offline, neighbor];
          const result = planDrop({
            section,
            rows: [offline, online, neighbor],
            moved: online,
            order,
          });

          expect(result.plan).toEqual({ kind: "none" });
        },
      );

      it.each(["active", "pinned"] as const)(
        "rejects impossible pin/unpin placement across the %s boundary",
        (section) => {
          const order = section === "active" ? [online, offline] : [offline, online];
          const result = planDrop({
            section,
            rows: [offline, online],
            moved: online,
            order,
            from: section === "active" ? "pinned" : "active",
          });

          expect(result.plan).toEqual({ kind: "none" });
        },
      );
    });

    it("only changes lifecycle when the inbox is time-ordered", () => {
      const base = {
        pinnedOrder: ["p1"],
        pinnedKeysById: new Map([["p1", "m"]]),
        activeOrder: ["a1", "a2"],
        activeKeysById: new Map([
          ["a1", "f"],
          ["a2", "t"],
        ]),
        activeTimeOrdered: true,
      };
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "a1",
          activeSection: "active",
          target: { section: "active", pinnedOrder: ["p1"], activeOrder: ["a2", "a1"] },
        }),
      ).toEqual({ kind: "none" });
      expect(
        planSidebarThreadDrop({
          ...base,
          activeKey: "p1",
          activeSection: "pinned",
          target: { section: "active", pinnedOrder: [], activeOrder: ["a1", "p1", "a2"] },
        }),
      ).toEqual({
        kind: "move-active",
        order: null,
        assignments: [],
        unpin: true,
        unsettle: false,
        unsnooze: false,
      });
    });
  });
});

describe("pendingSidebarRouteReveal", () => {
  it("keeps a revealed thread settled across a mount that reads no route params", () => {
    const reveal = { observedKey: null, pendingKey: null };
    expect(pendingSidebarRouteReveal(reveal, "env:a1")).toBe("env:a1");
    completeSidebarRouteReveal(reveal);

    // Back from Settings: location commits before the thread match does.
    expect(pendingSidebarRouteReveal(reveal, null)).toBeNull();
    expect(pendingSidebarRouteReveal(reveal, "env:a1")).toBeNull();

    expect(pendingSidebarRouteReveal(reveal, "env:b1")).toBe("env:b1");
  });

  it("keeps a pending reveal through a render without route params", () => {
    const reveal = { observedKey: null, pendingKey: null };
    pendingSidebarRouteReveal(reveal, "env:a1");
    expect(pendingSidebarRouteReveal(reveal, null)).toBeNull();
    expect(pendingSidebarRouteReveal(reveal, "env:a1")).toBe("env:a1");
  });
});

describe("resolveSidebarRouteReveal", () => {
  const scopedProjectKeys = new Set(["environment-test:project-scoped"]);
  const hidden = makeThreadFixture({ projectId: ProjectId.make("project-other") });
  const hiddenKey = "environment-test:thread-test";
  const findThread = (key: string) => (key === hiddenKey ? hidden : undefined);

  it.each([
    { projects: scopedProjectKeys, machine: null, project: true, environment: false },
    {
      projects: new Set(["environment-test:project-other", "environment-other:project-scoped"]),
      machine: new Set(["environment-other"]),
      project: false,
      environment: true,
    },
    {
      projects: scopedProjectKeys,
      machine: new Set(["environment-other"]),
      project: true,
      environment: true,
    },
    {
      projects: scopedProjectKeys,
      machine: new Set(["environment-test"]),
      project: true,
      environment: false,
    },
    { projects: null, machine: new Set(["environment-other"]), project: false, environment: true },
    {
      projects: null,
      machine: new Set(["environment-other", "environment-test"]),
      project: false,
      environment: false,
    },
    {
      projects: null,
      machine: new Set(["environment-other", "environment-third"]),
      project: false,
      environment: true,
    },
  ])(
    "widens only scopes hiding the opened thread: $project / $environment",
    ({ projects, machine, project, environment }) => {
      expect(
        resolveSidebarRouteReveal({
          reveal: { observedKey: "environment-test:other", pendingKey: null },
          routeKey: hiddenKey,
          isSearching: false,
          scopedProjectKeys: projects,
          scopedEnvironmentIds: machine,
          delegatedUnderParent: new Set(),
          findThread,
        }),
      ).toEqual({
        pendingKey: hiddenKey,
        widensProjectScope: project,
        widensEnvironmentScope: environment,
      });
    },
  );

  it.each(["archived", "delegated"] as const)("does not widen for a %s thread", (kind) => {
    expect(
      resolveSidebarRouteReveal({
        reveal: { observedKey: null, pendingKey: null },
        routeKey: hiddenKey,
        isSearching: false,
        scopedProjectKeys,
        scopedEnvironmentIds: new Set(["environment-other"]),
        delegatedUnderParent: new Set(
          kind === "delegated"
            ? [threadKey({ environmentId: hidden.environmentId, threadId: hidden.id })]
            : [],
        ),
        findThread: () =>
          kind === "archived" ? { ...hidden, archivedAt: "2026-10-30T00:00:00.000Z" } : hidden,
      }),
    ).toEqual({ pendingKey: hiddenKey, widensProjectScope: false, widensEnvironmentScope: false });
  });

  it("never widens for a thread whose reveal already completed", () => {
    // A remount's once-per-mount scroll must keep the scope the user chose.
    expect(
      resolveSidebarRouteReveal({
        reveal: { observedKey: hiddenKey, pendingKey: null },
        routeKey: hiddenKey,
        isSearching: false,
        scopedProjectKeys,
        scopedEnvironmentIds: new Set(["environment-other"]),
        delegatedUnderParent: new Set(),
        findThread,
      }),
    ).toEqual({ pendingKey: null, widensProjectScope: false, widensEnvironmentScope: false });
  });

  it("widens again for a thread reopened before the thread between them listed its row", () => {
    // The user scoped away from the open thread, then went to a thread whose row
    // never mounted, then came back.
    const reveal = { observedKey: hiddenKey, pendingKey: null };
    const resolve = (routeKey: string) =>
      resolveSidebarRouteReveal({
        reveal,
        routeKey,
        isSearching: false,
        scopedProjectKeys,
        scopedEnvironmentIds: new Set(["environment-other"]),
        delegatedUnderParent: new Set(),
        findThread,
      });
    resolve("environment-test:unlisted");
    expect(resolve(hiddenKey)).toEqual({
      pendingKey: hiddenKey,
      widensProjectScope: true,
      widensEnvironmentScope: true,
    });
  });

  it("holds a pending reveal without widening while searching", () => {
    expect(
      resolveSidebarRouteReveal({
        reveal: { observedKey: hiddenKey, pendingKey: hiddenKey },
        routeKey: hiddenKey,
        isSearching: true,
        scopedProjectKeys,
        scopedEnvironmentIds: new Set(["environment-other"]),
        delegatedUnderParent: new Set(),
        findThread,
      }),
    ).toEqual({ pendingKey: hiddenKey, widensProjectScope: false, widensEnvironmentScope: false });
  });
});

describe("sidebarFolderExpansionKeys", () => {
  it("honors a collapse the legacy sidebar saved under a member's cwd", () => {
    const keys = sidebarFolderExpansionKeys({
      projectKey: "github.com/pingdotgg/t3code",
      memberProjects: [{ physicalProjectKey: "local:/code/t3code", workspaceRoot: "/code/t3code" }],
    });
    const cwdKey = keys.at(-1)!;

    expect(resolveProjectExpanded({}, keys)).toBe(true);
    expect(resolveProjectExpanded({ [cwdKey]: false }, keys)).toBe(false);
    expect(resolveProjectExpanded({ [keys[0]!]: true, [cwdKey]: false }, keys)).toBe(true);
  });

  it("toggles one folder, or with all every folder to the clicked folder's new state", () => {
    const folder = (name: string) => ({
      projectKey: name,
      memberProjects: [
        { physicalProjectKey: `local:/code/${name}`, workspaceRoot: `/code/${name}` },
      ],
    });
    const open = folder("open");
    const closed = folder("closed");
    const other = folder("other");
    const folders = [open, closed, other];
    const state = { [sidebarFolderExpansionKeys(closed).at(-1)!]: false };
    const apply = (toggle: { readonly keys: readonly string[]; readonly expanded: boolean }) => {
      const next = {
        ...state,
        ...Object.fromEntries(toggle.keys.map((key) => [key, toggle.expanded])),
      };
      return folders.map((entry) =>
        resolveProjectExpanded(next, sidebarFolderExpansionKeys(entry)),
      );
    };

    expect(apply(resolveSidebarFolderToggle(state, open, folders, false))).toEqual([
      false,
      false,
      true,
    ]);
    expect(apply(resolveSidebarFolderToggle(state, closed, folders, false))).toEqual([
      true,
      true,
      true,
    ]);
    expect(apply(resolveSidebarFolderToggle(state, open, folders, true))).toEqual([
      false,
      false,
      false,
    ]);
    expect(apply(resolveSidebarFolderToggle(state, closed, folders, true))).toEqual([
      true,
      true,
      true,
    ]);
    expect(resolveSidebarFolderToggle(state, other, folders, true).keys).toEqual(
      folders.flatMap(sidebarFolderExpansionKeys),
    );
  });
});

describe("groupSidebarThreadsByProject", () => {
  it("puts each thread in its project's folder and drops empty projects unless kept", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const t3code = ProjectId.make("t3code");
    const t3codeRemote = ProjectId.make("t3code-remote");
    const fleet = ProjectId.make("fleet");
    const thread = (id: string, environmentId: EnvironmentId, projectId: ProjectId) => ({
      id,
      environmentId,
      projectId,
    });
    const groups = [
      {
        projectKey: "t3code",
        memberProjectRefs: [
          { environmentId: localEnvironmentId, projectId: t3code },
          { environmentId: remoteEnvironmentId, projectId: t3codeRemote },
        ],
      },
      {
        projectKey: "fleet",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: fleet }],
      },
      {
        projectKey: "notes",
        memberProjectRefs: [
          { environmentId: localEnvironmentId, projectId: ProjectId.make("notes") },
        ],
      },
    ];

    const threads = [
      thread("a", localEnvironmentId, t3code),
      thread("orphan", localEnvironmentId, ProjectId.make("deleted")),
      thread("b", remoteEnvironmentId, t3codeRemote),
    ];
    const summarize = (keepEmpty: (group: (typeof groups)[number]) => boolean) =>
      groupSidebarThreadsByProject(groups, threads, keepEmpty).map((folder) => ({
        projectKey: folder.group.projectKey,
        threads: folder.threads.map((entry) => entry.id),
      }));

    expect(summarize(() => true)).toEqual([
      { projectKey: "t3code", threads: ["a", "b"] },
      { projectKey: "fleet", threads: [] },
      { projectKey: "notes", threads: [] },
    ]);
    expect(summarize(() => false)).toEqual([{ projectKey: "t3code", threads: ["a", "b"] }]);
    // A pinned project keeps its empty folder while other empty projects drop out.
    expect(summarize((group) => group.projectKey === "fleet")).toEqual([
      { projectKey: "t3code", threads: ["a", "b"] },
      { projectKey: "fleet", threads: [] },
    ]);
  });
});

describe("shouldCreateNewThreadInCurrentProject", () => {
  it("opens the picker when several projects are open, or only archived ones exist", () => {
    expect(shouldCreateNewThreadInCurrentProject(false, 2, 3)).toBe(false);
    expect(shouldCreateNewThreadInCurrentProject(false, 0, 2)).toBe(false);
    expect(shouldCreateNewThreadInCurrentProject(false, 1, 3)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(false, 0, 0)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(true, 2, 2)).toBe(true);
  });
});

describe("sidebar project thread badges", () => {
  const now = "2026-03-09T10:10:00.000Z";
  const visited = "2026-03-09T10:04:00.000Z";
  const projectId = ProjectId.make("project-badge");
  const remoteId = EnvironmentId.make("remote-badge");
  const groups = [
    {
      projectKey: "logical-badge",
      memberProjectRefs: [
        { environmentId: localEnvironmentId, projectId },
        { environmentId: remoteId, projectId },
      ],
    },
    {
      projectKey: "other-badge",
      memberProjectRefs: [
        { environmentId: localEnvironmentId, projectId: ProjectId.make("other") },
      ],
    },
  ];
  const defaults = {
    now,
    loadedEnvironmentIds: new Set([localEnvironmentId, remoteId]),
    delegatedUnderParent: new Set<string>(),
  };
  const baseThread = () =>
    makeThreadFixture({
      environmentId: localEnvironmentId,
      projectId,
      runtime: null,
      latestRun: makeLatestRun(),
      lastVisitedAt: visited,
    });
  const runtime = {
    status: "running" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: now,
  };
  const states = () => [
    { ...baseThread(), hasPendingApprovals: true },
    { ...baseThread(), hasPendingUserInput: true },
    { ...baseThread(), pendingGuestMessageCount: 1 },
    { ...baseThread(), runtime: { ...runtime, status: "failed" as const } },
    {
      ...baseThread(),
      runtime: { ...runtime, status: "failed" as const, lastErrorClass: "usage_limit" as const },
    },
    { ...baseThread(), snoozedUntil: "2026-03-09T10:06:00.000Z" },
    baseThread(),
    { ...baseThread(), runtime },
  ];

  it("counts each top status once, with the row's urgency colors and a capped attention label", () => {
    const threads = states();
    const expected = [
      ["text-warning-foreground", 7],
      ["text-indigo-600 dark:text-indigo-300", 6],
      ["text-guest-foreground", 5],
      ["text-error-foreground", 4],
      ["text-warning-foreground", 3],
      ["text-warning-foreground", 2],
      ["text-success-foreground", 1],
      ["text-info-foreground", 0],
    ] as const;
    for (const [index, [className, count]] of expected.entries()) {
      const badges = buildSidebarProjectBadges(groups, threads.slice(index), { ...defaults });
      expect(summarizeSidebarProjectBadge(badges[0]!.counts)).toMatchObject({
        className,
        count,
        label: count === 0 ? null : String(count),
      });
    }
    const badge = buildSidebarProjectBadges(groups, threads, { ...defaults })[0]!;
    expect(badge.counts).toEqual({
      approval: 1,
      input: 1,
      request: 1,
      failed: 1,
      limited: 1,
      woke: 1,
      done: 1,
      working: 1,
    });
    expect(summarizeSidebarProjectBadge(badge.counts)?.description).toBe(
      "1 approval · 1 needs input · 1 request · 1 failed · 1 limited · 1 woke · 1 done · 1 working",
    );
    expect(
      summarizeSidebarProjectBadge({
        approval: 0,
        input: 0,
        request: 2,
        failed: 0,
        limited: 0,
        woke: 0,
        done: 0,
        working: 3,
      })?.entries,
    ).toEqual([
      { state: "request", count: 2, label: "requests", className: "text-guest-foreground" },
      { state: "working", count: 3, label: "working", className: "text-info-foreground" },
    ]);
    const many = buildSidebarProjectBadges(
      groups,
      Array.from({ length: 10 }, () => threads[0]!),
      { ...defaults },
    );
    expect(summarizeSidebarProjectBadge(many[0]!.counts)).toMatchObject({ count: 10, label: "9+" });
    expect(summarizeSidebarProjectBadge(many[1]!.counts)).toBeNull();
  });

  it("summarizes a closed folder's hidden threads with the project row badge", () => {
    const summarize = (threads: readonly ReturnType<typeof baseThread>[]) =>
      summarizeSidebarProjectBadge(countSidebarProjectBadgeThreads(threads, { now }));
    const seen = { ...baseThread(), lastVisitedAt: now };
    const done = baseThread();
    const working = { ...baseThread(), runtime };
    const limited = {
      ...baseThread(),
      runtime: { ...runtime, status: "failed" as const, lastErrorClass: "usage_limit" as const },
    };

    expect(summarize([seen])).toBeNull();
    // A waiting thread stays quiet even with an unread completion, like its row.
    expect(summarize([{ ...done, runtime: { ...runtime, status: "idle" as const } }])).toBeNull();
    expect(summarize([seen, working])).toMatchObject({
      count: 0,
      label: null,
      className: "text-info-foreground",
    });
    expect(summarize([working, done])).toMatchObject({
      count: 1,
      label: "1",
      className: "text-success-foreground",
      description: "1 done · 1 working",
    });
    expect(summarize([done, limited, working])).toMatchObject({
      count: 2,
      label: "2",
      className: "text-warning-foreground",
    });
  });

  it("excludes settled, archived, deleted and still-snoozed threads but counts early wakes", () => {
    const thread = baseThread();
    const badges = buildSidebarProjectBadges(
      groups,
      [
        { ...thread, settledOverride: "settled" },
        { ...thread, archivedAt: now },
        { ...thread, deletedAt: now },
        { ...thread, snoozedUntil: "2026-03-09T11:00:00.000Z" },
        { ...thread, snoozedUntil: "2026-03-09T11:00:00.000Z", hasPendingUserInput: true },
        { ...thread, hasPendingApprovals: true },
        { ...thread, runtime: { ...runtime, status: "idle" } },
      ],
      { ...defaults },
    );
    expect(badges[0]!.counts).toEqual({
      approval: 1,
      input: 1,
      request: 0,
      failed: 0,
      limited: 0,
      woke: 0,
      done: 0,
      working: 0,
    });
  });

  it.each([
    {
      name: "failed subagent",
      patch: {
        runtime: { ...runtime, status: "failed" as const },
        lineage: {
          rootThreadId: ThreadId.make("parent"),
          parentThreadId: ThreadId.make("parent"),
          relationshipToParent: "subagent" as const,
        },
      },
      delegated: false,
      loaded: true,
      expected: null,
    },
    {
      name: "failed side chat",
      patch: {
        runtime: { ...runtime, status: "failed" as const },
        lineage: {
          rootThreadId: ThreadId.make("parent"),
          parentThreadId: ThreadId.make("parent"),
          relationshipToParent: "fork" as const,
          sideChat: true,
        },
      },
      delegated: false,
      loaded: true,
      expected: null,
    },
    {
      name: "delegated input",
      patch: { hasPendingUserInput: true },
      delegated: true,
      loaded: true,
      expected: null,
    },
    {
      name: "snooze before config",
      patch: { snoozedUntil: "2026-03-09T11:00:00.000Z" },
      delegated: false,
      loaded: false,
      expected: { count: 1 },
    },
    {
      name: "snooze after config",
      patch: { snoozedUntil: "2026-03-09T11:00:00.000Z" },
      delegated: false,
      loaded: true,
      expected: null,
    },
  ])("matches row visibility for $name", ({ patch, delegated, loaded, expected }) => {
    const thread = { ...baseThread(), ...patch };
    const badges = buildSidebarProjectBadges(groups, [thread], {
      ...defaults,
      loadedEnvironmentIds: new Set(loaded ? [localEnvironmentId] : []),
      delegatedUnderParent: new Set(
        delegated ? [threadKey({ environmentId: thread.environmentId, threadId: thread.id })] : [],
      ),
    });
    const summary = summarizeSidebarProjectBadge(badges[0]!.counts);
    if (expected === null) expect(summary).toBeNull();
    else expect(summary).toMatchObject(expected);
  });

  it("combines logical project members only inside the machine scope, then sums overflow projects", () => {
    const threads = [
      states()[1]!,
      { ...baseThread(), environmentId: remoteId },
      { ...baseThread(), projectId: ProjectId.make("other"), runtime },
      { ...baseThread(), projectId: ProjectId.make("unrelated") },
    ];
    const all = buildSidebarProjectBadges(groups, threads, { ...defaults });
    expect(all[0]!.counts).toMatchObject({ input: 1, done: 1 });
    const local = buildSidebarProjectBadges(groups, threads, {
      ...defaults,
      environmentIds: new Set([localEnvironmentId]),
    });
    expect(local[0]!.counts).toMatchObject({ input: 1, done: 0 });
    expect(
      summarizeSidebarProjectBadge(combineSidebarProjectBadges(all.map((entry) => entry.counts))),
    ).toMatchObject({
      count: 2,
      className: "text-indigo-600 dark:text-indigo-300",
      description: "1 needs input · 1 done · 1 working",
    });
    expect(
      summarizeSidebarProjectBadge(combineSidebarProjectBadges([all[1]!.counts])),
    ).toMatchObject({ count: 0, label: null, className: "text-info-foreground" });
    expect(summarizeSidebarProjectBadge(combineSidebarProjectBadges([]))).toBeNull();
  });

  it("shares unread and wake precedence with rows and respects server visits over local fallback", () => {
    const thread = { ...baseThread(), snoozedUntil: "2026-03-09T10:06:00.000Z" };
    expect(
      resolveSidebarThreadTopStatus(thread, {
        lastVisitedAt: visited,
        wokeAt: thread.snoozedUntil,
      }),
    ).toMatchObject({ isUnread: true, isWoke: true, topStatus: { kind: "woke" } });
    expect(
      resolveSidebarThreadTopStatus(
        { ...thread, runtime },
        { lastVisitedAt: visited, wokeAt: thread.snoozedUntil },
      ).topStatus,
    ).toMatchObject({ kind: "working" });
    expect(
      resolveSidebarThreadTopStatus(
        { ...thread, settledOverride: "settled" },
        { lastVisitedAt: visited, wokeAt: thread.snoozedUntil },
      ).isWoke,
    ).toBe(false);
    const localLastVisitedAtById = {
      [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))]: now,
    };
    expect(
      buildSidebarProjectBadges(groups, [thread], { ...defaults, localLastVisitedAtById })[0]!
        .counts.woke,
    ).toBe(1);
    const { lastVisitedAt: _lastVisitedAt, ...legacyThread } = thread;
    expect(
      buildSidebarProjectBadges(groups, [legacyThread], { ...defaults, localLastVisitedAtById })[0]!
        .counts.woke,
    ).toBe(0);

    const stillSnoozed = { ...thread, snoozedUntil: "2026-03-09T11:00:00.000Z" };
    const earlierWake = { ...thread, snoozedUntil: "2026-03-09T10:05:00.000Z" };
    const badgeClock = sidebarBadgeWakeClock([earlierWake, thread, stillSnoozed], now);
    expect(badgeClock).toBe(thread.snoozedUntil);
    expect(countSidebarProjectBadgeThreads([thread], { now: badgeClock! }).woke).toBe(1);
    expect(sidebarBadgeWakeClock([stillSnoozed], now)).toBeNull();
  });

  const afterCompletion = "2026-03-09T10:05:30.000Z";
  const wake = "2026-03-09T10:06:00.000Z";
  it.each([
    {
      name: "an unseen completion",
      patch: {},
      lastVisitedAt: visited,
      wokeAt: null,
      expected: "mark-read",
    },
    {
      name: "a wake after the visit",
      patch: {},
      lastVisitedAt: afterCompletion,
      wokeAt: wake,
      expected: "mark-read",
    },
    {
      name: "a seen completion",
      patch: {},
      lastVisitedAt: afterCompletion,
      wokeAt: null,
      expected: "mark-unread",
    },
    { name: "a seen wake", patch: {}, lastVisitedAt: now, wokeAt: wake, expected: "mark-unread" },
    {
      name: "a settled wake",
      patch: { settledOverride: "settled" },
      lastVisitedAt: afterCompletion,
      wokeAt: wake,
      expected: "mark-unread",
    },
    {
      name: "a completion never opened",
      patch: {},
      lastVisitedAt: undefined,
      wokeAt: null,
      expected: "mark-unread",
    },
    {
      name: "no turn",
      patch: { latestRun: null },
      lastVisitedAt: visited,
      wokeAt: null,
      expected: null,
    },
    {
      name: "a first turn still running",
      patch: { latestRun: makeLatestRun({ completedAt: null }) },
      lastVisitedAt: visited,
      wokeAt: null,
      expected: null,
    },
    {
      name: "an unseen wake without a completed turn",
      patch: { latestRun: null },
      lastVisitedAt: visited,
      wokeAt: wake,
      expected: "mark-read",
    },
  ] as const)("offers $expected for $name", ({ patch, lastVisitedAt, wokeAt, expected }) => {
    expect(
      resolveSidebarThreadReadAction({ ...baseThread(), ...patch }, { lastVisitedAt, wokeAt }),
    ).toBe(expected);
  });

  it.each([
    ["environmentId", { environmentId: remoteId }],
    ["id", { id: ThreadId.make("changed") }],
    ["projectId", { projectId: ProjectId.make("changed") }],
    ["archivedAt", { archivedAt: now }],
    ["deletedAt", { deletedAt: now }],
    ["settledOverride", { settledOverride: "settled" }],
    ["snoozedAt", { snoozedAt: visited }],
    ["snoozedUntil", { snoozedUntil: now }],
    ["lastVisitedAt", { lastVisitedAt: now }],
    ["hasPendingApprovals", { hasPendingApprovals: true }],
    ["hasPendingUserInput", { hasPendingUserInput: true }],
    ["pendingSubagentRequest", { pendingSubagentRequest: "approval" }],
    ["pendingGuestMessageCount", { pendingGuestMessageCount: 1 }],
    ["blockedOnThreadWait", { blockedOnThreadWait: true }],
    [
      "lineage.relationshipToParent",
      { lineage: { ...baseThread().lineage!, relationshipToParent: "subagent" } },
    ],
    ["lineage.sideChat", { lineage: { ...baseThread().lineage, sideChat: true } }],
    ["runtime.status", { runtime: { ...runtime, status: "failed" } }],
    ["runtime.lastErrorClass", { runtime: { ...runtime, lastErrorClass: "usage_limit" } }],
    ["runtime.updatedAt", { runtime: { ...runtime, updatedAt: visited } }],
    ["latestRun.status", { latestRun: { ...makeLatestRun(), status: "failed" } }],
    ["latestRun.completedAt", { latestRun: makeLatestRun({ completedAt: now }) }],
    [
      "source.pendingRuntimeRequest",
      {
        source: {
          ...baseThread().source,
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("request"),
            kind: "permission",
            createdAt: DateTime.makeUnsafe(now),
          },
        },
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, Partial<Thread>]>)(
    "invalidates badge thread equality when %s changes",
    (_field, patch) => {
      const thread = { ...baseThread(), runtime, snoozedUntil: visited };
      expect(sameSidebarProjectBadgeThreads([thread], [{ ...thread }])).toBe(true);
      expect(sameSidebarProjectBadgeThreads([thread], [{ ...thread, ...patch }])).toBe(false);
    },
  );

  it("keeps equality for unrelated shell changes while observing every count", () => {
    const threads = states();
    const first = buildSidebarProjectBadges(groups, threads, { ...defaults });
    const renamed = buildSidebarProjectBadges(
      groups,
      threads.map((thread) => ({ ...thread, title: "changed" })),
      { ...defaults },
    );
    expect(sameSidebarProjectBadges(first, renamed)).toBe(true);
    for (const thread of threads) {
      expect(
        sameSidebarProjectBadges(
          first,
          buildSidebarProjectBadges(groups, [...threads, thread], { ...defaults }),
        ),
      ).toBe(false);
    }
    expect(sameSidebarProjectBadges(first, [...first].reverse())).toBe(false);
    const registry = AtomRegistry.make();
    const source = Atom.make(threads);
    const inputs = Atom.make((get) => get(source)).pipe(
      Atom.withEquality(sameSidebarProjectBadgeThreads),
    );
    const aggregate = vi.fn((get: Atom.AtomContext) =>
      buildSidebarProjectBadges(groups, get(inputs), defaults),
    );
    const badgesAtom = Atom.make(aggregate).pipe(Atom.withEquality(sameSidebarProjectBadges));
    const release = registry.mount(badgesAtom);
    try {
      const initial = registry.get(badgesAtom);
      registry.set(
        source,
        threads.map((thread) => ({
          ...thread,
          title: "renamed",
          updatedAt: now,
          source: { ...thread.source, title: "renamed" },
          runtime: thread.runtime === null ? null : { ...thread.runtime },
          latestRun: thread.latestRun === null ? null : { ...thread.latestRun },
        })),
      );
      expect(registry.get(badgesAtom)).toBe(initial);
      expect(aggregate).toHaveBeenCalledTimes(1);
      registry.set(source, [...threads, threads[0]!]);
      expect(registry.get(badgesAtom)[0]!.counts.approval).toBe(2);
      expect(aggregate).toHaveBeenCalledTimes(2);
    } finally {
      release();
      registry.dispose();
    }
  });
});
