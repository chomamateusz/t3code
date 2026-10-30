import type { EnvironmentId } from "@t3tools/contracts";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";

import {
  filterSidebarProjectScopeKeysToEnvironment,
  resolveSidebarEnvironmentScope,
} from "./sidebarEnvironmentScope";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";
import {
  isInSidebarProjectScope,
  sidebarProjectMemberScope,
  type SidebarProjectSelection,
} from "./sidebarProjectRow";
import type { Project } from "./types";

export interface NewThreadTargetInput {
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly environments: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly online: boolean;
  }[];
  readonly environmentScopeKeys: readonly string[];
  readonly selection: SidebarProjectSelection;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly projectActivity?: ReadonlyMap<string, number>;
}

export type NewThreadTargetMember = Project & {
  readonly displayName: string;
  readonly projectKey: string;
  readonly environmentLabel: string;
  readonly online: boolean;
};

export type NewThreadTarget =
  | { readonly kind: "full" }
  | { readonly kind: "direct"; readonly member: NewThreadTargetMember }
  | {
      readonly kind: "restricted";
      readonly members: readonly NewThreadTargetMember[];
      readonly title: string;
    }
  | { readonly kind: "unreachable-note"; readonly note: string };

export function buildNewThreadProjectActivity(
  threads: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
    readonly updatedAt: string;
    readonly createdAt: string;
  }>,
): ReadonlyMap<string, number> {
  const activity = new Map<string, number>();
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    activity.set(
      key,
      Math.max(
        activity.get(key) ?? 0,
        Date.parse(thread.updatedAt) || 0,
        Date.parse(thread.createdAt) || 0,
      ),
    );
  }
  return activity;
}

function targetScope(input: NewThreadTargetInput) {
  const environments = resolveSidebarEnvironmentScope({
    environments: input.environments,
    keys: input.environmentScopeKeys,
  });
  const environmentIds = new Set(environments.map((environment) => environment.environmentId));
  const openGroups = pickableProjectGroups(input.groups).filter(
    (group) =>
      environmentIds.size !== 1 ||
      group.memberProjects.some(
        (project) => environmentIds.has(project.environmentId) && project.archivedAt == null,
      ),
  );
  const availableKeys = new Set(
    filterSidebarProjectScopeKeysToEnvironment(
      openGroups,
      openGroups.map((group) => group.projectKey),
      environmentIds.size === 0 ? null : environmentIds,
    ),
  );
  const groups = openGroups.filter((group) => availableKeys.has(group.projectKey));
  const projectKeys = sidebarProjectMemberScope(groups, input.selection);
  return {
    environmentIds,
    filtered: environmentIds.size > 0 || projectKeys !== null,
    matches: (member: NewThreadTargetMember) =>
      (environmentIds.size === 0 || environmentIds.has(member.environmentId)) &&
      isInSidebarProjectScope(
        { environmentId: member.environmentId, projectId: member.id },
        projectKeys,
        null,
      ),
  };
}

export function buildNewThreadTargetCatalog(input: NewThreadTargetInput): NewThreadTargetMember[] {
  const environments = new Map(
    input.environments.map((environment) => [environment.environmentId, environment]),
  );
  const scope = targetScope(input);
  const groups = pickableProjectGroups(input.groups);
  const pinnedKeys = new Set(
    groups.filter((group) => group.pinned).map((group) => group.projectKey),
  );
  const members = groups.flatMap((group) =>
    group.memberProjects
      .filter((project) => project.archivedAt == null)
      .map((project) => ({
        ...project,
        displayName: group.displayName,
        projectKey: group.projectKey,
        environmentLabel: environments.get(project.environmentId)?.label ?? "Unknown machine",
        online: environments.get(project.environmentId)?.online ?? false,
      })),
  );
  const activityByGroup = new Map(
    groups.map((group) => {
      const activityByEnvironment = new Map<EnvironmentId, number>();
      for (const project of group.memberProjects) {
        if (project.archivedAt != null) continue;
        activityByEnvironment.set(
          project.environmentId,
          Math.max(
            activityByEnvironment.get(project.environmentId) ?? 0,
            input.projectActivity?.get(`${project.environmentId}:${project.id}`) ?? 0,
          ),
        );
      }
      return [group.projectKey, activityByEnvironment] as const;
    }),
  );
  const activity = (member: NewThreadTargetMember) =>
    activityByGroup.get(member.projectKey)?.get(member.environmentId) ?? 0;
  return members.sort(
    (left, right) =>
      Number(right.online) - Number(left.online) ||
      Number(scope.matches(right)) - Number(scope.matches(left)) ||
      Number(pinnedKeys.has(right.projectKey)) - Number(pinnedKeys.has(left.projectKey)) ||
      Number(right.environmentId === input.primaryEnvironmentId) -
        Number(left.environmentId === input.primaryEnvironmentId) ||
      activity(right) - activity(left),
  );
}

