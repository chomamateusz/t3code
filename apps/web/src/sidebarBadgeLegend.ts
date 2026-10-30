const listeners = new Set<() => void>();
let queuedFromPalette = false;

export function onSidebarBadgeLegendRequest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSidebarBadgeLegendAvailable() {
  return listeners.size > 0;
}

export function openSidebarBadgeLegend() {
  for (const listener of listeners) listener();
}

export function queueSidebarBadgeLegendFromPalette() {
  queuedFromPalette = true;
}

/** Runs at the palette's focus restoration milestone so the palette cannot take focus back. */
export function openQueuedSidebarBadgeLegend(): boolean {
  if (!queuedFromPalette) return false;
  queuedFromPalette = false;
  if (!isSidebarBadgeLegendAvailable()) return false;
  window.requestAnimationFrame(openSidebarBadgeLegend);
  return true;
}
