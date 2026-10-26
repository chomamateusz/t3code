import type { EnvironmentId } from "@t3tools/contracts";

import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "./sidebarProjectGrouping";

interface SidebarEnvironmentIdentity {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

interface SidebarEnvironmentScopeItem {
  readonly value: string;
  readonly label: string;
  readonly environmentId: EnvironmentId | null;
}

export function buildSidebarEnvironmentScopeItems(input: {
  readonly environments: ReadonlyArray<SidebarEnvironmentIdentity>;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): ReadonlyArray<SidebarEnvironmentScopeItem> {
  if (input.environments.length < 2) return [];
  const isPrimary = (environment: SidebarEnvironmentIdentity) =>
    environment.environmentId === input.primaryEnvironmentId;
  return [
    { value: "all", label: "All machines", environmentId: null },
    ...[
      ...input.environments.filter(isPrimary),
      ...input.environments.filter((environment) => !isPrimary(environment)),
    ].map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
      environmentId: environment.environmentId,
    })),
  ];
}

export function normalizeSidebarEnvironmentScopeKeys(
  keys: readonly string[],
  environmentIds: readonly EnvironmentId[],
): string[] {
  const selected = new Set(keys);
  return environmentIds.length > 0 && environmentIds.every((id) => selected.has(id))
    ? []
    : [...selected];
}

export function nextSidebarEnvironmentScopeKeys(
  keys: readonly string[],
  key: string,
  additive: boolean,
  environmentIds: readonly EnvironmentId[],
): string[] {
  if (!additive) return keys.length === 1 && keys[0] === key ? [] : [key];
  const next = keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
  return normalizeSidebarEnvironmentScopeKeys(next, environmentIds);
}

export function resolveSidebarEnvironmentScope(input: {
  readonly environments: ReadonlyArray<SidebarEnvironmentIdentity>;
  readonly keys: readonly string[];
}): ReadonlyArray<SidebarEnvironmentIdentity> {
  if (input.environments.length < 2) return [];
  const keys = new Set(input.keys);
  const selected = input.environments.filter((environment) => keys.has(environment.environmentId));
  return selected.length === input.environments.length ? [] : selected;
}

export function projectGroupHasEnvironment(
  group: Pick<SidebarProjectSnapshot, "memberProjectRefs">,
  environmentId: EnvironmentId,
): boolean {
  return group.memberProjectRefs.some((ref) => ref.environmentId === environmentId);
}

export function filterSidebarEnvironmentIds(
  environmentIds: ReadonlyArray<EnvironmentId>,
  scopedProjectKeys: ReadonlySet<string> | null,
  scopedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
): EnvironmentId[] {
  const projectKeys = scopedProjectKeys === null ? null : [...scopedProjectKeys];
  return environmentIds.filter(
    (id) =>
      (scopedEnvironmentIds === null || scopedEnvironmentIds.has(id)) &&
      (projectKeys === null || projectKeys.some((key) => key.startsWith(`${id}:`))),
  );
}

export function filterSidebarProjectScopeKeysToEnvironment(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  keys: ReadonlyArray<string>,
  environmentIds: ReadonlySet<EnvironmentId> | null,
): ReadonlyArray<string> {
  const availableKeys = new Set(
    groups
      .filter(
        (group) =>
          environmentIds === null ||
          [...environmentIds].some((id) => projectGroupHasEnvironment(group, id)),
      )
      .map((group) => group.projectKey),
  );
  const filteredKeys = keys.filter((key) => availableKeys.has(key));
  return filteredKeys.length === keys.length ? keys : filteredKeys;
}

export function scopeSidebarProjectGroupsToEnvironment(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  environmentIds: ReadonlySet<EnvironmentId> | null,
  input: Pick<
    Parameters<typeof buildSidebarProjectSnapshots>[0],
    "projects" | "settings" | "primaryEnvironmentId"
  >,
): ReadonlyArray<SidebarProjectSnapshot> {
  if (environmentIds === null) return groups;
  if (environmentIds.size !== 1) {
    return groups.filter((group) =>
      [...environmentIds].some((id) => projectGroupHasEnvironment(group, id)),
    );
  }
  const environmentId = [...environmentIds][0]!;
  const projectByKey = new Map(
    input.projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const projects = groups.flatMap((group) =>
    group.memberProjectRefs.flatMap((ref) => {
      if (ref.environmentId !== environmentId) return [];
      const project = projectByKey.get(`${ref.environmentId}:${ref.projectId}`);
      return project ? [project] : [];
    }),
  );
  const environmentLabel =
    groups
      .flatMap((group) => group.memberProjects)
      .find((member) => member.environmentId === environmentId)?.environmentLabel ?? null;
  return buildSidebarProjectSnapshots({
    ...input,
    projects,
    groupScratchProjects: true,
    resolveEnvironmentLabel: () => environmentLabel,
  });
}

export function sidebarEmptyThreadsLabel(input: {
  readonly projectName: string | null;
  readonly machineLabel: string | null;
}): string {
  const project = input.projectName === null ? "" : ` in ${input.projectName}`;
  const machine = input.machineLabel === null ? "" : ` on ${input.machineLabel}`;
  return `No threads${project}${machine} yet`;
}
