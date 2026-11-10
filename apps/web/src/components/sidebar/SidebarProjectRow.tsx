import type { EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useSidebarProjectRowData } from "../../hooks/useSidebarProjectRowData";
import { CheckIcon, LaptopIcon, XIcon } from "lucide-react";
import { memo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { observeResize } from "../../lib/observeResize";
import { isMacPlatform } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { fitSidebarProjectRow, type SidebarProjectFilterMode } from "../../sidebarProjectRow";
import {
  combineSidebarProjectBadges,
  SIDEBAR_PROJECT_BADGE_LEGEND,
  summarizeSidebarProjectBadge,
  type SidebarProjectBadge,
} from "../Sidebar.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { isProjectPinShortcut, ProjectPinButton } from "../ProjectPinButton";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarProjectModeSwitch } from "./SidebarProjectModeSwitch";
import { SidebarThreadBadge, type SidebarThreadBadgeSummary } from "./SidebarThreadBadge";
import "./SidebarProjectRow.css";

function ProjectBadgeCounts({ badge }: { readonly badge: SidebarThreadBadgeSummary }) {
  if (badge === null) return null;
  return (
    <div data-project-row="tooltip-counts">
      {badge.entries.map((entry) => (
        <span key={entry.state} className={entry.className}>
          <span data-project-row="tooltip-dot" />
          {entry.count} <span data-project-row="tooltip-count-label">{entry.label}</span>
        </span>
      ))}
    </div>
  );
}

function ProjectBadgeLegend() {
  return (
    <>
      <div data-project-row="tooltip-note">Badges</div>
      <div data-project-row="tooltip-legend">
        {SIDEBAR_PROJECT_BADGE_LEGEND.map((entry) => (
          <span key={entry.state}>
            <span data-project-row="tooltip-swatch">
              <SidebarThreadBadge badge={entry.badge} />
            </span>
            {entry.label}
          </span>
        ))}
      </div>
      <div data-project-row="tooltip-note">
        Colour: most urgent state · Number: threads needing you · Dot: only working
      </div>
    </>
  );
}

function ProjectIconTooltip({
  project,
  state,
  showMachines,
  threadCount,
  badge,
  selectionModifier,
}: {
  readonly project: SidebarProjectSnapshot;
  readonly state: "Selected" | "Shown" | "Hidden";
  readonly showMachines: boolean;
  readonly threadCount: number;
  readonly badge: SidebarThreadBadgeSummary;
  readonly selectionModifier: string;
}) {
  const machineNames = showMachines
    ? [...new Set(project.memberProjects.map((member) => member.environmentLabel).filter(Boolean))]
    : [];
  return (
    <div data-project-row="tooltip">
      <div data-project-row="tooltip-header">
        <span data-project-row="tooltip-title">{project.displayName}</span>
        <span data-project-row="tooltip-state" data-state={state}>
          {state}
        </span>
      </div>
      <div data-project-row="tooltip-meta">
        {machineNames.length > 0 ? <LaptopIcon aria-hidden className="size-3 flex-none" /> : null}
        <span>
          {machineNames.length > 0 ? `${machineNames.join(", ")} · ` : ""}
          {threadCount} threads
        </span>
      </div>
      <ProjectBadgeCounts badge={badge} />
      <hr data-project-row="tooltip-divider" />
      <div data-project-row="keys">
        <Kbd>Click</Kbd>
        <span>only this</span>
        <Kbd>{selectionModifier} Click</Kbd>
        <span>add or remove</span>
        <Kbd>Right-click</Kbd>
        <span>project settings</span>
      </div>
      <hr data-project-row="tooltip-divider" />
      <ProjectBadgeLegend />
    </div>
  );
}

function OverflowTooltip({
  count,
  selectedCount,
  badge,
}: {
  readonly count: number;
  readonly selectedCount: number;
  readonly badge: SidebarThreadBadgeSummary;
}) {
  return (
    <div data-project-row="tooltip">
      <div data-project-row="tooltip-title">
        {count} more projects{selectedCount > 0 ? `, ${selectedCount} selected` : ""}
      </div>
      <ProjectBadgeCounts badge={badge} />
    </div>
  );
}

interface SidebarProjectRowProps {
  readonly badges: readonly SidebarProjectBadge[];
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly activity: readonly {
    readonly projectKey: string;
    readonly threadCount: number;
    readonly lastActivity: number;
  }[];
  readonly selectedKeys: readonly string[];
  readonly mode: SidebarProjectFilterMode;
  readonly showMachines: boolean;
  readonly canPinProject?: (project: SidebarProjectSnapshot) => boolean;
  readonly onToggleProjectPin?: (project: SidebarProjectSnapshot) => void;
  readonly keybindings?: ResolvedKeybindingsConfig;
  readonly onToggle: (key: string, additive: boolean) => void;
  readonly onClear: () => void;
  readonly onModeChange: (mode: SidebarProjectFilterMode) => void;
  readonly onOpenSidebarSettings: () => void;
  readonly onProjectSettings: (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    project: SidebarProjectSnapshot,
  ) => void;
}

export const SidebarProjectRow = memo(
  function SidebarProjectRow({
    projects,
    activity,
    badges,
    selectedKeys,
    mode,
    showMachines,
    onToggle,
    onClear,
    onModeChange,
    onOpenSidebarSettings,
    onProjectSettings,
    canPinProject,
    onToggleProjectPin,
    keybindings,
  }: SidebarProjectRowProps) {
    const isMac = isMacPlatform(navigator.platform);
    const selectionModifier = isMac ? "⌘" : "Ctrl";
    const highlightedProjectKey = useRef<string | null>(null);
    const hasProjects = projects.length > 0;
    const [width, setWidth] = useState<number | null>(null);
    const [query, setQuery] = useState("");
    const [interaction, setInteraction] = useState<{
      pointerOver: boolean;
      overflowOpen: boolean;
      menuOpen: boolean;
      frozen: {
        keys: readonly string[];
        visible: readonly string[];
        overflow: readonly string[];
      } | null;
    }>({ pointerOver: false, overflowOpen: false, menuOpen: false, frozen: null });
    const activityByKey = new Map(activity.map((entry) => [entry.projectKey, entry]));
    const projectByKey = new Map(projects.map((project) => [project.projectKey, project]));
    const badgeByKey = new Map(
      badges.map((entry) => [entry.projectKey, summarizeSidebarProjectBadge(entry.counts)]),
    );
    const projectLabel = (project: SidebarProjectSnapshot, markHidden = true) => {
      const label =
        markHidden && mode === "exclude" && selectedKeys.includes(project.projectKey)
          ? `${project.displayName}, hidden`
          : project.displayName;
      const badge = badgeByKey.get(project.projectKey);
      return badge ? `${label} · ${badge.description}` : label;
    };
    const selected = new Set(selectedKeys);
    const keys = activity.flatMap((entry) =>
      projectByKey.has(entry.projectKey) ? [entry.projectKey] : [],
    );
    const fitted = fitSidebarProjectRow({
      keys,
      selected,
      width: Math.max(0, (width ?? 0) - (selected.size > 0 ? 52 : 28)),
      itemWidth: 26,
      gap: 2,
      overflowWidth: 34,
    });
    const layout = interaction.frozen ?? {
      keys,
      ...(width === null ? { visible: [], overflow: [] } : fitted),
    };
    const overflowSelectedCount = layout.overflow.filter((key) => selected.has(key)).length;
    const overflowKeys = new Set(layout.overflow);
    const overflowBadge = summarizeSidebarProjectBadge(
      combineSidebarProjectBadges(
        badges.filter((entry) => overflowKeys.has(entry.projectKey)).map((entry) => entry.counts),
      ),
    );
    const overflowLabel = `${layout.overflow.length} more projects${
      overflowSelectedCount > 0 ? `, ${overflowSelectedCount} selected` : ""
    }${overflowBadge ? ` · ${overflowBadge.description}` : ""}`;
    const orderedProjects = layout.keys.flatMap((key) => projectByKey.get(key) ?? []);
    const filteredProjects = orderedProjects.filter((project) =>
      project.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    const tooltipsDisabled = interaction.overflowOpen || interaction.menuOpen;
    const updateInteraction = (
      field: "pointerOver" | "overflowOpen" | "menuOpen",
      value: boolean,
    ) => {
      setInteraction((previous) => {
        const next = { ...previous, [field]: value };
        return {
          ...next,
          frozen:
            width !== null && (next.pointerOver || next.overflowOpen || next.menuOpen)
              ? (previous.frozen ?? layout)
              : null,
        };
      });
    };
    const settings = (
      event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
      project: SidebarProjectSnapshot,
    ) => {
      setInteraction({ pointerOver: false, overflowOpen: false, menuOpen: false, frozen: null });
      onProjectSettings(event, project);
    };
    const projectKeyDown = (event: KeyboardEvent<HTMLElement>, project: SidebarProjectSnapshot) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (keybindings && canPinProject?.(project) && isProjectPinShortcut(event, keybindings)) {
        event.preventDefault();
        event.stopPropagation();
        onToggleProjectPin?.(project);
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        settings(event, project);
      } else if ((isMac ? event.metaKey : event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        onToggle(project.projectKey, true);
      }
    };

    if (!hasProjects) return null;

    return (
      <div
        ref={(element) => {
          if (!element) return;
          return observeResize(element, ([entry]) => {
            if (entry) setWidth(entry.contentRect.width);
          });
        }}
        data-project-row="root"
        data-mode={mode}
        data-has-selection={selected.size > 0 || undefined}
        role="group"
        aria-label="Filter projects"
        onPointerEnter={() => {
          updateInteraction("pointerOver", true);
        }}
        onPointerLeave={() => updateInteraction("pointerOver", false)}
      >
        <div data-project-row="icons">
          {layout.visible.map((key) => {
            const project = projectByKey.get(key);
            if (!project) return null;
            const isSelected = selected.has(key);
            const state =
              mode === "exclude"
                ? isSelected
                  ? "Hidden"
                  : "Shown"
                : isSelected
                  ? "Selected"
                  : selected.size > 0
                    ? "Hidden"
                    : "Shown";
            const badge = badgeByKey.get(key) ?? null;
            return (
              <Tooltip key={key} disabled={tooltipsDisabled}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-project-row="icon"
                      data-selected={isSelected || undefined}
                      aria-label={projectLabel(project)}
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        if ((isMac && event.ctrlKey) || event.button !== 0) return;
                        onToggle(key, isMac ? event.metaKey : event.ctrlKey);
                      }}
                      onContextMenu={(event) => settings(event, project)}
                      onKeyDown={(event) => projectKeyDown(event, project)}
                    />
                  }
                >
                  <span data-project-row="favicon">
                    <ProjectFavicon project={project} className="size-4" />
                  </span>
                  <SidebarThreadBadge badge={badge} />
                </TooltipTrigger>
                <TooltipPopup side="bottom">
                  <ProjectIconTooltip
                    project={project}
                    state={state}
                    showMachines={showMachines}
                    threadCount={activityByKey.get(key)?.threadCount ?? 0}
                    badge={badge}
                    selectionModifier={selectionModifier}
                  />
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
        {layout.overflow.length > 0 ? (
          <Combobox<SidebarProjectSnapshot>
            items={orderedProjects}
            filteredItems={filteredProjects}
            autoHighlight
            itemToStringLabel={(project) => project.displayName}
            isItemEqualToValue={(a, b) => a.projectKey === b.projectKey}
            value={null}
            open={interaction.overflowOpen}
            onOpenChange={(open, details) => {
              if (details.isCanceled) return;
              updateInteraction("overflowOpen", open);
              if (!open) setQuery("");
            }}
            onItemHighlighted={(project) => {
              highlightedProjectKey.current = project?.projectKey ?? null;
            }}
            onValueChange={(project, details) => {
              details.cancel();
              if (!project) return;
              const event = details.event;
              if (isMac && "ctrlKey" in event && event.ctrlKey) return;
              onToggle(
                project.projectKey,
                Boolean(
                  isMac ? "metaKey" in event && event.metaKey : "ctrlKey" in event && event.ctrlKey,
                ),
              );
            }}
          >
            <Tooltip disabled={tooltipsDisabled}>
              <TooltipTrigger
                render={
                  <ComboboxTrigger
                    render={
                      <button
                        type="button"
                        data-project-row="more"
                        data-selected={overflowSelectedCount > 0 || undefined}
                        aria-label={overflowLabel}
                      />
                    }
                  />
                }
              >
                +{layout.overflow.length}
                <SidebarThreadBadge badge={overflowBadge} />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                <OverflowTooltip
                  count={layout.overflow.length}
                  selectedCount={overflowSelectedCount}
                  badge={overflowBadge}
                />
              </TooltipPopup>
            </Tooltip>
            <ComboboxPopup
              align="start"
              collisionAvoidance={{ side: "flip", align: "shift" }}
              finalFocus={(closeType) => closeType === "keyboard"}
            >
              <ComboboxSearchInput
                aria-label="Search project row"
                placeholder="Search projects..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  const project = projectByKey.get(highlightedProjectKey.current ?? "");
                  if (project) projectKeyDown(event, project);
                }}
              />
              <ComboboxEmpty>No matching projects.</ComboboxEmpty>
              <ComboboxList aria-multiselectable>
                {(project: SidebarProjectSnapshot) => (
                  <ComboboxItem
                    key={project.projectKey}
                    value={project}
                    aria-label={projectLabel(project, false)}
                    title={projectLabel(project, false)}
                    hideIndicator
                    aria-selected={selected.has(project.projectKey)}
                    data-selected={undefined}
                    onContextMenu={(event) => settings(event, project)}
                  >
                    <span
                      data-project-row="checkbox"
                      data-selected={selected.has(project.projectKey) || undefined}
                      data-mode={mode}
                    >
                      {selected.has(project.projectKey) ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span data-project-row="popup-icon">
                      <ProjectFavicon project={project} className="size-4" />
                      <SidebarThreadBadge badge={badgeByKey.get(project.projectKey) ?? null} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
                    {canPinProject?.(project) && onToggleProjectPin ? (
                      <ProjectPinButton
                        name={project.displayName}
                        pinned={project.pinned}
                        onToggle={() => onToggleProjectPin(project)}
                        shortcutLabel={
                          keybindings ? shortcutLabelForCommand(keybindings, "thread.pin") : null
                        }
                      />
                    ) : null}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </Combobox>
        ) : null}
        {selected.size > 0 ? (
          <button
            type="button"
            data-project-row="clear"
            aria-label="Clear project selection"
            onClick={onClear}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
        <SidebarProjectModeSwitch
          mode={mode}
          isMac={isMac}
          tooltipDisabled={tooltipsDisabled}
          onModeChange={onModeChange}
          onOpenSettings={onOpenSidebarSettings}
          onMenuOpenChange={(open) => updateInteraction("menuOpen", open)}
        />
      </div>
    );
  },
  (previous, next) =>
    previous.projects === next.projects &&
    previous.activity === next.activity &&
    previous.badges === next.badges &&
    previous.mode === next.mode &&
    previous.showMachines === next.showMachines &&
    previous.onToggle === next.onToggle &&
    previous.onClear === next.onClear &&
    previous.onModeChange === next.onModeChange &&
    previous.onOpenSidebarSettings === next.onOpenSidebarSettings &&
    previous.onProjectSettings === next.onProjectSettings &&
    previous.canPinProject === next.canPinProject &&
    previous.onToggleProjectPin === next.onToggleProjectPin &&
    previous.keybindings === next.keybindings &&
    previous.selectedKeys.length === next.selectedKeys.length &&
    previous.selectedKeys.every((key, index) => key === next.selectedKeys[index]),
);

export const ConnectedSidebarProjectRow = memo(function ConnectedSidebarProjectRow({
  environmentIds,
  ...props
}: Omit<SidebarProjectRowProps, "projects" | "activity" | "badges"> & {
  readonly environmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const data = useSidebarProjectRowData(environmentIds);
  return <SidebarProjectRow {...props} {...data} />;
});
