import {
  resolveSidebarProjectScopeKey,
  resolveSidebarProjectScopeKeys,
} from "./sidebarProjectGrouping";

export type SidebarProjectFilterMode = "include" | "exclude";

export interface SidebarProjectActivity {
  readonly projectKey: string;
  readonly threadCount: number;
  readonly lastActivity: number;
}

export function buildSidebarProjectActivity(
  groups: ReadonlyArray<{
    readonly projectKey: string;
    readonly displayName: string;
    readonly pinned: boolean;
    readonly updatedAt: string;
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: string;
      readonly projectId: string;
    }>;
  }>,
  threads: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  }>,
): SidebarProjectActivity[] {
  const groupKeyByMember = new Map(
    groups.flatMap((group) =>
      group.memberProjectRefs.map(
        (ref) => [`${ref.environmentId}:${ref.projectId}`, group.projectKey] as const,
      ),
    ),
  );
  const activityByGroup = new Map<string, { threadCount: number; lastActivity: number }>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const key = groupKeyByMember.get(`${thread.environmentId}:${thread.projectId}`);
    if (key === undefined) continue;
    const previous = activityByGroup.get(key);
    activityByGroup.set(key, {
      threadCount: (previous?.threadCount ?? 0) + 1,
      lastActivity: Math.max(previous?.lastActivity ?? 0, Date.parse(thread.updatedAt) || 0),
    });
  }
  return groups
    .map((group) => ({
      group,
      activity: {
        projectKey: group.projectKey,
        ...(activityByGroup.get(group.projectKey) ?? {
          threadCount: 0,
          lastActivity: Date.parse(group.updatedAt) || 0,
        }),
      },
    }))
    .sort(
      (left, right) =>
        Number(right.group.pinned) - Number(left.group.pinned) ||
        right.activity.lastActivity - left.activity.lastActivity ||
        left.group.displayName.localeCompare(right.group.displayName) ||
        left.group.projectKey.localeCompare(right.group.projectKey),
    )
    .map((entry) => entry.activity);
}

export function sameSidebarProjectActivity(
  left: readonly SidebarProjectActivity[],
  right: readonly SidebarProjectActivity[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.projectKey === right[index]?.projectKey &&
        item.threadCount === right[index]?.threadCount,
    )
  );
}

