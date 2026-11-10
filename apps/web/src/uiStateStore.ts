import { Debouncer } from "@tanstack/react-pacer";
import type { PullRequestMergeMethod } from "@t3tools/contracts";
import { create } from "zustand";

import {
  isSidebarProjectIconOrder,
  legacyProjectCwdPreferenceKey,
  revealSidebarProject,
  switchSidebarProjectMode,
  type SidebarProjectFilterMode,
  type SidebarProjectIconOrder,
  type SidebarProjectSelection,
} from "./sidebarProjectRow";

export const PERSISTED_STATE_KEY = "t3code:ui-state:v1";
const THREAD_CHANGED_FILES_EXPANSION_VERSION = 2;
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export interface PersistedUiState {
  projectExpandedById?: Record<string, boolean>;
  projectOrder?: string[];
  threadLastVisitedAtById?: Record<string, string>;
  collapsedProjectCwds?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  defaultAdvertisedEndpointKey?: string | null;
  sidebarProjectScopeKey?: string | null;
  sidebarProjectScopeKeys?: string[];
  sidebarEnvironmentScopeKey?: string | null;
  sidebarEnvironmentScopeKeys?: string[];
  sidebarProjectExcludeKeys?: string[];
  sidebarProjectFilterMode?: SidebarProjectFilterMode;
  sidebarProjectIconOrder?: SidebarProjectIconOrder;
  sidebarProjectScopesByEnvironment?: Record<string, SidebarProjectSelection>;
  threadChangedFilesExpansionVersion?: number;
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
  pullRequestMergeMethod?: string;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
  sidebarProjectScopeKeys: string[];
  sidebarEnvironmentScopeKeys: string[];
  sidebarProjectExcludeKeys: string[];
  sidebarProjectFilterMode: SidebarProjectFilterMode;
  sidebarProjectIconOrder: SidebarProjectIconOrder;
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
}

export interface UiEndpointState {
  defaultAdvertisedEndpointKey: string | null;
}

export interface UiPullRequestState {
  pullRequestMergeMethod: PullRequestMergeMethod;
}

export interface UiState
  extends UiProjectState, UiThreadState, UiEndpointState, UiPullRequestState {}

const initialState: UiState = {
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
};

const LEGACY_PROJECT_EXPANSION_DEFAULT_KEY = "legacy-project-expansion-default";
let legacyKeysCleanedUp = false;

export { legacyProjectCwdPreferenceKey };

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  ];
}

function sanitizeProjectScopes(value: unknown): Record<string, SidebarProjectSelection> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, selection]) => {
      if (!selection || typeof selection !== "object" || Array.isArray(selection)) return [];
      return [
        [
          key,
          {
            include: sanitizeStringArray("include" in selection ? selection.include : undefined),
            exclude: sanitizeStringArray("exclude" in selection ? selection.exclude : undefined),
          },
        ],
      ];
    }),
  );
}

function sanitizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => entry[0].length > 0 && typeof entry[1] === "boolean",
    ),
  );
}

function sanitizeOptionalKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeTimestampRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 &&
        typeof entry[1] === "string" &&
        entry[1].length > 0 &&
        Number.isFinite(Date.parse(entry[1])),
    ),
  );
}

function isPullRequestMergeMethod(value: unknown): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

