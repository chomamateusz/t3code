import { normalizeProjectPathForComparison } from "@t3tools/client-runtime/state/projects";

import {
  resolveSidebarProjectScopeKey,
  resolveSidebarProjectScopeKeys,
} from "./sidebarProjectGrouping";

export type SidebarProjectFilterMode = "include" | "exclude";

export const SIDEBAR_PROJECT_ICON_ORDERS = ["name", "activity", "manual"] as const;
export type SidebarProjectIconOrder = (typeof SIDEBAR_PROJECT_ICON_ORDERS)[number];

export function isSidebarProjectIconOrder(value: unknown): value is SidebarProjectIconOrder {
  return SIDEBAR_PROJECT_ICON_ORDERS.some((order) => order === value);
}

const LEGACY_PROJECT_CWD_PREFERENCE_PREFIX = "legacy-project-cwd:";

export function legacyProjectCwdPreferenceKey(cwd: string): string {
  return `${LEGACY_PROJECT_CWD_PREFERENCE_PREFIX}${normalizeProjectPathForComparison(cwd)}`;
}

export interface SidebarProjectActivity {
  readonly projectKey: string;
  readonly threadCount: number;
  readonly lastActivity: number;
}

interface SidebarProjectOrderMember {
  readonly physicalProjectKey: string;
  readonly workspaceRoot: string;
}

interface SidebarProjectOrderGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly pinned: boolean;
  readonly updatedAt: string;
  readonly memberProjects: ReadonlyArray<SidebarProjectOrderMember>;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
  }>;
}

interface SidebarProjectOrderThread {
  readonly environmentId: string;
  readonly projectId: string;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
}

interface SidebarProjectIconSortEntry<TGroup extends SidebarProjectOrderGroup> {
  readonly group: TGroup;
  readonly activity: SidebarProjectActivity;
}

type SidebarProjectManualGroup = Pick<SidebarProjectOrderGroup, "memberProjects">;

export type SidebarProjectManualRanks = ReadonlyMap<string, number>;

const NO_MANUAL_RANKS: SidebarProjectManualRanks = new Map();
const UNRANKED = Number.MAX_SAFE_INTEGER;

function sidebarProjectManualKeys(group: SidebarProjectManualGroup): ReadonlySet<string> {
  return new Set(
    group.memberProjects.flatMap((member) => [
      member.physicalProjectKey,
      legacyProjectCwdPreferenceKey(member.workspaceRoot),
    ]),
  );
}

function firstIndexByKey(manualOrder: readonly string[]): ReadonlyMap<string, number> {
  const indexByKey = new Map<string, number>();
  for (const [index, key] of manualOrder.entries()) {
    if (!indexByKey.has(key)) indexByKey.set(key, index);
  }
  return indexByKey;
}

function storedManualRank(
  group: SidebarProjectManualGroup,
  indexByKey: ReadonlyMap<string, number>,
): number | undefined {
  const indexes = [...sidebarProjectManualKeys(group)].flatMap((key) => indexByKey.get(key) ?? []);
  return indexes.length === 0 ? undefined : Math.min(...indexes);
}

/** Takes groups before machine scoping: a scoped group may hold none of the stored keys. */
export function sidebarProjectManualRanks(
  unscopedGroups: ReadonlyArray<SidebarProjectManualGroup>,
  manualOrder: readonly string[],
): SidebarProjectManualRanks {
  if (manualOrder.length === 0) return NO_MANUAL_RANKS;
  const indexByKey = firstIndexByKey(manualOrder);
  return new Map(
    unscopedGroups.flatMap((group) => {
      const rank = storedManualRank(group, indexByKey);
      return rank === undefined
        ? []
        : group.memberProjects.map((member) => [member.physicalProjectKey, rank] as const);
    }),
  );
}

function manualRankOf(group: SidebarProjectManualGroup, ranks: SidebarProjectManualRanks) {
  return Math.min(
    UNRANKED,
    ...group.memberProjects.map((member) => ranks.get(member.physicalProjectKey) ?? UNRANKED),
  );
}

function compareByName(
  left: Pick<SidebarProjectOrderGroup, "displayName" | "projectKey">,
  right: Pick<SidebarProjectOrderGroup, "displayName" | "projectKey">,
) {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.projectKey.localeCompare(right.projectKey)
  );
}

