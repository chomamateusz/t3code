import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { useShallow } from "zustand/react/shallow";

import { getClientSettings, useClientSettings } from "./hooks/useSettings";
import { appAtomRegistry } from "./rpc/atomRegistry";
import {
  buildSidebarProjectSnapshots,
  resolveSidebarProjectScopeKeys,
} from "./sidebarProjectGrouping";
import { readProjects, useProjects } from "./state/entities";
import {
  useConnectedEnvironmentIds,
  useEnvironmentIdentities,
  usePrimaryEnvironmentId,
} from "./state/environments";
import { environmentSummaries } from "./state/presentation";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { type UiState, useUiStateStore } from "./uiStateStore";
import { buildNewThreadProjectActivity, type NewThreadTargetInput } from "./newThreadTarget";
import { environmentThreadShells } from "./state/threads";
import { activeSidebarProjectSelection } from "./sidebarProjectRow";
import { resolveSidebarEnvironmentScope } from "./sidebarEnvironmentScope";

const selectFilterState = (state: UiState) => ({
  environmentScopeKeys: state.sidebarEnvironmentScopeKeys,
  ...activeSidebarProjectSelection(
    { include: state.sidebarProjectScopeKeys, exclude: state.sidebarProjectExcludeKeys },
    state.sidebarProjectFilterMode,
  ),
});

const noProjectActivityAtom = Atom.make<ReadonlyMap<string, number> | undefined>(undefined);

const projectActivityAtom = Atom.make((get) =>
  buildNewThreadProjectActivity(get(environmentThreadShells.quietThreadShellsAtom)),
).pipe(
  Atom.withEquality<ReadonlyMap<string, number>>(
    (left, right) =>
      left.size === right.size && [...left].every(([key, value]) => right.get(key) === value),
  ),
);

function buildInput(
  projects: ReturnType<typeof readProjects>,
  settings: ReturnType<typeof selectProjectGroupingSettings>,
  identities: ReturnType<typeof useEnvironmentIdentities>,
  connected: ReturnType<typeof useConnectedEnvironmentIds>,
  primaryEnvironmentId: NewThreadTargetInput["primaryEnvironmentId"],
  filter: ReturnType<typeof selectFilterState>,
  projectActivity?: ReadonlyMap<string, number>,
): NewThreadTargetInput {
  const labels = new Map(
    identities.map((environment) => [environment.environmentId, environment.label]),
  );
  const groups = buildSidebarProjectSnapshots({
    projects,
    settings,
    primaryEnvironmentId,
    groupScratchProjects: true,
    resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
  });
  return {
    groups,
    environments: identities.map((environment) => ({
      ...environment,
      online: connected.includes(environment.environmentId),
    })),
    environmentScopeKeys: filter.environmentScopeKeys,
    selection: {
      include: resolveSidebarProjectScopeKeys({ groups, settings, keys: filter.include }),
      exclude: resolveSidebarProjectScopeKeys({ groups, settings, keys: filter.exclude }),
    },
    primaryEnvironmentId,
    ...(projectActivity ? { projectActivity } : {}),
  };
}

export function readNewThreadTargetInput(): NewThreadTargetInput {
  return buildInput(
    readProjects(),
    selectProjectGroupingSettings(getClientSettings()),
    appAtomRegistry.get(environmentSummaries.identitiesAtom),
    appAtomRegistry.get(environmentSummaries.connectedEnvironmentIdsAtom),
    appAtomRegistry.get(primaryEnvironmentIdAtom),
    selectFilterState(useUiStateStore.getState()),
    appAtomRegistry.get(projectActivityAtom),
  );
}

export function useNewThreadTargetInput(): NewThreadTargetInput {
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const identities = useEnvironmentIdentities();
  const connected = useConnectedEnvironmentIds();
  const primary = usePrimaryEnvironmentId();
  const filter = useUiStateStore(useShallow(selectFilterState));
  const scopedEnvironments = resolveSidebarEnvironmentScope({
    environments: identities,
    keys: filter.environmentScopeKeys,
  });
  const projectActivity = useAtomValue(
    scopedEnvironments.length > 1 ? projectActivityAtom : noProjectActivityAtom,
  );
  return buildInput(projects, settings, identities, connected, primary, filter, projectActivity);
}