export function parsePersistedState(parsed: PersistedUiState): UiState {
  const projectExpandedById =
    parsed.projectExpandedById === undefined
      ? (() => {
          const migrated: Record<string, boolean> = {};
          const collapsedProjectCwds = sanitizeStringArray(parsed.collapsedProjectCwds);
          const expandedProjectCwds = sanitizeStringArray(parsed.expandedProjectCwds);
          for (const cwd of collapsedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = false;
          }
          for (const cwd of expandedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = true;
          }
          if (!Array.isArray(parsed.collapsedProjectCwds) && expandedProjectCwds.length > 0) {
            migrated[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] = false;
          }
          return migrated;
        })()
      : sanitizeBooleanRecord(parsed.projectExpandedById);
  const projectOrder =
    parsed.projectOrder === undefined
      ? sanitizeStringArray(parsed.projectOrderCwds).map(legacyProjectCwdPreferenceKey)
      : sanitizeStringArray(parsed.projectOrder);

  const sidebarProjectScopesByEnvironment = sanitizeProjectScopes(
    parsed.sidebarProjectScopesByEnvironment,
  );
  const sidebarEnvironmentScopeKeys = sanitizeStringArray(
    parsed.sidebarEnvironmentScopeKeys ?? [parsed.sidebarEnvironmentScopeKey],
  );
  const topLevelSelection = {
    include: sanitizeStringArray(parsed.sidebarProjectScopeKeys ?? [parsed.sidebarProjectScopeKey]),
    exclude: sanitizeStringArray(parsed.sidebarProjectExcludeKeys),
  };
  const activeScopeKey = sidebarEnvironmentScopeStorageKey(sidebarEnvironmentScopeKeys) ?? "";
  const activeSelection = Object.hasOwn(sidebarProjectScopesByEnvironment, activeScopeKey)
    ? sidebarProjectScopesByEnvironment[activeScopeKey]
    : undefined;
  const sidebarProjectFilterMode =
    parsed.sidebarProjectFilterMode === "exclude" ? "exclude" : "include";
  const selection = [
    topLevelSelection,
    activeSelection,
    sidebarProjectScopesByEnvironment[""],
  ].find((candidate) => candidate && candidate[sidebarProjectFilterMode].length > 0);
  return {
    projectExpandedById,
    projectOrder,
    threadLastVisitedAtById: sanitizeTimestampRecord(parsed.threadLastVisitedAtById),
    threadChangedFilesExpandedById:
      parsed.threadChangedFilesExpansionVersion === THREAD_CHANGED_FILES_EXPANSION_VERSION
        ? sanitizePersistedThreadChangedFilesExpanded(parsed.threadChangedFilesExpandedById)
        : {},
    defaultAdvertisedEndpointKey: sanitizeOptionalKey(parsed.defaultAdvertisedEndpointKey),
    sidebarProjectScopeKeys:
      sidebarProjectFilterMode === "exclude"
        ? topLevelSelection.include
        : [...(selection?.include ?? [])],
    sidebarEnvironmentScopeKeys,
    sidebarProjectExcludeKeys:
      sidebarProjectFilterMode === "exclude"
        ? [...(selection?.exclude ?? [])]
        : topLevelSelection.exclude,
    sidebarProjectFilterMode,
    sidebarProjectIconOrder: isSidebarProjectIconOrder(parsed.sidebarProjectIconOrder)
      ? parsed.sidebarProjectIconOrder
      : initialState.sidebarProjectIconOrder,
    pullRequestMergeMethod: isPullRequestMergeMethod(parsed.pullRequestMergeMethod)
      ? parsed.pullRequestMergeMethod
      : initialState.pullRequestMergeMethod,
  };
}

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        return parsePersistedState(JSON.parse(legacyRaw) as PersistedUiState);
      }
      return initialState;
    }
    return parsePersistedState(JSON.parse(raw) as PersistedUiState);
  } catch {
    return initialState;
  }
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean") {
        nextTurns[turnId] = expanded;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const projectExpandedById = Object.fromEntries(
      Object.entries(state.projectExpandedById).filter(
        ([key]) => key !== LEGACY_PROJECT_EXPANSION_DEFAULT_KEY,
      ),
    );
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        projectExpandedById,
        projectOrder: state.projectOrder,
        threadLastVisitedAtById: state.threadLastVisitedAtById,
        defaultAdvertisedEndpointKey: state.defaultAdvertisedEndpointKey,
        sidebarProjectScopeKeys: state.sidebarProjectScopeKeys,
        // Older clients read only this field.
        sidebarProjectScopeKey:
          state.sidebarProjectScopeKeys.length === 1
            ? (state.sidebarProjectScopeKeys[0] ?? null)
            : null,
        sidebarEnvironmentScopeKeys: state.sidebarEnvironmentScopeKeys,
        sidebarProjectExcludeKeys: state.sidebarProjectExcludeKeys,
        sidebarProjectFilterMode: state.sidebarProjectFilterMode,
        sidebarProjectIconOrder: state.sidebarProjectIconOrder,
        threadChangedFilesExpansionVersion: THREAD_CHANGED_FILES_EXPANSION_VERSION,
        threadChangedFilesExpandedById: state.threadChangedFilesExpandedById,
        pullRequestMergeMethod: state.pullRequestMergeMethod,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {}
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

