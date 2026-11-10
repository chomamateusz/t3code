import { useEffect, useRef, useState } from "react";
import { isEditableFocused } from "./lib/editableFocus";

export interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const EMPTY_SHORTCUT_MODIFIER_STATE: ShortcutModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

function areShortcutModifierStatesEqual(
  left: ShortcutModifierState,
  right: ShortcutModifierState,
): boolean {
  return (
    left.metaKey === right.metaKey &&
    left.ctrlKey === right.ctrlKey &&
    left.altKey === right.altKey &&
    left.shiftKey === right.shiftKey
  );
}

export interface AltKeySideState {
  leftAltKey: boolean;
  altGraphKey: boolean;
}

const EMPTY_ALT_KEY_SIDE_STATE: AltKeySideState = { leftAltKey: false, altGraphKey: false };

function areAltKeySideStatesEqual(left: AltKeySideState, right: AltKeySideState): boolean {
  return left.leftAltKey === right.leftAltKey && left.altGraphKey === right.altGraphKey;
}

export function useShortcutModifierState(ignoreEditable = false): ShortcutModifierState {
  return useHeldKeyState(
    EMPTY_SHORTCUT_MODIFIER_STATE,
    shortcutModifierStateAfterKeyboardEvent,
    areShortcutModifierStatesEqual,
    ignoreEditable,
  );
}

/** Option/Alt + letter types characters, so actions bound to Alt listen to the left key only. */
export function useAltKeySideState(): AltKeySideState {
  return useHeldKeyState(
    EMPTY_ALT_KEY_SIDE_STATE,
    altKeySideStateAfterKeyboardEvent,
    areAltKeySideStatesEqual,
    false,
  );
}

function useHeldKeyState<TState>(
  empty: TState,
  stateAfterKeyboardEvent: (current: TState, event: KeyboardEvent) => TState,
  areEqual: (left: TState, right: TState) => boolean,
  ignoreEditable: boolean,
): TState {
  const [state, setState] = useState(empty);
  const stateRef = useRef(empty);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window key, focus, paste and blur listeners that track held keys
  useEffect(() => {
    const updateState = (next: TState) => {
      if (areEqual(stateRef.current, next)) return;
      stateRef.current = next;
      setState(next);
    };
    const onKeyboardEvent = (event: KeyboardEvent) => {
      updateState(
        ignoreEditable && isEditableFocused(event.target)
          ? empty
          : stateAfterKeyboardEvent(stateRef.current, event),
      );
    };
    // Dictation tools can omit Meta keyup after synthetic paste, leaving jump hints stuck.
    const onResetEvent = () => {
      updateState(empty);
    };

    const onFocus = (event: FocusEvent) => {
      if (ignoreEditable && isEditableFocused(event.target)) onResetEvent();
    };
    window.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKeyboardEvent, true);
    window.addEventListener("keyup", onKeyboardEvent, true);
    window.addEventListener("paste", onResetEvent, true);
    window.addEventListener("blur", onResetEvent);
    return () => {
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKeyboardEvent, true);
      window.removeEventListener("keyup", onKeyboardEvent, true);
      window.removeEventListener("paste", onResetEvent, true);
      window.removeEventListener("blur", onResetEvent);
    };
  }, [empty, stateAfterKeyboardEvent, areEqual, ignoreEditable]);

  return state;
}

function altKeySideStateAfterKeyboardEvent(
  current: AltKeySideState,
  event: KeyboardEvent,
): AltKeySideState {
  const next = {
    leftAltKey:
      event.code === "AltLeft"
        ? event.type === "keydown"
        : current.leftAltKey && (event.code === "AltRight" || event.altKey),
    altGraphKey: event.getModifierState("AltGraph"),
  };
  return areAltKeySideStatesEqual(current, next) ? current : next;
}

function normalizeModifierKey(key: string): keyof ShortcutModifierState | null {
  switch (key) {
    case "Meta":
    case "OS":
    case "Command":
      return "metaKey";
    case "Control":
      return "ctrlKey";
    case "Alt":
    case "Option":
      return "altKey";
    case "Shift":
      return "shiftKey";
    default:
      return null;
  }
}

export function shortcutModifierStateAfterKeyboardEvent(
  currentState: ShortcutModifierState,
  event: KeyboardEvent,
): ShortcutModifierState {
  const normalizedModifierKey = normalizeModifierKey(event.key);
  let nextState: ShortcutModifierState;
  if (normalizedModifierKey) {
    nextState = {
      ...currentState,
      [normalizedModifierKey]: event.type === "keydown",
    };
  } else {
    // Dictation paste can poison real events with metaKey=true until a physical Meta press.
    nextState = {
      metaKey: currentState.metaKey && event.metaKey,
      ctrlKey: currentState.ctrlKey && event.ctrlKey,
      altKey: currentState.altKey && event.altKey,
      shiftKey: currentState.shiftKey && event.shiftKey,
    };
  }

  return areShortcutModifierStatesEqual(currentState, nextState) ? currentState : nextState;
}
