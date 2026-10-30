import type { EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useSidebarProjectRowData } from "../../hooks/useSidebarProjectRowData";
import { CheckIcon, EyeIcon, EyeOffIcon, InfoIcon, MoreHorizontalIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { observeResize } from "../../lib/observeResize";
import { isMacPlatform } from "../../lib/utils";
import { onSidebarBadgeLegendRequest } from "../../sidebarBadgeLegend";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { fitSidebarProjectRow, type SidebarProjectFilterMode } from "../../sidebarProjectRow";
import {
  combineSidebarProjectBadges,
  SIDEBAR_PROJECT_BADGE_LEGEND,
  summarizeSidebarProjectBadge,
  type SidebarProjectBadge,
  type SidebarProjectBadgeState,
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
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import "./SidebarProjectRow.css";

const ProjectThreadBadge = memo(
  function ProjectThreadBadge({
    badge,
  }: {
    readonly badge: ReturnType<typeof summarizeSidebarProjectBadge>;
  }) {
    if (badge === null) return null;
    return (
      <span
        aria-hidden
        data-project-row="thread-badge"
        data-working={badge.count === 0 || undefined}
        className={badge.className}
      >
        {badge.label === null ? null : <span>{badge.label}</span>}
      </span>
    );
  },
  (previous, next) =>
    previous.badge?.count === next.badge?.count &&
    previous.badge?.label === next.badge?.label &&
    previous.badge?.className === next.badge?.className &&
    previous.badge?.description === next.badge?.description,
);

const BADGE_MEANINGS = {
  approval: "An action waits for your approval",
  input: "An agent asked you a question",
  request: "A guest message waits for you",
  failed: "The last run failed",
  limited: "Stopped by a usage limit",
  woke: "A snoozed thread woke up",
  done: "Finished, not opened yet",
  working: "Running now",
} satisfies Record<SidebarProjectBadgeState, string>;

function ProjectBadgeLegend() {
  return (
    <div data-project-row="legend">
      <PopoverTitle>Project badges</PopoverTitle>
      <ul>
        {SIDEBAR_PROJECT_BADGE_LEGEND.map((entry) => (
          <li key={entry.state}>
            <span data-project-row="legend-swatch">
              <ProjectThreadBadge badge={entry.badge} />
            </span>
            <span className="font-medium">{entry.label}</span>
            <span className="text-muted-foreground">{BADGE_MEANINGS[entry.state]}</span>
          </li>
        ))}
      </ul>
      <p>Colour: the most urgent state, top of this list first.</p>
      <p>Hover an icon for exact counts.</p>
      <p>Number: threads needing you, all but Working, up to 9+.</p>
      <p>Dot without a number: only working threads.</p>
      <p>
        Order: pinned, then latest thread activity, then name. Selected projects stay in the row.
      </p>
      <p>+N: projects that do not fit, with their combined badge.</p>
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
    onProjectSettings,
    canPinProject,
    onToggleProjectPin,
    keybindings,
  }: SidebarProjectRowProps) {
    const grouped = useClientSettings((settings) => settings.boringSidebarEnabled);
    const isMac = isMacPlatform(navigator.platform);
    const selectionModifier = isMac ? "⌘" : "Ctrl";
    const highlightedProjectKey = useRef<string | null>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const [legendOpen, setLegendOpen] = useState(false);
    const hasProjects = projects.length > 0;
    // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this row for command palette legend requests only while it renders, and closes the legend when it stops
    useEffect(() => {
      if (!hasProjects) return;
      const unsubscribe = onSidebarBadgeLegendRequest(() => setLegendOpen(true));
      return () => {
        unsubscribe();
        setLegendOpen(false);
      };
    }, [hasProjects]);
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
            const machineNames = [
              ...new Set(
                project.memberProjects.map((member) => member.environmentLabel).filter(Boolean),
              ),
            ];
            return (
              <Tooltip
                key={key}
                disabled={interaction.overflowOpen || interaction.menuOpen || legendOpen}
              >
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
                  <ProjectThreadBadge badge={badgeByKey.get(key) ?? null} />
                </TooltipTrigger>
                <TooltipPopup side="bottom">
                  <div className="font-medium">{projectLabel(project)}</div>
                  <div className="text-muted-foreground">
                    {showMachines && machineNames.length > 0 ? `${machineNames.join(", ")} · ` : ""}
                    {activityByKey.get(key)?.threadCount ?? 0} threads
                  </div>
                  <div>{state}</div>
                  <div className="text-muted-foreground">
                    Click: only this · {selectionModifier}-click: add or remove · Right-click:
                    settings
                  </div>
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
            <Tooltip disabled={interaction.overflowOpen || interaction.menuOpen || legendOpen}>
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
                <ProjectThreadBadge badge={overflowBadge} />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{overflowLabel}</TooltipPopup>
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
                      <ProjectThreadBadge badge={badgeByKey.get(project.projectKey) ?? null} />
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
        <Menu
          open={interaction.menuOpen}
          onOpenChange={(open) => updateInteraction("menuOpen", open)}
        >
          <MenuTrigger
            render={
              <button
                ref={menuButtonRef}
                type="button"
                data-project-row="menu"
                aria-label="Project filter options"
              />
            }
          >
            <MoreHorizontalIcon className="size-4" />
            {mode === "exclude" && selected.size > 0 ? <span data-project-row="dot" /> : null}
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Selected projects</MenuGroupLabel>
              <MenuRadioGroup
                value={mode}
                onValueChange={(value) => onModeChange(value === "exclude" ? "exclude" : "include")}
              >
                <MenuRadioItem value="include">
                  <span className="flex items-center gap-2">
                    <span
                      data-project-row="radio"
                      data-selected={mode === "include" || undefined}
                      aria-hidden
                    />
                    <span className="flex-1">Show only selected</span>
                    <EyeIcon className="size-4" />
                  </span>
                </MenuRadioItem>
                <MenuRadioItem value="exclude">
                  <span className="flex items-center gap-2">
                    <span
                      data-project-row="radio"
                      data-selected={mode === "exclude" || undefined}
                      data-mode="exclude"
                      aria-hidden
                    />
                    <span className="flex-1">Hide selected</span>
                    <EyeOffIcon className="size-4" />
                  </span>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={grouped}
              onCheckedChange={(checked) => {
                void updateClientSettings({ boringSidebarEnabled: checked });
              }}
            >
              Group threads by project
            </MenuCheckboxItem>
            <MenuSeparator />
            <MenuItem disabled={selected.size === 0} onClick={onClear}>
              <XIcon />
              <span className="flex-1">Clear selection</span>
              <span className="text-muted-foreground">{selected.size}</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => setLegendOpen(true)}>
              <InfoIcon />
              Badge legend
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Popover open={legendOpen} onOpenChange={setLegendOpen}>
          <PopoverPopup
            anchor={menuButtonRef}
            align="end"
            width="md"
            padding="compact"
            finalFocus={menuButtonRef}
          >
            <ProjectBadgeLegend />
          </PopoverPopup>
        </Popover>
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
  const { isMobile, open, setOpen } = useSidebar();
  const hasProjects = data.projects.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a legend request expands the collapsed desktop sidebar so its anchor is on screen; gated like the row's listener so it never offers the legend on its own
  useEffect(() => {
    if (!hasProjects) return;
    return onSidebarBadgeLegendRequest(() => {
      if (!isMobile && !open) setOpen(true);
    });
  }, [hasProjects, isMobile, open, setOpen]);
  return <SidebarProjectRow {...props} {...data} />;
});
