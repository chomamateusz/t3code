import { useAtomValue } from "@effect/atom-react";
import {
  pickableProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { EnvironmentId } from "@t3tools/contracts";
import { deadlineStore } from "@t3tools/client-runtime/clock";
import {
  buildSidebarProjectBadges,
  sameSidebarProjectBadges,
  sameSidebarProjectBadgeThreads,
} from "../components/Sidebar.logic";
import { selectSidebarProjectManualOrder, useUiStateStore } from "../uiStateStore";
import { Atom } from "effect/reactivity";

import { scopeSidebarProjectGroupsToEnvironment } from "../sidebarEnvironmentScope";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import {
  buildSidebarProjectActivity,
  sameSidebarProjectActivity,
  sidebarProjectManualRanks,
} from "../sidebarProjectRow";
import { environmentProjects } from "../state/projects";
import { environmentPresentations, environmentSummaries } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { environmentIdsKey } from "../state/environmentAtomList";
import { shallow } from "zustand/vanilla/shallow";
import { environmentThreadShells } from "../state/threads";
import { getClientSettings, subscribeClientSettings } from "./useSettings";

function uiStateAtom<T>(select: (state: ReturnType<typeof useUiStateStore.getState>) => T) {
  return Atom.make((get) => {
    get.addFinalizer(
      useUiStateStore.subscribe((state, previous) => {
        if (select(state) !== select(previous)) get.setSelf(select(state));
      }),
    );
    return select(useUiStateStore.getState());
  });
}

const localVisitsAtom = uiStateAtom((state) => state.threadLastVisitedAtById);
const iconOrderAtom = uiStateAtom((state) => state.sidebarProjectIconOrder);
const manualOrderAtom = uiStateAtom(selectSidebarProjectManualOrder);

function createProjectBadgesAtom(
  projectsAtom: Atom.Atom<readonly SidebarProjectSnapshot[]>,
  environmentIds: ReadonlySet<EnvironmentId> | null,
) {
  return Atom.make((get) => {
    const threads = get(badgeThreadsAtom);
    const localLastVisitedAtById = get(localVisitsAtom);
    const nowMs = Date.now();
    let nextWake = Infinity;
    for (const thread of threads) {
      const wake = Date.parse(thread.snoozedUntil ?? "");
      if (wake > nowMs && wake < nextWake) nextWake = wake;
    }
    if (Number.isFinite(nextWake)) {
      const deadline = deadlineStore(nextWake);
      get.addFinalizer(deadline.subscribe(() => get.refreshSelf()));
      if (deadline.getSnapshot()) queueMicrotask(() => get.refreshSelf());
    }
    return buildSidebarProjectBadges(get(projectsAtom), threads, {
      delegatedUnderParent: get(environmentThreadShells.delegatedUnderParentAtom),
      loadedEnvironmentIds: get(loadedEnvironmentIdsAtom),
      now: new Date(nowMs).toISOString(),
      localLastVisitedAtById,
      environmentIds,
    });
  }).pipe(Atom.withEquality(sameSidebarProjectBadges));
}

const groupingSettingsAtom = Atom.make((get) => {
  get.addFinalizer(
    subscribeClientSettings(() => get.setSelf(selectProjectGroupingSettings(getClientSettings()))),
  );
  return selectProjectGroupingSettings(getClientSettings());
}).pipe(Atom.withEquality(shallow));

const badgeThreadsAtom = Atom.make((get) =>
  get(environmentThreadShells.quietThreadShellsAtom),
).pipe(Atom.withEquality(sameSidebarProjectBadgeThreads));

const loadedEnvironmentIdsAtom = Atom.make(
  (get) => new Set(get(environmentPresentations.serverConfigsAtom).keys()),
).pipe(
  Atom.withEquality<ReadonlySet<EnvironmentId>>(
    (left, right) => left.size === right.size && [...left].every((id) => right.has(id)),
  ),
);

const unscopedProjectGroupsAtom = Atom.make((get) => {
  const environments = get(environmentSummaries.identitiesAtom);
  const labels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  return buildSidebarProjectSnapshots({
    projects: get(environmentProjects.projectsAtom),
    settings: get(groupingSettingsAtom),
    groupScratchProjects: true,
    primaryEnvironmentId: get(primaryEnvironmentIdAtom),
    resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
  });
});

const manualRanksAtom = Atom.make((get) =>
  sidebarProjectManualRanks(get(unscopedProjectGroupsAtom), get(manualOrderAtom)),
);

const projectRowAtoms = Atom.family((key: string) => {
  const environmentIds =
    key === "" ? null : new Set(key.split("\n").map((id) => EnvironmentId.make(id)));
  const projectsAtom = Atom.make((get) =>
    pickableProjectGroups(
      scopeSidebarProjectGroupsToEnvironment(get(unscopedProjectGroupsAtom), environmentIds, {
        projects: get(environmentProjects.projectsAtom),
        settings: get(groupingSettingsAtom),
        primaryEnvironmentId: get(primaryEnvironmentIdAtom),
      }),
    ),
  );
  const activityAtom = Atom.make((get) =>
    buildSidebarProjectActivity(
      get(projectsAtom),
      get(environmentThreadShells.quietThreadShellsAtom),
      get(iconOrderAtom),
      get(manualRanksAtom),
    ),
  ).pipe(Atom.withEquality(sameSidebarProjectActivity));
  return {
    projectsAtom,
    activityAtom,
    badgesAtom: createProjectBadgesAtom(projectsAtom, environmentIds),
  };
});

export function useSidebarProjectIconOrder() {
  const atoms = projectRowAtoms(environmentIdsKey([]));
  const projects = useAtomValue(atoms.projectsAtom);
  const activity = useAtomValue(atoms.activityAtom);
  return { projects, activity };
}

export function useSidebarProjectRowData(environmentIds: ReadonlySet<EnvironmentId> | null) {
  const atoms = projectRowAtoms(
    environmentIdsKey(environmentIds === null ? [] : [...environmentIds].sort()),
  );
  const projects = useAtomValue(atoms.projectsAtom);
  const activity = useAtomValue(atoms.activityAtom);
  const badges = useAtomValue(atoms.badgesAtom);
  return { projects, activity, badges };
}
