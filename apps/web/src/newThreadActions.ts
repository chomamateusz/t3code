import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";

import { shouldCreateNewThreadInCurrentProject } from "./components/Sidebar.logic";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { openCommandPalette } from "./commandPaletteBus";
import type { NewThreadHandler } from "./hooks/useHandleNewThread";
import { createScratchProjectActions } from "./hooks/useScratchProject";
import { startNewThreadFromContext, type ChatThreadActionContext } from "./lib/chatThreadActions";
import { resolveNewThreadTarget, type NewThreadTargetMember } from "./newThreadTarget";
import { readNewThreadTargetInput } from "./newThreadTargetState";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProject } from "./state/entities";
import { environmentPresentations, environmentSummaries } from "./state/presentation";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";

export async function startNewThreadInMember(
  handleNewThread: NewThreadHandler,
  member: Pick<NewThreadTargetMember, "environmentId" | "id">,
): Promise<void> {
  if (
    !appAtomRegistry
      .get(environmentSummaries.connectedEnvironmentIdsAtom)
      .includes(member.environmentId)
  )
    return;
  const projectRef = scopeProjectRef(member.environmentId, member.id);
  const project = readProject(projectRef);
  if (!project || project.archivedAt != null) return;
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  if (
    isScratchProject(
      project,
      presentations.get(member.environmentId)?.serverConfig?.scratchWorkspaceRoot,
    )
  ) {
    const scratch = createScratchProjectActions({
      environments: () =>
        [...presentations].map(([environmentId, presentation]) => ({
          ...presentation,
          environmentId,
        })),
      primaryEnvironmentId: () => appAtomRegistry.get(primaryEnvironmentIdAtom),
      registry: appAtomRegistry,
      handleNewThread,
    });
    await scratch.startScratchThread(member.environmentId);
    return;
  }
  await handleNewThread(projectRef, { exactProject: true });
}

export async function startNewThreadInSidebarFilter(
  handleNewThread: NewThreadHandler,
  options: {
    readonly allProjects?: boolean;
    readonly currentProject?: Omit<ChatThreadActionContext, "handleNewThread">;
  } = {},
): Promise<void> {
  const input = readNewThreadTargetInput();
  const target = options.allProjects ? { kind: "full" as const } : resolveNewThreadTarget(input);
  if (target.kind === "direct") {
    await startNewThreadInMember(handleNewThread, target.member);
    return;
  }
  if (
    target.kind === "full" &&
    !options.allProjects &&
    options.currentProject &&
    shouldCreateNewThreadInCurrentProject(
      false,
      pickableProjectGroups(input.groups).length,
      input.groups.length,
    )
  ) {
    if (await startNewThreadFromContext({ ...options.currentProject, handleNewThread })) return;
  }
  openCommandPalette({ open: "new-thread-in", newThreadTarget: target });
}
