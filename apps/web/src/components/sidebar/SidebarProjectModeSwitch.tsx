import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { EyeIcon, EyeOffIcon, ListTreeIcon, SettingsIcon } from "lucide-react";
import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { useAltKeySideState, useShortcutModifierState } from "../../shortcutModifierState";
import type { SidebarProjectFilterMode } from "../../sidebarProjectRow";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

type ModeSwitchAction = "include" | "exclude" | "group" | "settings";

function oppositeMode(mode: SidebarProjectFilterMode): SidebarProjectFilterMode {
  return mode === "include" ? "exclude" : "include";
}

export function SidebarProjectModeSwitch({
  mode,
  isMac,
  tooltipDisabled,
  onModeChange,
  onOpenSettings,
  onMenuOpenChange,
}: {
  readonly mode: SidebarProjectFilterMode;
  readonly isMac: boolean;
  readonly tooltipDisabled: boolean;
  readonly onModeChange: (mode: SidebarProjectFilterMode) => void;
  readonly onOpenSettings: () => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}) {
  const grouped = useClientSettings((settings) => settings.boringSidebarEnabled);
  const modifiers = useShortcutModifierState();
  const altSide = useAltKeySideState();
  const menuOpen = useRef(false);
  const suppressClick = useRef(false);
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const selectionModifier = isMac ? "⌘" : "Ctrl";
  const altModifier = isMac ? "Left ⌥" : "Left Alt";
  const modifierAction = (
    event: { readonly metaKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean },
    eventAltGraph = false,
  ): ModeSwitchAction | null => {
    // macOS has no AltGr key, yet Firefox reports AltGraph for both Option keys.
    if (!isMac && (altSide.altGraphKey || eventAltGraph)) return null;
    if (isMac ? event.metaKey : event.ctrlKey) return "group";
    return event.altKey && altSide.leftAltKey ? "settings" : null;
  };
  const face = modifierAction(modifiers) ?? mode;

  const run = (action: ModeSwitchAction) => {
    switch (action) {
      case "include":
      case "exclude":
        if (action !== mode) onModeChange(action);
        return;
      case "group":
        void updateClientSettings({ boringSidebarEnabled: !grouped });
        return;
      case "settings":
        onOpenSettings();
        return;
    }
  };

  const openMenu = (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api || menuOpen.current) return;
    menuOpen.current = true;
    onMenuOpenChange(true);
    void (async () => {
      const clicked = await settlePromise(() =>
        api.contextMenu.show<ModeSwitchAction>(
          [
            { id: "include", label: "Show selected", checked: mode === "include" },
            { id: "exclude", label: "Hide selected", checked: mode === "exclude" },
            {
              id: "group",
              label: "Group threads by project",
              checked: grouped,
              separatorBefore: true,
            },
            { id: "settings", label: "Sidebar settings", icon: "settings", separatorBefore: true },
          ],
          position,
        ),
      );
      menuOpen.current = false;
      onMenuOpenChange(false);
      if (clicked._tag === "Failure" || clicked.value === null) return;
      run(clicked.value);
    })();
  };

  const cancelLongPress = () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    cancelLongPress();
    if (event.pointerType !== "touch") return;
    const button = event.currentTarget;
    const position = { x: event.clientX, y: event.clientY };
    // iOS Safari sends no contextmenu event for a long press.
    longPress.current = {
      ...position,
      timer: window.setTimeout(() => {
        longPress.current = null;
        if (!button.isConnected) return;
        suppressClick.current = true;
        openMenu(position);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const pending = longPress.current;
    if (
      pending &&
      Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > LONG_PRESS_MOVE_TOLERANCE
    ) {
      cancelLongPress();
    }
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if ((isMac && event.ctrlKey) || event.button !== 0) return;
    run(modifierAction(event, event.getModifierState("AltGraph")) ?? oppositeMode(mode));
  };

  const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (longPress.current) {
      cancelLongPress();
      suppressClick.current = true;
    }
    openMenu({ x: event.clientX, y: event.clientY });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu({ x: rect.left, y: rect.bottom });
    } else if (event.key === "Enter") {
      const action = modifierAction(event, event.getModifierState("AltGraph"));
      if (action === null) return;
      event.preventDefault();
      run(action);
    }
  };

  const label =
    face === "group"
      ? "Group threads by project"
      : face === "settings"
        ? "Sidebar settings"
        : face === "exclude"
          ? "Hiding selected projects"
          : "Showing selected projects";
  const Icon =
    face === "group"
      ? ListTreeIcon
      : face === "settings"
        ? SettingsIcon
        : face === "exclude"
          ? EyeOffIcon
          : EyeIcon;

  return (
    <Tooltip disabled={tooltipDisabled}>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-project-row="mode-switch"
            data-face={face}
            data-pressed={(face === "group" && grouped) || undefined}
            aria-label={label}
            aria-pressed={face === "group" ? grouped : undefined}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerLeave={cancelLongPress}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <div data-project-row="keys">
          <Kbd>Click</Kbd>
          <span>Show selected ↔ Hide selected</span>
          <Kbd>{selectionModifier} Click</Kbd>
          <span>Group by project</span>
          <Kbd>{altModifier} Click</Kbd>
          <span>Sidebar settings</span>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
