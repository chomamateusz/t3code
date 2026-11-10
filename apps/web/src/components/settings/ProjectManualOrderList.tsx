import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PinIcon } from "lucide-react";

import { useSidebarProjectIconOrder } from "~/hooks/useSidebarProjectRowData";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { sidebarProjectManualMove } from "~/sidebarProjectRow";
import { useUiStateStore } from "~/uiStateStore";
import { ProjectFavicon } from "../ProjectFavicon";

export function ProjectManualOrderList() {
  const { projects, activity } = useSidebarProjectIconOrder();
  const manualOrder = useUiStateStore((state) => state.projectOrder);
  const reorderProjects = useUiStateStore((state) => state.reorderProjects);
  const projectByKey = new Map(projects.map((project) => [project.projectKey, project]));
  const ordered = activity.flatMap((entry) => projectByKey.get(entry.projectKey) ?? []);
  const pinnedKeys = ordered.filter((project) => project.pinned).map(projectKeyOf);
  const unpinnedKeys = ordered.filter((project) => !project.pinned).map(projectKeyOf);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null) return;
    const move = sidebarProjectManualMove(
      ordered,
      manualOrder,
      String(event.active.id),
      String(event.over.id),
    );
    if (move !== null) reorderProjects(...move);
  };

  if (ordered.length === 0) return null;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <ol aria-label="Manual project order" className="mt-2 border-t border-border/50 py-1">
        <SortableContext items={pinnedKeys} strategy={verticalListSortingStrategy}>
          {ordered.slice(0, pinnedKeys.length).map((project, index) => (
            <SortableProjectRow key={project.projectKey} project={project} position={index + 1} />
          ))}
        </SortableContext>
        <SortableContext items={unpinnedKeys} strategy={verticalListSortingStrategy}>
          {ordered.slice(pinnedKeys.length).map((project, index) => (
            <SortableProjectRow
              key={project.projectKey}
              project={project}
              position={pinnedKeys.length + index + 1}
            />
          ))}
        </SortableContext>
      </ol>
    </DndContext>
  );
}

function projectKeyOf(project: SidebarProjectSnapshot) {
  return project.projectKey;
}

function SortableProjectRow({
  project,
  position,
}: {
  readonly project: SidebarProjectSnapshot;
  readonly position: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.projectKey });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-center gap-2 py-1", isDragging && "relative z-10 bg-background")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${project.displayName}, position ${position}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <ProjectFavicon project={project} className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-xs text-foreground">{project.displayName}</span>
      {project.pinned ? (
        <PinIcon role="img" aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground" />
      ) : null}
    </li>
  );
}
