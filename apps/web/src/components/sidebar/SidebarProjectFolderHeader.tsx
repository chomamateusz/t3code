import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ChevronDownIcon, SquarePenIcon } from "lucide-react";
import { memo, type KeyboardEvent } from "react";
import { shallow } from "zustand/vanilla/shallow";

import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import { countSidebarProjectBadgeThreads, summarizeSidebarProjectBadge } from "../Sidebar.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarThreadBadge } from "./SidebarThreadBadge";

/** The folder's sidebar tree row; its thread rows name it as their parent. */
export function sidebarFolderRowId(projectKey: string) {
  return `folder:${projectKey}`;
}

function isAltActivation(event: KeyboardEvent) {
  // macOS Option+Space reports a non-breaking space as the key.
  return event.altKey && (event.key === "Enter" || event.code === "Space");
}

interface SidebarProjectFolderHeaderProps {
  readonly group: SidebarProjectSnapshot;
  readonly collapsed: boolean;
  readonly hiddenThreads: readonly EnvironmentThreadShell[];
  readonly now: string;
  readonly onToggle: (group: SidebarProjectSnapshot, all: boolean) => void;
  readonly onNewThread: (group: SidebarProjectSnapshot) => void;
  readonly onContextMenu: (
    group: SidebarProjectSnapshot,
    position: { x: number; y: number },
  ) => void;
}

// The sidebar rebuilds hiddenThreads on every render, so compare its members.
function sameFolderHeaderProps(
  previous: SidebarProjectFolderHeaderProps,
  next: SidebarProjectFolderHeaderProps,
) {
  const { hiddenThreads: previousHidden, ...previousRest } = previous;
  const { hiddenThreads: nextHidden, ...nextRest } = next;
  return shallow(previousRest, nextRest) && shallow(previousHidden, nextHidden);
}

/**
 * A project folder in the boring sidebar. It reads like a shelf header: a trailing
 * count and chevron, with the count and the project row's badge only while it is
 * closed, so a closed folder still says when a hidden thread needs you.
 */
export const SidebarProjectFolderHeader = memo(function SidebarProjectFolderHeader(
  props: SidebarProjectFolderHeaderProps,
) {
  const { group, collapsed, hiddenThreads } = props;
  const rowId = sidebarFolderRowId(group.projectKey);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const badge = collapsed
    ? summarizeSidebarProjectBadge(
        countSidebarProjectBadgeThreads(hiddenThreads, {
          now: props.now,
          localLastVisitedAtById,
        }),
      )
    : null;
  return (
    <li
      data-testid="sidebar-project-folder"
      className="group/project-folder relative mt-2 list-none first:mt-0"
    >
      <button
        type="button"
        data-sidebar-row={rowId}
        aria-expanded={!collapsed}
        onClick={(event) => props.onToggle(group, event.altKey)}
        onKeyDown={(event) => {
          if (!isAltActivation(event)) return;
          event.preventDefault();
          props.onToggle(group, true);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(group, { x: event.clientX, y: event.clientY });
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-(--sidebar-folder-gap) rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ProjectFavicon project={group} className="size-(--sidebar-folder-icon-size) shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
          {group.displayName}
        </span>
        <SidebarThreadBadge badge={badge} />
        {badge ? <span className="sr-only">, {badge.description}</span> : null}
        {collapsed && hiddenThreads.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground group-hover/project-folder:invisible pointer-coarse:invisible">
            {hiddenThreads.length}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {/* Sits over the count, which hides on hover, and left of the chevron. */}
      <span className="absolute inset-y-0 right-6 flex items-center opacity-0 focus-within:opacity-100 group-hover/project-folder:opacity-100 pointer-coarse:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                data-sidebar-action-for={rowId}
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`New thread in ${group.displayName}`}
                onClick={() => props.onNewThread(group)}
              />
            }
          >
            <SquarePenIcon aria-hidden />
          </TooltipTrigger>
          <TooltipPopup>New thread in {group.displayName}</TooltipPopup>
        </Tooltip>
      </span>
    </li>
  );
}, sameFolderHeaderProps);