export interface SidebarProjectSelection {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export function effectiveSidebarProjectSelection(
  selection: SidebarProjectSelection,
  availableKeys: ReadonlySet<string>,
): SidebarProjectSelection {
  return {
    include: selection.include.filter((key) => availableKeys.has(key)),
    exclude: selection.exclude.filter((key) => availableKeys.has(key)),
  };
}

export function isInSidebarProjectScope(
  item: { readonly environmentId: string; readonly projectId: string },
  include: ReadonlySet<string> | null,
  environmentIds: ReadonlySet<string> | null,
  exclude?: ReadonlySet<string>,
): boolean {
  const key = `${item.environmentId}:${item.projectId}`;
  return (
    (environmentIds === null || environmentIds.has(item.environmentId)) &&
    (include === null || include.has(key)) &&
    !exclude?.has(key)
  );
}

export function sidebarProjectMemberScope(
  groups: readonly {
    readonly projectKey: string;
    readonly memberProjectRefs: readonly {
      readonly environmentId: string;
      readonly projectId: string;
    }[];
  }[],
  selection: SidebarProjectSelection,
): ReadonlySet<string> | null {
  const effective = effectiveSidebarProjectSelection(
    selection,
    new Set(groups.map((group) => group.projectKey)),
  );
  if (effective.include.length === 0 && effective.exclude.length === 0) return null;
  const include = new Set(effective.include);
  const exclude = new Set(effective.exclude);
  return new Set(
    groups.flatMap((group) =>
      (include.size === 0 || include.has(group.projectKey)) && !exclude.has(group.projectKey)
        ? group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`)
        : [],
    ),
  );
}

export function toggleSidebarProjectKey(
  keys: readonly string[],
  key: string,
  additive = false,
): string[] {
  if (!additive) return keys.length === 1 && keys[0] === key ? [] : [key];
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
}

type SidebarProjectSelectionScope = Pick<
  Parameters<typeof resolveSidebarProjectScopeKeys>[0],
  "groups" | "settings"
> & {
  readonly effectiveKeys: readonly string[];
};

export function clearSidebarProjectSelection(
  selection: SidebarProjectSelection,
  mode: SidebarProjectFilterMode,
  scope: SidebarProjectSelectionScope,
): string[] {
  const keys = resolveSidebarProjectScopeKeys({ ...scope, keys: selection[mode] });
  const visible = new Set(scope.effectiveKeys);
  return keys.filter((key) => !visible.has(key));
}

export function toggleSidebarProjectSelection(
  selection: SidebarProjectSelection,
  mode: SidebarProjectFilterMode,
  key: string,
  additive: boolean,
  scope: SidebarProjectSelectionScope,
): string[] {
  if (additive) {
    const keys = resolveSidebarProjectScopeKeys({ ...scope, keys: selection[mode] });
    return toggleSidebarProjectKey(keys, key, true);
  }
  return [
    ...clearSidebarProjectSelection(selection, mode, scope),
    ...toggleSidebarProjectKey(scope.effectiveKeys, key),
  ];
}

export function includeSidebarProjectSelection(
  selection: SidebarProjectSelection,
  mode: SidebarProjectFilterMode,
  key: string,
  scope: SidebarProjectSelectionScope & { readonly availableKeys: ReadonlySet<string> },
): string[] {
  if (mode === "include") {
    return toggleSidebarProjectSelection(selection, mode, key, false, scope);
  }
  const include = resolveSidebarProjectScopeKeys({ ...scope, keys: selection.include });
  return [...include.filter((candidate) => !scope.availableKeys.has(candidate)), key];
}

const EMPTY_PROJECT_SELECTION_KEYS: readonly string[] = [];

export function activeSidebarProjectSelection(
  selection: SidebarProjectSelection,
  mode: SidebarProjectFilterMode,
): SidebarProjectSelection {
  return mode === "include"
    ? { include: selection.include, exclude: EMPTY_PROJECT_SELECTION_KEYS }
    : { include: EMPTY_PROJECT_SELECTION_KEYS, exclude: selection.exclude };
}

export function switchSidebarProjectMode(
  selection: SidebarProjectSelection,
  from: SidebarProjectFilterMode,
  to: SidebarProjectFilterMode,
  scope: Pick<SidebarProjectSelectionScope, "groups" | "settings"> & {
    readonly availableKeys: ReadonlySet<string>;
  },
): SidebarProjectSelection {
  const isVisible = (key: string) =>
    scope.availableKeys.has(resolveSidebarProjectScopeKey({ ...scope, key }) ?? key);
  if (from === to || selection[to].some(isVisible)) return selection;
  return {
    ...selection,
    [to]: [...selection[to], ...selection[from].filter(isVisible)],
  };
}

export function revealSidebarProject(
  selection: SidebarProjectSelection,
  mode: SidebarProjectFilterMode,
  key: string,
  availableKeys?: ReadonlySet<string>,
): SidebarProjectSelection {
  return mode === "exclude"
    ? { ...selection, exclude: selection.exclude.filter((candidate) => candidate !== key) }
    : {
        ...selection,
        include:
          availableKeys !== undefined && !availableKeys.has(key)
            ? selection.include.filter((candidate) => !availableKeys.has(candidate))
            : !selection.include.some(
                  (candidate) => availableKeys === undefined || availableKeys.has(candidate),
                ) || selection.include.includes(key)
              ? selection.include
              : [...selection.include, key],
      };
}

export function fitSidebarProjectRow(input: {
  readonly keys: readonly string[];
  readonly selected: ReadonlySet<string>;
  readonly width: number;
  readonly itemWidth: number;
  readonly gap: number;
  readonly overflowWidth: number;
}) {
  const { keys, selected, width, itemWidth, gap, overflowWidth } = input;
  const fullWidth = keys.length * (itemWidth + gap) - gap;
  if (fullWidth <= width) return { visible: [...keys], overflow: [] };
  const capacity = Math.max(0, Math.floor((width - overflowWidth) / (itemWidth + gap)));
  const pinned = keys.filter((key) => selected.has(key)).slice(0, capacity);
  const ordinary = keys.filter((key) => !selected.has(key));
  const visible = [...ordinary.slice(0, Math.max(0, capacity - pinned.length)), ...pinned];
  const visibleKeys = new Set(visible);
  return {
    visible: keys.filter((key) => visibleKeys.has(key)),
    overflow: keys.filter((key) => !visibleKeys.has(key)),
  };
}