export function markThreadVisited(state: UiState, threadId: string, visitedAt: string): UiState {
  const visitedAtMs = Date.parse(visitedAt);
  if (!Number.isFinite(visitedAtMs)) {
    return state;
  }
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: visitedAt,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  if (currentThreadState[turnId] === expanded) {
    return state;
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: expanded,
      },
    },
  };
}

function setDefaultAdvertisedEndpointKey(state: UiState, key: string | null): UiState {
  const nextKey = key && key.length > 0 ? key : null;
  if (state.defaultAdvertisedEndpointKey === nextKey) {
    return state;
  }
  return {
    ...state,
    defaultAdvertisedEndpointKey: nextKey,
  };
}

export function setSidebarProjectScopeKeys(
  state: UiState,
  projectKeys: readonly string[],
): UiState {
  if (state.sidebarProjectFilterMode === "exclude") {
    state = {
      ...state,
      sidebarProjectFilterMode: "include",
    };
  }
  const nextKeys = sanitizeStringArray(projectKeys);
  if (
    nextKeys.length === state.sidebarProjectScopeKeys.length &&
    nextKeys.every((key, index) => key === state.sidebarProjectScopeKeys[index])
  ) {
    return state;
  }
  return {
    ...state,
    sidebarProjectScopeKeys: nextKeys,
  };
}

export function setSidebarProjectExcludeKeys(
  state: UiState,
  projectKeys: readonly string[],
): UiState {
  const nextKeys = sanitizeStringArray(projectKeys);
  if (
    nextKeys.length === state.sidebarProjectExcludeKeys.length &&
    nextKeys.every((key, index) => key === state.sidebarProjectExcludeKeys[index])
  )
    return state;
  return { ...state, sidebarProjectExcludeKeys: nextKeys };
}

export function setSidebarProjectFilterMode(
  state: UiState,
  mode: SidebarProjectFilterMode,
  scope: Parameters<typeof switchSidebarProjectMode>[3],
): UiState {
  if (state.sidebarProjectFilterMode === mode) return state;
  const selection = switchSidebarProjectMode(
    {
      include: state.sidebarProjectScopeKeys,
      exclude: state.sidebarProjectExcludeKeys,
    },
    state.sidebarProjectFilterMode,
    mode,
    scope,
  );
  return {
    ...state,
    sidebarProjectFilterMode: mode,
    sidebarProjectScopeKeys: [...selection.include],
    sidebarProjectExcludeKeys: [...selection.exclude],
  };
}

function setSidebarProjectIconOrder(state: UiState, order: SidebarProjectIconOrder): UiState {
  return state.sidebarProjectIconOrder === order
    ? state
    : { ...state, sidebarProjectIconOrder: order };
}

const NO_MANUAL_PROJECT_ORDER: readonly string[] = [];

export function selectSidebarProjectManualOrder(state: UiState): readonly string[] {
  return state.sidebarProjectIconOrder === "manual" ? state.projectOrder : NO_MANUAL_PROJECT_ORDER;
}

function sidebarEnvironmentScopeStorageKey(keys: readonly string[]): string | null {
  const sorted = [...new Set(keys)].sort();
  return sorted.length < 2 ? (sorted[0] ?? null) : JSON.stringify(sorted);
}

export function setSidebarEnvironmentScopeKeys(
  state: UiState,
  environmentKeys: readonly string[],
): UiState {
  const nextKeys = sanitizeStringArray(environmentKeys);
  if (
    sidebarEnvironmentScopeStorageKey(state.sidebarEnvironmentScopeKeys) ===
    sidebarEnvironmentScopeStorageKey(nextKeys)
  )
    return state;
  return { ...state, sidebarEnvironmentScopeKeys: nextKeys };
}

export function revealSidebarProjectScope(
  state: UiState,
  projectKey: string,
  revealEnvironment: boolean,
  availableKeys?: ReadonlySet<string>,
  resolvedSelection?: SidebarProjectSelection,
): UiState {
  const next = revealEnvironment ? setSidebarEnvironmentScopeKeys(state, []) : state;
  const selection = revealSidebarProject(
    resolvedSelection ?? {
      include: next.sidebarProjectScopeKeys,
      exclude: next.sidebarProjectExcludeKeys,
    },
    next.sidebarProjectFilterMode,
    projectKey,
    availableKeys,
  );
  if (
    selection.include.length === next.sidebarProjectScopeKeys.length &&
    selection.include.every((key, index) => key === next.sidebarProjectScopeKeys[index]) &&
    selection.exclude.length === next.sidebarProjectExcludeKeys.length &&
    selection.exclude.every((key, index) => key === next.sidebarProjectExcludeKeys[index])
  )
    return next;
  return {
    ...next,
    sidebarProjectScopeKeys: [...selection.include],
    sidebarProjectExcludeKeys: [...selection.exclude],
  };
}