function compareSidebarProjectIcons(
  order: SidebarProjectIconOrder,
  manualRanks: SidebarProjectManualRanks,
) {
  type Entry = SidebarProjectIconSortEntry<SidebarProjectOrderGroup>;
  const byName = (left: Entry, right: Entry) =>
    Number(right.group.pinned) - Number(left.group.pinned) ||
    compareByName(left.group, right.group);
  switch (order) {
    case "name":
      return byName;
    case "activity":
      return (left: Entry, right: Entry) =>
        Number(right.group.pinned) - Number(left.group.pinned) ||
        right.activity.lastActivity - left.activity.lastActivity ||
        byName(left, right);
    case "manual":
      return (left: Entry, right: Entry) =>
        Number(right.group.pinned) - Number(left.group.pinned) ||
        manualRankOf(left.group, manualRanks) - manualRankOf(right.group, manualRanks) ||
        byName(left, right);
  }
}

function sortSidebarProjectEntries<TGroup extends SidebarProjectOrderGroup>(
  groups: ReadonlyArray<TGroup>,
  threads: ReadonlyArray<SidebarProjectOrderThread>,
  order: SidebarProjectIconOrder,
  manualRanks: SidebarProjectManualRanks,
): SidebarProjectIconSortEntry<TGroup>[] {
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
    .sort(compareSidebarProjectIcons(order, manualRanks));
}

export function buildSidebarProjectActivity(
  groups: ReadonlyArray<SidebarProjectOrderGroup>,
  threads: ReadonlyArray<SidebarProjectOrderThread>,
  order: SidebarProjectIconOrder,
  manualRanks: SidebarProjectManualRanks = NO_MANUAL_RANKS,
): SidebarProjectActivity[] {
  return sortSidebarProjectEntries(groups, threads, order, manualRanks).map(
    (entry) => entry.activity,
  );
}

export function sortSidebarProjectGroups<TGroup extends SidebarProjectOrderGroup>(
  groups: ReadonlyArray<TGroup>,
  threads: ReadonlyArray<SidebarProjectOrderThread>,
  order: SidebarProjectIconOrder,
  manualRanks: SidebarProjectManualRanks,
): TGroup[] {
  return sortSidebarProjectEntries(groups, threads, order, manualRanks).map((entry) => entry.group);
}

/** A legacy cwd key can match one path on two machines; splitting it lets a drop move just one. */
function splitSharedManualKeys(
  orderedGroups: ReadonlyArray<SidebarProjectManualGroup>,
  manualOrder: readonly string[],
): string[] {
  const ownersByKey = new Map<string, SidebarProjectManualGroup[]>();
  for (const group of orderedGroups) {
    for (const key of sidebarProjectManualKeys(group)) {
      ownersByKey.set(key, [...(ownersByKey.get(key) ?? []), group]);
    }
  }
  return [
    ...new Set(
      manualOrder.flatMap((key) => {
        const owners = ownersByKey.get(key) ?? [];
        return owners.length > 1
          ? owners.flatMap((group) =>
              group.memberProjects.map((member) => member.physicalProjectKey),
            )
          : [key];
      }),
    ),
  ];
}

export function sidebarProjectManualMove(
  orderedGroups: ReadonlyArray<
    Pick<SidebarProjectOrderGroup, "projectKey" | "displayName" | "pinned" | "memberProjects">
  >,
  manualOrder: readonly string[],
  activeKey: string,
  overKey: string,
): [current: string[], dragged: string[], target: string[]] | null {
  const activeIndex = orderedGroups.findIndex((group) => group.projectKey === activeKey);
  const droppedIndex = orderedGroups.findIndex((group) => group.projectKey === overKey);
  if (activeIndex < 0 || droppedIndex < 0) return null;
  const pinned = orderedGroups[activeIndex]!.pinned;
  const sectionStart = pinned ? 0 : orderedGroups.findIndex((group) => !group.pinned);
  const sectionEnd = pinned
    ? orderedGroups.findLastIndex((group) => group.pinned)
    : orderedGroups.length - 1;
  const overIndex = Math.min(sectionEnd, Math.max(sectionStart, droppedIndex));
  if (activeIndex === overIndex) return null;
  const storedOrder = splitSharedManualKeys(orderedGroups, manualOrder);
  const indexByKey = firstIndexByKey(storedOrder);
  const current = [
    ...storedOrder,
    ...orderedGroups
      .filter((group) => storedManualRank(group, indexByKey) === undefined)
      .toSorted(compareByName)
      .flatMap((group) => group.memberProjects.map((member) => member.physicalProjectKey)),
  ];
  const draggedKeys = sidebarProjectManualKeys(orderedGroups[activeIndex]!);
  const overKeys = sidebarProjectManualKeys(orderedGroups[overIndex]!);
  const target = current.find((key) => overKeys.has(key));
  if (target === undefined) return null;
  return [current, current.filter((key) => draggedKeys.has(key)), [target]];
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