export function newThreadTargetProjectKeys(input: NewThreadTargetInput): ReadonlySet<string> {
  const scope = targetScope(input);
  if (!scope.filtered) return new Set();
  return new Set(
    buildNewThreadTargetCatalog(input)
      .filter((member) => member.online && scope.matches(member))
      .map((member) => member.projectKey),
  );
}

function restrictedTarget(members: readonly NewThreadTargetMember[]): NewThreadTarget {
  const projectNames = new Map(members.map((member) => [member.projectKey, member.displayName]));
  const projectName = projectNames.size === 1 ? projectNames.values().next().value : undefined;
  const severalMachines = new Set(members.map((member) => member.environmentId)).size > 1;
  return {
    kind: "restricted",
    members,
    title: projectName
      ? severalMachines
        ? // oxlint-disable-next-line t3code/no-em-dash-copy -- The signed-off picker copy requires this separator.
          `${projectName} — which machine?`
        : `New thread in ${projectName}`
      : "New thread in…",
  };
}

export function resolveNewThreadTarget(input: NewThreadTargetInput): NewThreadTarget {
  const scope = targetScope(input);
  if (!scope.filtered) return { kind: "full" };
  const catalog = buildNewThreadTargetCatalog(input);
  const scopedMembers = catalog.filter(scope.matches);
  const preferredByProject = new Map<string, EnvironmentId>();
  if (scope.environmentIds.size > 1) {
    const environmentOrder = [
      ...input.environments.filter(
        (environment) => environment.environmentId === input.primaryEnvironmentId,
      ),
      ...input.environments.filter(
        (environment) => environment.environmentId !== input.primaryEnvironmentId,
      ),
    ];
    const orderedMembers = [...scopedMembers].sort(
      (left, right) =>
        Number(right.online) - Number(left.online) ||
        (input.projectActivity?.get(`${right.environmentId}:${right.id}`) ?? 0) -
          (input.projectActivity?.get(`${left.environmentId}:${left.id}`) ?? 0) ||
        environmentOrder.findIndex(
          (environment) => environment.environmentId === left.environmentId,
        ) -
          environmentOrder.findIndex(
            (environment) => environment.environmentId === right.environmentId,
          ),
    );
    for (const member of orderedMembers) {
      if (!preferredByProject.has(member.projectKey)) {
        preferredByProject.set(member.projectKey, member.environmentId);
      }
    }
  }
  const members = scopedMembers.filter(
    (member) =>
      preferredByProject.size === 0 ||
      preferredByProject.get(member.projectKey) === member.environmentId,
  );
  const reachable = members.filter((member) => member.online);
  if (reachable.length === 1) return { kind: "direct", member: reachable[0]! };
  if (reachable.length > 1) return restrictedTarget(members);
  if (members.length === 1 && scope.environmentIds.size <= 1) {
    const siblings = catalog.filter((member) => member.projectKey === members[0]!.projectKey);
    if (siblings.some((member) => member.online)) return restrictedTarget(siblings);
  }
  return {
    kind: "unreachable-note",
    note: "No project in the current filter is reachable",
  };
}

export function newThreadTargetTooltip(
  target: NewThreadTarget,
  shortcutLabel?: string | null,
): string {
  let label = "New thread…";
  if (target.kind === "direct") {
    label = `New thread in ${target.member.displayName} · ${target.member.environmentLabel}`;
  } else if (
    target.kind === "restricted" &&
    new Set(target.members.map((member) => member.projectKey)).size === 1 &&
    new Set(target.members.map((member) => member.environmentId)).size > 1
  ) {
    // oxlint-disable-next-line t3code/no-em-dash-copy -- The signed-off tooltip copy requires this separator.
    label = `New thread — choose machine for ${target.members[0]?.displayName}`;
  }
  const allProjectsHint =
    target.kind === "direct" || target.kind === "restricted" ? "\n⌥-click: all projects" : "";
  return `${label}${shortcutLabel ? ` (${shortcutLabel})` : ""}${allProjectsHint}`;
}