function setPullRequestMergeMethod(state: UiState, method: PullRequestMergeMethod): UiState {
  return state.pullRequestMergeMethod === method
    ? state
    : { ...state, pullRequestMergeMethod: method };
}

export function resolveProjectExpanded(
  projectExpandedById: Readonly<Record<string, boolean>>,
  preferenceKeys: readonly string[],
): boolean {
  for (const key of preferenceKeys) {
    const expanded = projectExpandedById[key];
    if (expanded !== undefined) {
      return expanded;
    }
  }
  return projectExpandedById[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] ?? true;
}

export function setProjectExpanded(
  state: UiState,
  projectIds: string | readonly string[],
  expanded: boolean,
): UiState {
  const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
  const nextEntries = ids.filter((projectId) => state.projectExpandedById[projectId] !== expanded);
  if (nextEntries.length === 0) {
    return state;
  }
  const projectExpandedById = { ...state.projectExpandedById };
  for (const projectId of nextEntries) {
    projectExpandedById[projectId] = expanded;
  }
  return {
    ...state,
    projectExpandedById,
  };
}

export function reorderProjects(
  state: UiState,
  currentProjectOrder: readonly string[],
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = currentProjectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...currentProjectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  markThreadVisited: (threadId: string, visitedAt: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
  setSidebarProjectScopeKeys: (projectKeys: readonly string[]) => void;
  setSidebarProjectExcludeKeys: (projectKeys: readonly string[]) => void;
  setSidebarProjectFilterMode: (
    mode: SidebarProjectFilterMode,
    scope: Parameters<typeof switchSidebarProjectMode>[3],
  ) => void;
  setSidebarProjectIconOrder: (order: SidebarProjectIconOrder) => void;
  revealSidebarProjectScope: (
    projectKey: string,
    revealEnvironment: boolean,
    availableKeys?: ReadonlySet<string>,
    resolvedSelection?: SidebarProjectSelection,
  ) => void;
  setSidebarEnvironmentScopeKeys: (environmentKeys: readonly string[]) => void;
  setPullRequestMergeMethod: (method: PullRequestMergeMethod) => void;
  setProjectExpanded: (projectIds: string | readonly string[], expanded: boolean) => void;
  reorderProjects: (
    currentProjectOrder: readonly string[],
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  setDefaultAdvertisedEndpointKey: (key) =>
    set((state) => setDefaultAdvertisedEndpointKey(state, key)),
  setSidebarProjectScopeKeys: (projectKeys) =>
    set((state) => setSidebarProjectScopeKeys(state, projectKeys)),
  setSidebarProjectExcludeKeys: (projectKeys) =>
    set((state) => setSidebarProjectExcludeKeys(state, projectKeys)),
  setSidebarProjectFilterMode: (mode, scope) =>
    set((state) => setSidebarProjectFilterMode(state, mode, scope)),
  setSidebarProjectIconOrder: (order) => set((state) => setSidebarProjectIconOrder(state, order)),
  revealSidebarProjectScope: (projectKey, revealEnvironment, availableKeys, resolvedSelection) =>
    set((state) =>
      revealSidebarProjectScope(
        state,
        projectKey,
        revealEnvironment,
        availableKeys,
        resolvedSelection,
      ),
    ),
  setSidebarEnvironmentScopeKeys: (environmentKeys) =>
    set((state) => setSidebarEnvironmentScopeKeys(state, environmentKeys)),
  setPullRequestMergeMethod: (method) => set((state) => setPullRequestMergeMethod(state, method)),
  setProjectExpanded: (projectIds, expanded) =>
    set((state) => setProjectExpanded(state, projectIds, expanded)),
  reorderProjects: (currentProjectOrder, draggedProjectIds, targetProjectIds) =>
    set((state) =>
      reorderProjects(state, currentProjectOrder, draggedProjectIds, targetProjectIds),
    ),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
